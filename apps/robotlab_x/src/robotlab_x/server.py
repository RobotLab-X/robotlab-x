# managed
import logging
import json
import os
import uuid
import secrets
import base64
from fastapi import FastAPI, Request, Depends, HTTPException, Security, WebSocket
from fastapi.openapi.utils import get_openapi
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.staticfiles import StaticFiles
from robotlab_x.service_response import info_message
from invoker import safe_invoke
from fastapi.responses import FileResponse, Response, JSONResponse, RedirectResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials, OAuth2PasswordBearer, OAuth2PasswordRequestForm
from robotlab_x.models.registration import Registration
from robotlab_x.models.user import User
from database.interface import DatabaseAdapter
from database.factory import get_database_client
from queues.interface import QueueClient
from auth.verify_email import send_verification_email, send_reset_password_email
from auth.mfa import generate_totp_secret, get_totp_uri, generate_qr_code
from config import create_app_settings
from robotlab_x.models.config import Config as RobotlabXConfig
from robotlab_x.registration_service import verify_and_register

# FIXME - probably should be a static package definition vs in each app
from robotlab_x.service_response import ServiceResponseMessage
from auth.factory import get_auth_provider
from pydantic import BaseModel, Field
from typing import Any, List, Optional, Literal
from auth.generate_ssl import generate_self_signed_cert
from contextlib import asynccontextmanager
from robotlab_x.event_handlers import on_oauth_callback, on_get_oauth_provider_config, on_get_auth_session_ttl_seconds, on_get_jwt_access_token_ttl_minutes, on_get_auth_session_idle_timeout_seconds
from models.auth_oauth_provider_config import AuthOauthProviderConfig
from models.auth_oauth_callback_data import AuthOauthCallbackData
from urllib.parse import urlencode

import time
import hashlib
from collections import deque
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

REQUEST_BUFFER_MAX = 10_000
SENSITIVE_HEADER_NAMES = {"authorization", "x-api-key", "cookie", "set-cookie"}

VERSION_FILE = "version.json"

def hash_refresh_token(token: str, secret: str = None) -> str:
    """
    Hash a refresh token using SHA-256 with an optional server-side secret.
    
    Args:
        token: The refresh token to hash
        secret: Optional server-side secret (defaults to JWT_SECRET from env)
    
    Returns:
        Hex-encoded SHA-256 hash with 'sha256:' prefix
    """
    if secret is None:
        secret = os.environ.get("JWT_SECRET_KEY", "fallback_dev_key")
    
    combined = f"{secret}:{token}"
    hash_bytes = hashlib.sha256(combined.encode('utf-8')).digest()
    return f"sha256:{hash_bytes.hex()}"

def load_version():
    """Load the version from version.json safely."""
    try:
        if os.path.exists(VERSION_FILE):
            with open(VERSION_FILE, "r") as f:
                data = json.load(f)
                return data
    except (json.JSONDecodeError, IOError) as e:
        logger.warning(f"Error loading version.json: {e}")
    return {"version": "0.0.0"}

version = load_version()
logger.info(f"Loaded version: {version}")


def session_client_metadata(request) -> dict:
    """Extract (user_agent, ip_address) for an auth_session row from the request.

    The service typically runs behind a k8s ingress / load balancer, so
    request.client.host is the proxy hop, not the real client. Prefer the
    forwarded headers (first entry of X-Forwarded-For = original client),
    then X-Real-IP, and only fall back to the socket peer. Returns a dict
    ready to splat into the auth_session payload; values are None when the
    request object isn't available (e.g. non-HTTP callers).
    """
    if request is None:
        return {"user_agent": None, "ip_address": None}
    headers = getattr(request, "headers", {}) or {}
    xff = headers.get("x-forwarded-for") or ""
    ip = (
        xff.split(",")[0].strip()
        or headers.get("x-real-ip")
        or (getattr(request, "client", None).host if getattr(request, "client", None) else None)
    )
    return {
        "user_agent": headers.get("user-agent"),
        "ip_address": ip,
    }


def _decode_jwt_claims_unverified(token: str) -> dict:
    """Decode a JWT's payload claims WITHOUT verifying its signature.

    Used only to read the identity out of an OIDC id_token for logout-scoped
    session cleanup — never for authentication/authorization decisions.
    """
    try:
        parts = token.split(".")
        if len(parts) < 2:
            return {}
        payload = parts[1]
        payload += "=" * (-len(payload) % 4)  # restore base64 padding
        return json.loads(base64.urlsafe_b64decode(payload.encode("utf-8")))
    except Exception as exc:
        logger.warning(f"could not decode id_token claims for logout: {exc}")
        return {}


def _delete_sessions_for_id_token(db, id_token_hint: Optional[str]) -> int:
    """Delete all active auth_session rows for the user identified by an OIDC
    id_token. Best-effort: returns the count deleted, never raises.

    Identity resolution mirrors session creation: OAuth sessions store the
    lowercased email as user_id, so we prefer the email/preferred_username
    claim, falling back to sub.
    """
    if not db or not id_token_hint:
        return 0
    claims = _decode_jwt_claims_unverified(id_token_hint)
    identity = (
        claims.get("email")
        or claims.get("preferred_username")
        or claims.get("sub")
        or ""
    ).strip().lower()
    if not identity:
        logger.warning("oauth_logout: no identity claim in id_token; skipping session cleanup")
        return 0
    deleted = 0
    try:
        sessions = db.query_items("auth_session", {"user_id": identity, "status": "active"})
        for session in sessions:
            try:
                db.delete_item("auth_session", session["id"])
                deleted += 1
            except Exception as del_err:
                logger.warning(f"oauth_logout: failed to delete session {session.get('id')}: {del_err}")
        logger.info(f"oauth_logout deleted {deleted} active session(s) for {identity}")
    except Exception as exc:
        logger.warning(f"oauth_logout session cleanup failed for {identity}: {exc}")
    return deleted

def build_oauth_state(user_id: Optional[str], *, sso_config_id: Optional[str] = None) -> str:
    """Build an opaque OAuth state token.

    `sso_config_id` is optional and used by multi-tenant deployments to route
    the callback to the right per-tenant SSO config. Apps that don't supply it
    behave exactly as before — the key is simply omitted from the payload.
    """
    payload = {
        "nonce": secrets.token_urlsafe(16),
    }
    if user_id:
        payload["user_id"] = user_id
    if sso_config_id:
        payload["sso_config_id"] = sso_config_id
    raw = json.dumps(payload).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("utf-8")


def decode_oauth_state(value: Optional[str]) -> Optional[dict[str, Any]]:
    if not value:
        return None
    try:
        padded = value + "=" * (-len(value) % 4)
        decoded = base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8")
        return json.loads(decoded)
    except Exception:
        logger.warning("Failed to decode OAuth state payload")
        return None

# Define request models for proper API documentation
# FIXME - move to package/models !!!
class LoginRequest(BaseModel):
    username: str = Field(..., description="Email or username for authentication")
    password: str = Field(..., description="User password")

class LoginResponse(BaseModel):
    access_token: Optional[str] = Field(None, description="JWT access token (provided when login is successful)")
    token_type: Optional[str] = Field(None, description="Token type, usually 'bearer'")
    mfa_required: Optional[bool] = Field(None, description="Indicates if MFA verification is required")
    message: Optional[str] = Field(None, description="Additional information message")
    refresh_token: Optional[str] = Field(None, description="Refresh token for obtaining new access tokens")

class MFAVerifyRequest(BaseModel):
    username: str
    code: str

class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    resetToken: str
    newPassword: str

class RefreshTokenRequest(BaseModel):
    refresh_token: str

class RefreshTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    refresh_token: Optional[str] = None
    expires_in: Optional[int] = None
    id_token: Optional[str] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    # TODO - "invoke" service methods to hook implementation
    print("Starting up...")  # Setup: DB connection, worker init, etc.
    yield
    print("Shutting down...")  # Teardown: close DB, cleanup tasks, etc.
    
class AppServer:
    def __init__(self, settings: RobotlabXConfig):
        self.settings : RobotlabXConfig = settings
        self._request_capture_enabled = bool(self.settings.debug)
        self._request_buffer = deque(maxlen=REQUEST_BUFFER_MAX)
        self._request_cursor = 0

        self.app = FastAPI(title="Robotlab X", lifespan=lifespan, version=version.get("version", "0.0.0"), openapi_tags=[{'name': 'Config'}, {'name': 'User'}, {'name': 'Service Meta'}, {'name': 'Service Proxy'}, {'name': 'Service Config'}, {'name': 'Workspace'}, {'name': 'Peer'}, {'name': 'Config Set'}, {'name': 'Link'}, {'name': 'Service Request'}, {'name': 'Script'}, {'name': 'Registration'}])
        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

        # Request logging middleware for diagnostics
        @self.app.middleware("http")
        async def log_requests(request: Request, call_next):
            if not self._request_capture_enabled:
                return await call_next(request)

            body_bytes = await request.body()

            async def _receive():
                return {"type": "http.request", "body": body_bytes, "more_body": False}

            request = Request(request.scope, _receive)

            self._request_cursor += 1
            self._request_buffer.append(
                {
                    "cursor": self._request_cursor,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "method": request.method,
                    "path": request.url.path,
                    "query": request.url.query,
                    "headers": self._scrub_headers(dict(request.headers.items())),
                    "body": self._render_body(body_bytes, request.headers.get("content-type")),
                }
            )

            logger.info(f"HTTP {request.method} {request.url.path}")
            response = await call_next(request)
            logger.info(f"HTTP {request.method} {request.url.path} -> {response.status_code}")
            return response
        
        @self.app.middleware("http")
        async def set_cache_headers(request: Request, call_next):
            response = await call_next(request)
            content_type = response.headers.get("content-type", "")
            if content_type.startswith("text/html"):
                response.headers["Cache-Control"] = "no-store, must-revalidate"
                response.headers["Pragma"] = "no-cache"
                response.headers["Expires"] = "0"
            return response

        @self.app.middleware("http")
        async def set_security_headers(request: Request, call_next):
            response = await call_next(request)
            response.headers["X-Content-Type-Options"] = "nosniff"

            # Allow Swagger UI to be embedded in admin UI (same-origin only)
            # Other endpoints remain protected with DENY
            if request.url.path == "/docs":
                response.headers["X-Frame-Options"] = "SAMEORIGIN"
            else:
                response.headers["X-Frame-Options"] = "DENY"

            response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
            response.headers["X-XSS-Protection"] = "0"  # Disable legacy XSS filter; CSP is the modern approach
            return response

        self.auth = get_auth_provider(lambda: self.settings.model_dump())
        self.security = HTTPBearer()

        def custom_openapi():
            if self.app.openapi_schema:
                return self.app.openapi_schema

            schema = get_openapi(
                title=self.app.title,
                version=self.app.version,
                description=self.app.description,
                routes=self.app.routes,
                tags=self.app.openapi_tags,
            )
            components = schema.setdefault("components", {})
            security_schemes = components.setdefault("securitySchemes", {})
            _basic_auth_paths = safe_invoke("robotlab_x.event_handlers", "get_basic_auth_paths") or frozenset()
            if _basic_auth_paths:
                security_schemes["basic"] = {
                    "type": "http",
                    "scheme": "basic",
                    "description": "Basic auth.",
                }
                for path, operations in schema.get("paths", {}).items():
                    if path not in _basic_auth_paths:
                        continue
                    for operation in operations.values():
                        if not isinstance(operation, dict):
                            continue
                        operation["security"] = [{"basic": []}]
                        if "parameters" in operation:
                            operation["parameters"] = [
                                parameter
                                for parameter in operation["parameters"]
                                if not (
                                    isinstance(parameter, dict)
                                    and parameter.get("in") == "header"
                                    and parameter.get("name") in {"Authorization", "X-API-Key"}
                                )
                            ]

            self.app.openapi_schema = schema
            return self.app.openapi_schema

        self.app.openapi = custom_openapi

        # Detect compiled static UI path produced by CI/CD (apps/robotlab_x/build)
        #
        # Resolution order:
        #   1. App-defined ``resolve_ui_dir()`` in event_handlers.py — used by
        #      apps that need indirection (e.g. PyInstaller --onedir bundles
        #      that bake the UI into <install>/_internal/ui). Return a str
        #      path (or None to fall through to the default).
        #   2. The conventional ``apps/robotlab_x/build`` next to this file
        #      (CI/CD output).
        # Apps without ``resolve_ui_dir`` get the default — fully back-compat.
        self.ui_base_dir = None
        try:
            override = safe_invoke("robotlab_x.event_handlers", "resolve_ui_dir")
            if override and os.path.isdir(str(override)):
                self.ui_base_dir = str(override)
                logger.info(f"UI base dir resolved by event_handlers.resolve_ui_dir: {self.ui_base_dir}")
            else:
                app_root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../'))
                possible_build = os.path.join(app_root_dir, 'build')
                if os.path.isdir(possible_build):
                    self.ui_base_dir = possible_build
                    logger.info(f"Detected static UI build at: {self.ui_base_dir}")
                else:
                    logger.info(f"Static UI build folder not found at: {possible_build}")
        except Exception as e:
            logger.error(f"Error detecting static UI build: {e}")

        # Register API and helper routes first so they take precedence
        self._register_routes()

        # Mount static assets (but NOT root) for proper React Router BrowserRouter support
        self._mount_static_assets()
        
        # Add SPA fallback route LAST (after all API routes and static mounts)
        self._add_spa_fallback_route()

    def _mount_static_assets(self):
        """Mount static asset directories without catching all routes."""
        try:
            if self.ui_base_dir and os.path.isdir(self.ui_base_dir):
                # Mount specific asset directories that should be served as-is
                asset_dirs = ['_next', 'assets', 'static']
                for dir_name in asset_dirs:
                    asset_path = os.path.join(self.ui_base_dir, dir_name)
                    if os.path.isdir(asset_path):
                        self.app.mount(f'/{dir_name}', StaticFiles(directory=asset_path), name=dir_name)
                        logger.info(f"Mounted /{dir_name} from: {asset_path}")
                
                logger.info(f"Static assets mounted from: {self.ui_base_dir}")
            else:
                logger.info("UI not mounted (no build found)")
                
                # Legacy CRA/Vite build mounting (if present)
                if os.path.exists("build"):
                    if os.path.exists(os.path.join("build", "static")):
                        self.app.mount("/static", StaticFiles(directory="build/static"), name="static-legacy")
                        logger.info("Mounted legacy /static from build/static")
                    if os.path.exists(os.path.join("build", "assets")):
                        self.app.mount("/assets", StaticFiles(directory="build/assets"), name="assets-legacy")
                        logger.info("Mounted legacy /assets from build/assets")
        except Exception as e:
            logger.error(f"Failed to mount static assets: {e}")

    def _is_static_file(self, path: str) -> bool:
        """Check if the requested path is an actual static file."""
        if not self.ui_base_dir:
            # Fallback to legacy build dir
            build_dir = "build" if os.path.exists("build") else None
            if not build_dir:
                return False
            base = os.path.realpath(build_dir)
        else:
            base = os.path.realpath(self.ui_base_dir)

        candidate = os.path.realpath(os.path.join(base, path))
        if not candidate.startswith(base + os.sep) and candidate != base:
            return False
        return os.path.isfile(candidate)

    def _add_spa_fallback_route(self):
        """
        Add SPA fallback route for React Router BrowserRouter deep linking.
        This MUST be added last, after all API routes and static mounts.
        """
        if not self.ui_base_dir and not os.path.exists("build"):
            logger.info("Skipping SPA fallback (no UI build found)")
            return

        @self.app.api_route("/{full_path:path}", methods=["GET", "HEAD"])
        async def spa_fallback(request: Request, full_path: str):
            """
            SPA fallback for React Router BrowserRouter and Next.js static exports.
            - Serves actual files if they exist (favicon.ico, manifest.json, etc.)
            - For Next.js: checks for path.html or path/index.html
            - Returns index.html for all other requests (enables deep linking)
            - Does NOT catch /v1/* or /api/* routes (handled before this route)
            """
            # Skip if this is an API route (shouldn't happen due to route order, but be safe)
            if full_path.startswith("v1/") or full_path.startswith("api/"):
                raise HTTPException(status_code=404, detail="API endpoint not found")
            
            # Determine base directory (resolved to real absolute path once)
            raw_base = self.ui_base_dir if self.ui_base_dir else "build"
            base_dir = os.path.realpath(raw_base)

            def _safe_file(rel: str) -> str | None:
                """Return the resolved path only if it is inside base_dir, else None."""
                candidate = os.path.realpath(os.path.join(base_dir, rel))
                if candidate != base_dir and not candidate.startswith(base_dir + os.sep):
                    return None
                return candidate if os.path.isfile(candidate) else None

            # Check if the requested path is an actual file
            file_path = _safe_file(full_path)
            if file_path:
                # Serve the actual file (favicon.ico, manifest.json, robots.txt, etc.)
                return FileResponse(file_path)

            # Next.js export creates route.html or route/index.html for each route
            # Try path with .html extension
            html_file_path = _safe_file(f"{full_path}.html")
            if html_file_path:
                headers = {
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache",
                    "Expires": "0"
                }
                return FileResponse(html_file_path, headers=headers)

            # Try path/index.html (Next.js nested route structure)
            nested_index_path = _safe_file(os.path.join(full_path, "index.html"))
            if nested_index_path:
                headers = {
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache",
                    "Expires": "0"
                }
                return FileResponse(nested_index_path, headers=headers)
            
            # For all other paths, return root index.html (SPA fallback)
            index_path = os.path.join(base_dir, "index.html")
            if os.path.isfile(index_path):
                # No-cache headers for index.html to ensure fresh React Router state
                headers = {
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache",
                    "Expires": "0"
                }
                return FileResponse(index_path, headers=headers)
            
            # Fallback 404 if index.html doesn't exist
            raise HTTPException(status_code=404, detail="Frontend not found")

    def _register_routes(self):
        if self._request_capture_enabled:
            @self.app.get("/__requests")
            def get_captured_requests(since: Optional[int] = None):
                rows = list(self._request_buffer)
                if since is not None:
                    rows = [row for row in rows if row["cursor"] > since]
                return {
                    "count": len(rows),
                    "latest_cursor": self._request_cursor,
                    "max_size": REQUEST_BUFFER_MAX,
                    "requests": rows,
                }

            @self.app.post("/__reset")
            def reset_captured_requests():
                cleared = self._clear_request_buffer()
                return {"success": True, "cleared": cleared}

        @self.app.get("/v1/version")
        def get_version():
            return version

        @self.app.websocket("/ws")
        async def websocket_endpoint(websocket: WebSocket):
            await websocket.accept()
            try:
                # Allow app to initialize/authenticate connection
                safe_invoke("robotlab_x.event_handlers", "on_websocket_connect", [websocket])
                
                while True:
                    data = await websocket.receive_text()
                    response = safe_invoke("robotlab_x.event_handlers", "on_websocket_message", [data, websocket])
                    if response:
                        await websocket.send_text(response)
            except Exception as e:
                logger.error(f"WebSocket error: {e}")
            finally:
                safe_invoke("robotlab_x.event_handlers", "on_websocket_disconnect", [websocket])

        @self.app.post("/v1/mfa/setup")
        def setup_mfa(item: User, db: DatabaseAdapter = Depends(self.get_db_provider)):
            item.id = item.id.lower()
            user = db.get_item("user", item.id)
            if not user:
                raise HTTPException(status_code=404, detail="User not found")
            secret = generate_totp_secret(item.id)
            user["totp_secret"] = secret
            user["is_mfa_enabled"] = True
            db.update_item("user", item.id, user)
            uri = get_totp_uri(item.id, secret, self.settings.base_url)
            return {"secret": secret, "otp_auth_url": uri}

        @self.app.get("/v1/mfa/qrcode")
        def get_qrcode(username: str, db: DatabaseAdapter = Depends(self.get_db_provider)):
            user = db.get_item("user", username)
            if not user or not user.totp_secret:
                raise HTTPException(status_code=404, detail="MFA not set up for this user")
            uri = get_totp_uri(username, user.totp_secret, self.settings.base_url)
            return generate_qr_code(uri)
        
        # Include API routes
        from robotlab_x.api.config_api import router as config_router
        self.app.include_router(config_router, prefix='/v1', tags=["Config"])
        from robotlab_x.api.user_api import router as user_router
        self.app.include_router(user_router, prefix='/v1', tags=["User"])
        from robotlab_x.api.service_meta_api import router as service_meta_router
        self.app.include_router(service_meta_router, prefix='/v1', tags=["Service Meta"])
        from robotlab_x.api.service_proxy_api import router as service_proxy_router
        self.app.include_router(service_proxy_router, prefix='/v1', tags=["Service Proxy"])
        from robotlab_x.api.service_config_api import router as service_config_router
        self.app.include_router(service_config_router, prefix='/v1', tags=["Service Config"])
        from robotlab_x.api.workspace_api import router as workspace_router
        self.app.include_router(workspace_router, prefix='/v1', tags=["Workspace"])
        from robotlab_x.api.peer_api import router as peer_router
        self.app.include_router(peer_router, prefix='', tags=["Peer"])
        from robotlab_x.api.config_set_api import router as config_set_router
        self.app.include_router(config_set_router, prefix='', tags=["Config Set"])
        from robotlab_x.api.link_api import router as link_router
        self.app.include_router(link_router, prefix='', tags=["Link"])
        from robotlab_x.api.service_request_api import router as service_request_router
        self.app.include_router(service_request_router, prefix='/v1', tags=["Service Request"])
        from robotlab_x.api.script_api import router as script_router
        self.app.include_router(script_router, prefix='/v1', tags=["Script"])
        from robotlab_x.api.registration_api import router as registration_router
        self.app.include_router(registration_router, prefix='/v1', tags=["Registration"])

        # ─── ESCAPE HATCH ───────────────────────────────────────────────
        # Everything that is a normal resource is a DSL model now (CRUD +
        # the standard ``-request {action}`` endpoint, business logic in the
        # unmanaged services/<model>_service.py — storage-agnostic, so DB vs
        # filesystem vs live state is the service's concern, not the API's).
        # See ``peer``, ``config_set``, ``script`` (run = script-request
        # action) for examples that used to live here.
        #
        # What remains below genuinely cannot be a DSL model TODAY. Each is
        # annotated with WHY + the create_app deficit that would let it be
        # promoted, so a future generator revision can close the gap.

        # [transport] WebSocket, not request/response. The CRUD factory only
        # generates HTTP request/response routes — it has no notion of a
        # long-lived bidirectional socket. DEFICIT: a `__transport__: ws`
        # model kind that wires a websocket handler.
        from robotlab_x.runtime.ws_endpoint import register_ws_routes
        register_ws_routes(self.app)

        # [transport] Media plane: GET /v1/stream/{id}/mjpeg is a
        # multipart/x-mixed-replace STREAMING body and /upload is a
        # WebSocket — neither is a JSON model response. DEFICIT: same
        # streaming/ws transport support as above (+ a raw Response return).
        from robotlab_x.runtime.stream_routes import register_stream_routes
        register_stream_routes(self.app)

        # [static asset] GET /repo/{name}/{version}/icon returns a binary
        # SVG FileResponse, not a typed record. (Script EXECUTION moved to
        # the script model's `-request {action:"run"}`; this module now only
        # serves the icon.) DEFICIT: a way to declare a static-file / raw
        # binary route on a model.
        from robotlab_x.runtime.script_routes import register_script_routes
        register_script_routes(self.app, self.get_db_provider)

        # [dynamic aggregate] GET /v1/admin/state returns gather_state() — a
        # heterogeneous whole-runtime snapshot (cpu, memory, services, bus,
        # …), NOT a collection of uniform records. Modelling it would mean a
        # degenerate single dict-wrapper "entity". DEFICIT: a read-only
        # "singleton view" resource whose response_model is an arbitrary
        # (extra=allow) object.
        from robotlab_x.api.admin_state_api import router as admin_state_router
        self.app.include_router(admin_state_router, prefix='/v1', tags=["Admin State"])

        # [dynamic aggregate] GET /v1/bus/topics returns a live {ts, topics}
        # snapshot read straight off the in-memory bus — an aggregate, not a
        # stored collection. (The persisted `topic` model already exists,
        # data-only; this is the LIVE view.) DEFICIT: same read-only
        # aggregate-view support as admin/state.
        from robotlab_x.api.bus_api import router as bus_router
        self.app.include_router(bus_router, prefix='/v1', tags=["Bus"])

        # [live introspection] GET /v1/service-proxy/{id}/methods and
        # /topology introspect a LIVE running instance (the @service_method
        # callables + topic wiring), derived fresh per call — no stored
        # entity, and /topology is an aggregate. DEFICIT: a path-nested,
        # read-only sub-resource whose list is computed from runtime state.
        from robotlab_x.api.service_methods_api import router as service_methods_router
        self.app.include_router(service_methods_router, prefix='/v1', tags=["Service Methods"])

        # [aggregate + async actions] The registry surface is an aggregate
        # (GET /v1/registry/catalog = remote services merged with a per-type
        # local-install-state map), a config blob (GET/PUT /registry/sources),
        # and lifecycle ACTIONS (load/install/uninstall) where install runs
        # on a BACKGROUND thread streaming progress to the bus. The actions
        # fit `-request`, but there's no single record type to host them and
        # the catalog/sources aren't CRUD collections. DEFICIT: (a) attaching
        # actions to a non-CRUD/aggregate resource, and (b) async action
        # handlers (the generated -request handler is sync). See
        # docs/TODO_REPO.md.
        from robotlab_x.api.registry_api import register_registry_routes
        register_registry_routes(self.app, self.get_db_provider)

        # [filesystem sub-resource] GET/PUT/POST/DELETE
        # /v1/service-proxy/{id}/files[/content|/fork|/new-workflow|/rename]
        # is the brain's workspace+bundled-workflows file tree — a virtual
        # filesystem merged from the writable workspace and the read-only
        # bundled workflows, not a stored record collection. The router is
        # self-contained (its own auth deps); just mount it under /v1.
        # DEFICIT: a path-nested filesystem-backed sub-resource kind.
        from robotlab_x.api.brain_files_api import router as brain_files_router
        self.app.include_router(brain_files_router, prefix='/v1', tags=["Brain Files"])
        # NOTE: peer + config_set + script-run were promoted OUT of this
        # block to normal DSL models — that's the target for anything that
        # is a record collection with actions.

        # First-user enrollment (generator-managed; see app.auth.bootstrap)
        from robotlab_x.api.first_user_routes import register_first_user_routes
        register_first_user_routes(self.app, self.get_db_provider)

        # App-specific admin / debug / fixture endpoints get registered here
        # via the event_handlers hook, AFTER the generated CRUD routers, so
        # any extension routes the app provides (additional admin endpoints,
        # debug surfaces, demo-reset paths) slot in on top of the generic
        # baseline. Each app that needs them defines
        # `register_admin_routes(app)` in its (partially-managed)
        # event_handlers.py module and adds routes directly to the FastAPI
        # instance. Apps that don't define the function: silent no-op
        # (safe_invoke returns None gracefully). Use for things like demo
        # reset endpoints, per-app fixture loaders, debug introspection —
        # anything that's app-specific and doesn't belong in the generic
        # request capture or auth surfaces.
        safe_invoke(
            "robotlab_x.event_handlers",
            "register_admin_routes",
            [self.app],
        )

        # Email-first auth router. Lets the server decide whether a given
        # email should use password auth or be redirected to an SSO provider,
        # without exposing customer-branded IdP URLs pre-email-entry.
        #
        # Apps opt in by defining `on_resolve_auth(email, request)` in their
        # event_handlers.py. Apps that don't define it get the safe default
        # `{"mode": "password"}` so existing flows keep working.
        @self.app.post("/v1/auth/resolve")
        async def resolve_auth(request: Request):
            try:
                body = await request.json()
            except Exception:
                body = {}
            email = (body.get("email") or "").strip().lower() if isinstance(body, dict) else ""
            if not email:
                return JSONResponse(status_code=400, content={"error": "email is required"})
            try:
                result = safe_invoke(
                    "robotlab_x.event_handlers",
                    "on_resolve_auth",
                    [email, request],
                )
            except Exception as exc:
                logger.error(f"on_resolve_auth raised: {exc}")
                result = None
            if not isinstance(result, dict) or "mode" not in result:
                return {"mode": "password"}
            return result

        # Generic OAuth2 endpoints ....
        @self.app.get("/v1/oauth-config", response_model=AuthOauthProviderConfig)
        def get_oauth_config(request: Request):
            """
            Endpoint to retrieve OAuth2 configuration for client authentication.

            Visibility is controlled by `oauth_config_public` (default True for
            back-compat). When set to False, the route requires an authenticated
            session — used by multi-tenant deployments that don't want to leak
            customer-branded IdP URLs to unauthenticated callers.
            """
            logger.debug("--> get_oauth_config")
            if not getattr(self.settings, "oauth_config_public", True):
                current_user = self._get_authenticated_user(request)
                if not current_user:
                    raise HTTPException(status_code=404, detail="Not found")
            provider_config = on_get_oauth_provider_config(request)
            if not provider_config:
                logger.error("OAuth provider configuration not found in database")
                return JSONResponse(
                    status_code=500,
                    content={
                        "error": "OAuth provider configuration not found",
                        "detail": "Please configure OAuth provider settings."
                    }
                )

            current_user = self._get_authenticated_user(request)
            state_value = build_oauth_state(current_user.get("id") if current_user else None)
            provider_config.state = state_value

            payload = provider_config.model_dump()
            payload["auth_url"] = provider_config.authorize_url or provider_config.issuer

            logger.info(
                "OAuth config built from settings: issuer=%s, clientId=%s, redirectUri=%s",
                provider_config.issuer,
                "***" if provider_config.client_id else None,
                provider_config.redirect_uri,
            )

            missing = []
            if not provider_config.issuer:
                missing.append("issuer")
            if not provider_config.client_id:
                missing.append("client_id")
            if not provider_config.redirect_uri:
                missing.append("redirect_uri")
            if not provider_config.authorize_url:
                missing.append("authorize_url")
            if missing:
                return JSONResponse(
                    status_code=500,
                    content={
                        "error": "OAuth configuration incomplete",
                        "detail": f"Missing required configuration fields: {', '.join(missing)}. Please configure these in your server settings."
                    }
                )

            logger.info("Returning OAuth config for provider %s", provider_config.provider_id)
            return JSONResponse(payload)                

        @self.app.get("/v1/oauth/callback")
        async def oauth_callback(request: Request):
            """Exchange OAuth authorization code for tokens and delegate processing to event handlers."""
            code = request.query_params.get("code")
            state = request.query_params.get("state")
            error = request.query_params.get("error")
            logger.info(f"--> oauth_callback called with code: {code[:10] if code else None}..., state: {state}")

            if error:
                logger.error(f"OAuth provider returned error: {error}")
                raise HTTPException(status_code=400, detail=f"OAuth error: {error}")

            if not code:
                logger.error("Missing authorization code in callback")
                raise HTTPException(status_code=400, detail="Missing authorization code")

            provider_config = on_get_oauth_provider_config(request)
            if not provider_config:
                logger.error("OAuth provider configuration not found in database")
                raise HTTPException(status_code=500, detail="OAuth provider configuration missing")

            current_user = self._get_authenticated_user(request)
            state_payload = decode_oauth_state(state)
            if state_payload and state_payload.get("user_id") and current_user and state_payload["user_id"] != current_user.get("id"):
                logger.error(
                    "OAuth state mismatch: expected user %s but received %s",
                    current_user.get("id"),
                    state_payload.get("user_id"),
                )
                raise HTTPException(status_code=400, detail="OAuth state mismatch")

            token_url = provider_config.token_url
            userinfo_url = provider_config.userinfo_url
            client_id = provider_config.client_id
            client_secret = provider_config.client_secret
            redirect_uri = provider_config.redirect_uri

            missing_fields = [
                name
                for name, value in (
                    ("token_url", token_url),
                    ("userinfo_url", userinfo_url),
                    ("client_id", client_id),
                    ("redirect_uri", redirect_uri),
                )
                if not value
            ]
            if missing_fields:
                logger.error(f"OAuth provider config missing fields: {missing_fields}")
                raise HTTPException(status_code=500, detail=f"OAuth configuration incomplete: {', '.join(missing_fields)}")

            try:
                import httpx
                # FIXME - support PKCE, client_secret optional for public clients
                # create a on_get_userinfo(request) in event_handlers.py
                # on_get_userinfo() event handler to retrieve user info

                token_payload = {
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": redirect_uri,
                    "client_id": client_id,
                }
                if client_secret:
                    token_payload["client_secret"] = client_secret

                logger.info("Exchanging authorization code with provider: %s", token_url)
                async with httpx.AsyncClient() as client:
                    token_response = await client.post(
                        token_url,
                        data=token_payload,
                        headers={"Content-Type": "application/x-www-form-urlencoded"},
                    )

                logger.info("Token response status: %s", token_response.status_code)
                token_data = token_response.json()

                if token_response.status_code != 200:
                    logger.error(f"Token exchange failed: {token_data}")
                    raise HTTPException(
                        status_code=400,
                        detail=f"Token exchange failed: {token_data.get('error_description', 'Unknown error')}",
                    )

                access_token = token_data.get("access_token")
                if not access_token:
                    logger.error("No access_token in response: %s", token_data)
                    raise HTTPException(status_code=400, detail="Failed to retrieve access token")

                async with httpx.AsyncClient() as client:
                    user_response = await client.get(
                        userinfo_url,
                        headers={"Authorization": f"Bearer {access_token}"},
                    )
                    user_data = user_response.json()

                logger.info("OAuth user data retrieved: %s", user_data)

                db = self.get_db_provider()
                email = user_data.get("email") or current_user.get("email") if current_user else None
                now_ts = int(time.time())
                scopes_value = token_data.get("scope")
                scopes_list = scopes_value.split() if scopes_value else None
                expires_in = token_data.get("expires_in")
                token_expires_at = now_ts + int(expires_in) if expires_in else None

                callback_data = AuthOauthCallbackData(
                    id=str(uuid.uuid4()),
                    user_id=current_user.get("id") if current_user else None,
                    email=email,
                    access_token=access_token,
                    refresh_token=token_data.get("refresh_token"),
                    expires_in=expires_in,
                    token_expires_at=token_expires_at,
                    token_issued_at=now_ts,
                    last_used=now_ts,
                    created_at=now_ts,
                    provider=provider_config.provider_id,
                    type=provider_config.provider_id,
                    status="active",
                    scope=scopes_value,
                    scopes=scopes_list,
                    token_type=token_data.get("token_type"),
                    id_token=token_data.get("id_token"),
                    redirect_uri=redirect_uri,
                    color=None,
                    userinfo=user_data,
                    profile=user_data,
                    app_client_id=client_id,
                    auth_url=provider_config.authorize_url,
                    access_type=provider_config.access_type,
                    prompt=provider_config.prompt,
                    additional_info={"state": state},
                    raw_response=token_data,
                )

                response_payload = on_oauth_callback(callback_data, user_data, request)
                if response_payload is None:
                    response_payload = user_data

                # Mint a server-issued session so the UI stops depending on Okta's
                # short-lived access_token and Okta-issued refresh_token. From this
                # point on the UI sees an HS256 JWT this API can verify locally,
                # plus a UUID refresh_token backed by the auth_session table.
                session_email = (email or user_data.get("email") or "").strip().lower()
                if session_email:
                    server_user = {
                        "id": session_email,
                        "email": session_email,
                        "username": user_data.get("username") or session_email,
                        "name": user_data.get("name"),
                        "groups": user_data.get("groups") or [],
                        "roles": user_data.get("roles") or [],
                        "auth_provider": provider_config.provider_id,
                    }
                    try:
                        server_access_token = self.auth.generate_token(server_user, ttl_minutes=on_get_jwt_access_token_ttl_minutes(request))
                        server_refresh_token = str(uuid.uuid4())
                        refresh_token_hash = hash_refresh_token(server_refresh_token)
                        now_ms = int(time.time() * 1000)
                        session_id = f"sess_{uuid.uuid4().hex[:16]}"

                        # Upsert a user record so /v1/refresh-token can find this user
                        # later and mint a new JWT. The refresh endpoint reads the user
                        # table for roles/groups; for OAuth users we keep that row
                        # synced with the latest IdP-supplied attributes on every login.
                        existing_user = db.get_item("user", session_email) or {}
                        user_record = {
                            **existing_user,
                            "id": session_email,
                            "email": session_email,
                            # OIDC `name` claim maps to AuthUser.fullname; AuthUser has no `name` column.
                            "fullname": user_data.get("name") or existing_user.get("fullname"),
                            "given_name": user_data.get("given_name") or existing_user.get("given_name"),
                            "family_name": user_data.get("family_name") or existing_user.get("family_name"),
                            "roles": server_user["roles"] or existing_user.get("roles") or [],
                            "external_id": user_data.get("sub") or existing_user.get("external_id"),
                            "email_verified": user_data.get("email_verified", existing_user.get("email_verified", True)),
                            "auth_provider": provider_config.provider_id,
                            "status": existing_user.get("status") or "active",
                            "last_login": now_ms,
                            "modified": now_ms,
                        }
                        if existing_user:
                            db.update_item("user", session_email, user_record)
                        else:
                            user_record["created"] = now_ms
                            try:
                                db.insert_item("user", session_email, user_record)
                            except Exception as e:
                                logger.warning(f"insert user failed, fallback to update: {e}")
                                db.update_item("user", session_email, user_record)

                        auth_session = {
                            "id": session_id,
                            "user_id": session_email,
                            "tenant_id": user_data.get("tenant_id"),
                            "refresh_token_hash": refresh_token_hash,
                            "status": "active",
                            "created": now_ms,
                            "expires_at": now_ms + (on_get_auth_session_ttl_seconds(request) * 1000),
                            "last_used_at": now_ms,
                            **session_client_metadata(request),
                        }
                        try:
                            db.insert_item("auth_session", session_id, auth_session)
                        except Exception as e:
                            logger.warning(f"insert auth_session failed, fallback to update: {e}")
                            db.update_item("auth_session", session_id, auth_session)

                        response_payload["access_token"] = server_access_token
                        response_payload["refresh_token"] = server_refresh_token
                        response_payload["token_type"] = "bearer"
                    except Exception as e:
                        logger.error(f"Failed to mint server-issued session: {e}")
                        # Don't fail the login; the Okta-passthrough payload still works
                        # for endpoints that don't strictly validate the access token.

                return response_payload

            except HTTPException:
                # Re-raise HTTP exceptions as they are already properly formatted
                raise
            except Exception as e:
                logger.error(f"OAuth callback error: {e}")
                logger.error(f"Exception type: {type(e).__name__}")
                logger.error(f"Exception args: {e.args}")
                import traceback
                logger.error(f"Full traceback: {traceback.format_exc()}")
                raise HTTPException(status_code=500, detail=f"OAuth callback failed: {str(e)}")


        @self.app.get("/v1/oauth/logout")
        async def oauth_logout(request: Request, db: DatabaseAdapter = Depends(self.get_db_provider)):
            """
            Generic OAuth2 logout handler.
            Constructs logout URL and redirects to OAuth provider.

            This is the path the SPA actually uses to sign out (a top-level
            browser redirect), so it is also where we tear down the server-side
            auth_session rows — POST /v1/logout is never reached by the SPA.
            """
            logger.debug("--> oauth_logout")
            try:
                provider_config = on_get_oauth_provider_config(request)
                if not provider_config or not provider_config.logout_url:
                    logger.error("OAuth logout URL not configured")
                    raise HTTPException(status_code=500, detail="OAuth logout URL not configured")

                id_token_hint = request.query_params.get("id_token_hint")

                # Best-effort: delete this user's active sessions before bouncing
                # to the IdP. The id_token_hint carries the user identity (email);
                # we decode its claims WITHOUT signature verification — it only
                # scopes a delete of the caller's own sessions (logging out is not
                # a privilege escalation), and verifying would require the IdP's
                # JWKS here. Identity must match auth_session.user_id, which for
                # OAuth logins is the lowercased email.
                _delete_sessions_for_id_token(db, id_token_hint)

                post_logout_redirect_uri = (
                    request.query_params.get("post_logout_redirect_uri")
                    or provider_config.redirect_uri
                    or f"{request.url.scheme}://{request.url.netloc}/"
                )

                params = {"post_logout_redirect_uri": post_logout_redirect_uri}
                if id_token_hint:
                    params["id_token_hint"] = id_token_hint

                logout_url = f"{provider_config.logout_url}?{urlencode(params)}"
                logger.info(f"Redirecting to logout URL: {logout_url}")
                return RedirectResponse(url=logout_url)

            except HTTPException:
                raise
            except Exception as e:
                logger.error(f"OAuth logout error: {e}")
                raise HTTPException(status_code=500, detail=f"OAuth logout failed: {str(e)}")

        from robotlab_x.error_util import setup_error_handlers
        setup_error_handlers(self.app)

        @self.app.post("/v1/register", description="Create a new registration", response_model=ServiceResponseMessage)
        def create_registration(registration: Registration, request: Request, db: DatabaseAdapter = Depends(self.get_db_provider)):
            logger.debug(f"--> create registration: {registration}")
            if not registration.email:
                raise HTTPException(status_code=422, detail="email is required")
            if not registration.password:
                raise HTTPException(status_code=422, detail="password is required")
            import re as _re
            if not _re.match(r'^[^@]+@[^@]+\.[^@]+$', registration.email):
                raise HTTPException(status_code=422, detail="invalid email format")
            registration.email = registration.email.lower()
            try:
                if db:
                    # Check if user already exists
                    existing_user = db.get_item("user", registration.email)
                    if existing_user:
                        raise HTTPException(status_code=400, detail="User already registered")
                    
                    # Check if registration already exists
                    existing_registrations = db.query_items("registration", {"email": registration.email})
                    if existing_registrations:
                        raise HTTPException(status_code=400, detail="Registration already pending verification")
                    
                    if not registration.client_base_url:
                        registration.client_base_url = (
                            request.headers.get("origin")
                            or self.settings.base_url
                            or f"{request.url.scheme}://{request.url.netloc}"
                        )
                    registration.verification_token = str(uuid.uuid4())
                    registration.id = registration.verification_token
                    registration.password_hash = self.auth.generate_hash(registration.password)
                    registration.password = None
                    registration.created = int(time.time() * 1000)  # Milliseconds
                    registration.state = "registered"  # Initial state
                    if not registration.user_id:
                        registration.user_id = registration.email
                    
                    db.insert_item("registration", registration.id, registration.model_dump())
                    logger.info(f"Registration created for {registration.email} with state=registered")

                    try:
                        send_verification_email(self.settings, registration)
                    except Exception as email_err:
                        logger.warning(f"Verification email not sent (continuing): {email_err}")

                safe_invoke("robotlab_x.event_handlers", "on_new_registration", [registration, request])

            except HTTPException:
                raise
            except Exception as e:
                logger.error(f"Error creating registration: {e}")
                raise HTTPException(status_code=500, detail=str(e))
            return info_message("Registration created successfully")

        @self.app.get("/v1/verify/{token}", description="Verify a user's email", response_model=ServiceResponseMessage)
        def verify(token: str, request: Request, db: DatabaseAdapter = Depends(self.get_db_provider)):
            logger.debug(f"--> verify email: {token}")
            try:
                return verify_and_register(token)
            except Exception as e:
                logger.error(f"Error verifying email: {e}")
                raise HTTPException(status_code=500, detail=str(e))

        @self.app.post("/v1/login", description="Login using JSON POST", response_model=LoginResponse)
        async def login(request: LoginRequest, fastapi_request: Request, db: DatabaseAdapter = Depends(self.get_db_provider)):
            """
            Login endpoint that accepts both form and JSON requests.

            `request` is the parsed JSON/form body (LoginRequest); `fastapi_request`
            is the raw Starlette Request, injected so we can capture the client's
            user-agent and IP for the auth_session row.
            """
            try:
                user_id = request.username
                password = request.password
                
                if not user_id or not password:
                    raise HTTPException(status_code=401, detail="Invalid credentials")
                
                logger.info(f"Received login request for user: {user_id}")
                user_id = user_id.lower()
                user = db.get_item("user", user_id)
                if not user:
                    logger.warning(f"User not found: {user_id}")
                    raise HTTPException(status_code=401, detail="Invalid credentials")

                user_status = user.get("status")
                if user_status in ("disabled", "locked"):
                    logger.warning(f"Login denied for {user_status} user: {user_id}")
                    raise HTTPException(status_code=403, detail="Account is not active")
                
                token = self.auth.authenticate(user_id, password, ttl_minutes=on_get_jwt_access_token_ttl_minutes(request))
                if not token:
                    logger.warning(f"Authentication failed for user: {user_id}")
                    raise HTTPException(status_code=401, detail="Invalid credentials")
                
                # Generate refresh token and store session
                refresh_token = str(uuid.uuid4())
                refresh_token_hash = hash_refresh_token(refresh_token)
                
                # Create auth_session record
                now_ms = int(time.time() * 1000)
                session_id = f"sess_{uuid.uuid4().hex[:16]}"
                expires_at = now_ms + (on_get_auth_session_ttl_seconds(request) * 1000)
                
                auth_session = {
                    "id": session_id,
                    "user_id": user["id"],
                    "tenant_id": user.get("tenant_id"),
                    "refresh_token_hash": refresh_token_hash,
                    "status": "active",
                    "created": now_ms,
                    "expires_at": expires_at,
                    "last_used_at": now_ms,
                    **session_client_metadata(fastapi_request),
                }
                
                try:
                    db.insert_item("auth_session", session_id, auth_session)
                except Exception as e:
                    logger.warning(f"Failed to create auth_session, falling back to update: {e}")
                    db.update_item("auth_session", session_id, auth_session)

                safe_invoke(
                    "robotlab_x.event_handlers",
                    "on_login",
                    [user, request, {"mfa_required": bool(user.get("is_mfa_enabled"))}],
                )
                
                if user.get("is_mfa_enabled"):
                    return {"mfa_required": True, "message": "MFA verification required"}
                
                return {"access_token": token, "token_type": "bearer", "refresh_token": refresh_token}
            
            except HTTPException:
                raise
            except Exception as e:
                logger.error(f"Login error: {str(e)}")
                raise HTTPException(status_code=401, detail="Invalid credentials")

        @self.app.post("/v1/mfa/login")
        def mfa_login(request: MFAVerifyRequest, db: DatabaseAdapter = Depends(self.get_db_provider)):
            try:
                from auth import mfa
                request.username = request.username.lower()
                user = db.get_item("user", request.username)
                if not user or not user.get("totp_secret"):
                    raise HTTPException(status_code=400, detail="MFA not set up")
                user_status = user.get("status")
                if user_status in ("disabled", "locked"):
                    logger.warning(f"MFA login denied for {user_status} user: {request.username}")
                    raise HTTPException(status_code=403, detail="Account is not active")
                totp_secret = user["totp_secret"]
                logger.info(f"Verifying TOTP for user: {request.username}")
                if not mfa.verify_totp(secret=user.get("totp_secret"), code=request.code, valid_window=5):
                    logger.warning(f"Invalid TOTP code for user: {request.username}")
                    raise HTTPException(status_code=401, detail="Invalid TOTP code")
                token = self.auth.generate_token(user, ttl_minutes=on_get_jwt_access_token_ttl_minutes(http_request))
                logger.info(f"MFA login successful for user: {request.username}")
                return {"access_token": token, "token_type": "bearer"}
            except ImportError:
                logger.error("MFA module is not available.")
                raise HTTPException(status_code=500, detail="MFA functionality is not enabled.")
            except Exception as e:
                logger.error(f"Error during MFA login: {e}")
                raise HTTPException(status_code=500, detail="Failed to process MFA login")

        @self.app.post("/v1/forgot-password", description="Send a password reset email")
        def forgot_password(request: ForgotPasswordRequest, db: DatabaseAdapter = Depends(self.get_db_provider)):
            logger.debug(f"Received forgot password request: {request.dict()}")
            try:
                user = db.get_item("user", request.email)
                if not user:
                    raise HTTPException(status_code=404, detail="User not found")
                reset_token = str(uuid.uuid4())
                user["reset_token"] = reset_token
                user["reset_token_expiry"] = int(time.time()) + 3600
                db.update_item("user", user["id"], user)
                send_reset_password_email(
                    config=self.settings,
                    user_email=request.email,
                    reset_token=reset_token,
                )
                logger.info(f"Password reset email sent to {request.email}")
            except Exception as e:
                logger.error(f"Error handling forgot password request: {e}")
                raise HTTPException(status_code=500, detail="Failed to process forgot password request")
            return info_message("Password reset email sent successfully")

        @self.app.post("/v1/reset-password", description="Reset the user's password")
        def reset_password(request: ResetPasswordRequest, db: DatabaseAdapter = Depends(self.get_db_provider)):
            logger.debug(f"Received reset password request: {request.dict()}")
            try:
                users = db.query_items("user", {"reset_token": request.resetToken})
                if not users or len(users) == 0:
                    raise HTTPException(status_code=404, detail="Invalid or expired reset token")
                user = users[0]
                if int(time.time()) > user["reset_token_expiry"]:
                    raise HTTPException(status_code=400, detail="Reset token has expired")
                user["password_hash"] = self.auth.generate_hash(request.newPassword)
                user["reset_token"] = None
                user["reset_token_expiry"] = None
                db.update_item("user", user["id"], user)
                logger.info(f"Password reset successfully for user: {user['id']}")
            except Exception as e:
                logger.error(f"Error resetting password: {e}")
                raise HTTPException(status_code=500, detail="Failed to reset password")
            return info_message("Password reset successfully")

        @self.app.post("/v1/refresh-token", response_model=RefreshTokenResponse)
        async def refresh_token(token_request: RefreshTokenRequest, http_request: Request, db: DatabaseAdapter = Depends(self.get_db_provider)):
            try:
                # Hash the incoming refresh token to compare with stored hash
                refresh_token_hash = hash_refresh_token(token_request.refresh_token)
                
                # Query auth_session table by refresh_token_hash
                sessions = db.query_items("auth_session", {"refresh_token_hash": refresh_token_hash})
                if sessions and len(sessions) > 0:
                    session = sessions[0]
                    
                    # Validate session status and expiry
                    now_ms = int(time.time() * 1000)
                    if session.get("status") != "active":
                        raise HTTPException(status_code=401, detail="Session is not active")
                    
                    if session.get("expires_at") and now_ms > session["expires_at"]:
                        # Mark as expired
                        session["status"] = "expired"
                        db.update_item("auth_session", session["id"], session)
                        raise HTTPException(status_code=401, detail="Refresh token expired")

                    # Idle-timeout enforcement (sliding). Disabled when the hook returns < 1.
                    idle_timeout_s = on_get_auth_session_idle_timeout_seconds(http_request)
                    if idle_timeout_s and idle_timeout_s > 0:
                        last_used = session.get("last_used_at") or session.get("created")
                        if last_used and (now_ms - last_used) > (idle_timeout_s * 1000):
                            session["status"] = "expired"
                            db.update_item("auth_session", session["id"], session)
                            raise HTTPException(status_code=401, detail="Session idle timeout exceeded")

                    # Get user to generate new access token
                    user_id = session.get("user_id")
                    if not user_id:
                        raise HTTPException(status_code=401, detail="Invalid session")
                    
                    user = db.get_item("user", user_id)
                    if not user:
                        raise HTTPException(status_code=401, detail="User not found")
                    
                    # Generate new access token
                    new_access_token = self.auth.generate_token(user, ttl_minutes=on_get_jwt_access_token_ttl_minutes(http_request))
                    
                    # Optionally rotate refresh token for better security
                    new_refresh_token = str(uuid.uuid4())
                    new_refresh_token_hash = hash_refresh_token(new_refresh_token)
                    
                    # Update session with new token hash and last_used_at
                    session["refresh_token_hash"] = new_refresh_token_hash
                    session["last_used_at"] = now_ms
                    db.update_item("auth_session", session["id"], session)
                    
                    return {"access_token": new_access_token, "token_type": "bearer", "refresh_token": new_refresh_token}

                provider_config = on_get_oauth_provider_config(http_request)
                if not provider_config or not provider_config.token_url or not provider_config.client_id:
                    raise HTTPException(status_code=401, detail="Invalid refresh token")

                import httpx

                token_payload = {
                    "grant_type": "refresh_token",
                    "refresh_token": token_request.refresh_token,
                    "client_id": provider_config.client_id,
                }
                if provider_config.client_secret:
                    token_payload["client_secret"] = provider_config.client_secret

                logger.info("Refreshing OAuth access token with provider: %s", provider_config.token_url)
                async with httpx.AsyncClient() as client:
                    token_response = await client.post(
                        provider_config.token_url,
                        data=token_payload,
                        headers={"Content-Type": "application/x-www-form-urlencoded"},
                    )

                token_data = token_response.json()
                if token_response.status_code != 200:
                    logger.error("OAuth token refresh failed: %s", token_data)
                    raise HTTPException(
                        status_code=401,
                        detail=token_data.get("error_description") or token_data.get("error") or "Could not refresh token",
                    )

                access_token = token_data.get("access_token")
                if not access_token:
                    raise HTTPException(status_code=401, detail="Could not refresh token")

                refreshed_refresh_token = token_data.get("refresh_token") or token_request.refresh_token
                expires_in = token_data.get("expires_in")
                if expires_in is not None:
                    try:
                        expires_in = int(expires_in)
                    except (TypeError, ValueError):
                        expires_in = None

                return {
                    "access_token": access_token,
                    "token_type": token_data.get("token_type") or "bearer",
                    "refresh_token": refreshed_refresh_token,
                    "expires_in": expires_in,
                    "id_token": token_data.get("id_token"),
                }
            except HTTPException:
                raise
            except Exception as e:
                logger.error(f"Error refreshing token: {e}")
                raise HTTPException(status_code=401, detail="Could not refresh token")

        @self.app.post("/v1/logout", description="Logout the current user")
        async def logout(request: Request, db: DatabaseAdapter = Depends(self.get_db_provider)):
            try:
                # Extract token from Authorization header
                auth_header = request.headers.get("authorization")
                if not auth_header or not auth_header.lower().startswith("bearer "):
                    raise HTTPException(status_code=401, detail="Missing or invalid authorization header")
                token = auth_header.split(" ", 1)[1]
                # Decode token to get user info
                user = None
                try:
                    payload = self.auth._verify_jwt(token)
                    username = payload.get("sub")
                    if username:
                        user = db.get_item("user", username)
                except Exception:
                    pass
                if not user:
                    raise HTTPException(status_code=401, detail="Invalid token or user not found")
                
                # Delete all active auth_sessions for this user
                # Best practice: DELETE sessions on logout, don't just mark inactive
                deleted_count = 0
                try:
                    # Query for active sessions
                    sessions = db.query_items("auth_session", {"user_id": user["id"], "status": "active"})
                    logger.info(f"Found {len(sessions)} active sessions for user {user['id']}")
                    
                    for session in sessions:
                        try:
                            db.delete_item("auth_session", session["id"])
                            deleted_count += 1
                            logger.info(f"Deleted auth_session {session['id']} for user {user['id']}")
                        except Exception as del_err:
                            logger.error(f"Failed to delete session {session['id']}: {del_err}")
                    
                    if deleted_count == 0 and len(sessions) == 0:
                        logger.warning(f"No active sessions found for user {user['id']} - may have already been logged out")
                        
                except Exception as e:
                    logger.error(f"Failed to query/delete auth_sessions during logout: {e}", exc_info=True)
                    # Don't fail the logout if session cleanup fails
                
                # Invalidate token and refresh token on user record
                user["token"] = None
                user["refresh_token"] = None
                db.update_item("user", user["id"], user)
                
                logger.info(f"Logout successful for user {user['id']}, deleted {deleted_count} sessions")
                return info_message("Logout successful")
            except HTTPException:
                raise
            except Exception as e:
                logger.error(f"Logout error: {str(e)}")
                raise HTTPException(status_code=500, detail="Logout failed")

        # Special route for OAuth callback (if UI is present)
        if getattr(self, 'ui_base_dir', None):
            @self.app.get('/callback')
            def _serve_callback_html():
                target_html = os.path.join(self.ui_base_dir, 'callback.html')
                target_index = os.path.join(self.ui_base_dir, 'callback', 'index.html')
                if os.path.exists(target_html):
                    logger.info(f"Serving /callback via {target_html}")
                    return FileResponse(target_html)
                if os.path.exists(target_index):
                    logger.info(f"Serving /callback via {target_index}")
                    return FileResponse(target_index)
                logger.warning("/callback(.html) not found; returning 404")
                raise HTTPException(status_code=404, detail="callback not found")

    def _get_authenticated_user(self, request: Request) -> Optional[dict]:
        """Extract the authenticated user from the Authorization header if available."""
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            return None
        token = auth_header.split(" ", 1)[1].strip()
        if not token:
            return None
        try:
            return self.auth.get_user(token)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning(f"Failed to resolve user from token: {exc}")
            return None

    def get_db_provider(self) -> DatabaseAdapter:
        # TODO add config option for get_database_client(settings.db_name)
        return get_database_client()        

    def _scrub_headers(self, headers: dict[str, str]) -> dict[str, str]:
        scrubbed: dict[str, str] = {}
        for key, value in headers.items():
            if key.lower() in SENSITIVE_HEADER_NAMES:
                scrubbed[key] = "[REDACTED]"
            else:
                scrubbed[key] = value
        return scrubbed

    def _render_body(self, body_bytes: bytes, content_type: Optional[str]) -> Any:
        if not body_bytes:
            return None

        lower_content_type = (content_type or "").lower()
        if "application/json" in lower_content_type:
            try:
                return json.loads(body_bytes.decode("utf-8"))
            except Exception:
                pass

        try:
            return body_bytes.decode("utf-8")
        except UnicodeDecodeError:
            return base64.b64encode(body_bytes).decode("ascii")

    def _clear_request_buffer(self) -> int:
        cleared = len(self._request_buffer)
        self._request_buffer.clear()
        return cleared


    async def run(self):
        """Runs the application asynchronously."""
        import uvicorn
        from uvicorn import Config, Server
        logging.info(f"Version: {version}")
        logging.info(f"Running on port: {self.settings.port}")
        config_kwargs = {
            "app": self.app,
            "host": "0.0.0.0",
            "port": self.settings.port,
            "reload": False
        }
        access_log_enabled = getattr(self.settings, "log_uv_access_enabled", None)
        if access_log_enabled is not None:
            config_kwargs["access_log"] = access_log_enabled
            logging.info("Uvicorn access log enabled: %s", access_log_enabled)
        if self.settings.ssl_enabled:
            logging.info("SSL enabled")
            generate_self_signed_cert()
            config_kwargs["ssl_keyfile"] = "ssl/key.pem"
            config_kwargs["ssl_certfile"] = "ssl/cert.pem"
        config = Config(**config_kwargs)
        server = Server(config)
        await server.serve()

if __name__ == "__main__":
    settings_obj, config_provider = create_app_settings("robotlab_x", RobotlabXConfig)
    settings: RobotlabXConfig = settings_obj.to_config()
    logger.info(f"App Setting: {json.dumps(settings.model_dump(), indent=2)}")

    app_server = AppServer(settings)
    import asyncio
    asyncio.run(app_server.run())
