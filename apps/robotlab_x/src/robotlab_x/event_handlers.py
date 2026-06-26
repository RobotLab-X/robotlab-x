# unmanaged
from fastapi import Request
from database.interface import DatabaseAdapter
from config import get_settings
from models.auth_oauth_provider_config import AuthOauthProviderConfig
from models.auth_oauth_callback_data import AuthOauthCallbackData
from models.auth_session import AuthSession
from models.database_tinydb_config import DatabaseTinydbConfig
from database.factory import create_database_client, get_database_client
from robotlab_x.models.config import Config as RobotlabXConfig
from robotlab_x.models.user import User
from robotlab_x.models.registration import Registration
from robotlab_x.models.service_meta import ServiceMeta
from robotlab_x.models.service_proxy import ServiceProxy
from robotlab_x.models.service_config import ServiceConfig
from robotlab_x.models.service_request import ServiceRequest
from robotlab_x.models.workspace import Workspace
from robotlab_x.runtime.catalog import reconcile_catalog
from robotlab_x.runtime.workspaces import (
    ensure_runtime_workspace,
    reconcile_running_proxies,
    restore_active_workspaces,
)
from robotlab_x.runtime import discovery as _discovery
from robotlab_x.runtime import bus_stats as _bus_stats
from robotlab_x.runtime import reconciler as _reconciler
from robotlab_x.runtime import identity as _identity
from robotlab_x.runtime import peer_manager as _peer_manager
from robotlab_x.runtime import mdns as _mdns
from robotlab_x.runtime.bus import get_bus
import asyncio
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional
import logging

logger = logging.getLogger(__name__)


def _bridge_jwt_secret() -> None:
    """Bridge ``ROBOTLAB_X_JWT_SECRET`` from .env to ``JWT_SECRET_KEY``
    in the environment if the latter isn't already set.

    The auth packages (``packages/auth``) all read ``JWT_SECRET_KEY``
    directly from ``os.environ``. The robotlab_x convention in
    ``.env`` files is to name the same value ``ROBOTLAB_X_JWT_SECRET``
    (alongside every other ``ROBOTLAB_X_*`` knob). Without this
    bridge the .env value is dead code and the auth code silently
    falls back to ``"fallback_dev_key"`` — which works in isolation
    but breaks federation the moment one runtime DOES set
    ``JWT_SECRET_KEY`` and another doesn't (peers signing with
    different secrets → 403 at handshake).

    Direct ``JWT_SECRET_KEY`` env var takes precedence so power users
    can override per-run without editing .env.
    """
    import os
    if os.environ.get("JWT_SECRET_KEY"):
        return
    bridge = os.environ.get("ROBOTLAB_X_JWT_SECRET")
    if bridge:
        os.environ["JWT_SECRET_KEY"] = bridge
        logger.info("auth: bridged ROBOTLAB_X_JWT_SECRET → JWT_SECRET_KEY")


def on_startup():
    # Install the runtime-log ring buffer first so it captures the rest of
    # startup (the Logs page reads it via GET /v1/logs).
    from robotlab_x.runtime import log_bus
    log_bus.install()

    # Serialize the exact launch command so POST /v1/system/restart can
    # re-exec it (incl. any CLI args) — see runtime/system.py.
    from robotlab_x.runtime import system
    system.record_start_command()

    # Bridge BEFORE any auth code (subprocess_auth, jwt_util) reads
    # the env var. settings hasn't loaded yet but load_dotenv ran in
    # main.py before us, so ROBOTLAB_X_JWT_SECRET is already in env.
    _bridge_jwt_secret()


    settings: RobotlabXConfig = get_settings()

    # Resolve + cache the runtime_id BEFORE anything that might call
    # ``get_runtime_id()`` with no args (in-process service base
    # classes, services_index publisher, etc.). If we wait until later
    # in startup, the first no-arg caller wins and the cache gets
    # populated from the persisted file — settings.runtime_id is
    # silently ignored.
    runtime_id = _identity.get_runtime_id(
        data_dir=getattr(settings, "data_dir", None),
        settings_runtime_id=getattr(settings, "runtime_id", None),
    )
    logger.info("runtime.identity: resolved id=%s (data_dir=%s)",
                runtime_id, getattr(settings, "data_dir", None))

    # Phase 1 ships with the lowdb / TinyDB backend by default. The PRD
    # treats "install light" as a core principle, so the boot path stays
    # Postgres-free until a user explicitly opts in.
    #
    # Database files live under ``<data_dir>/databases/`` — co-located
    # with the runtime_id so a per-instance data dir (sibling runtimes on
    # the same box use distinct ROBOTLAB_X_DATA_DIR values) keeps every
    # working file isolated. (robotlab_x onboards via first_user_claim, so
    # there is no admin_password.txt.)
    _databases_dir = str(Path(settings.data_dir or "data") / "databases")
    create_database_client(DatabaseTinydbConfig(
        name="default",
        data_dir=_databases_dir,
    ))
    db: DatabaseAdapter = get_database_client()
    if not db:
        logger.error("Database client not created.")
        raise Exception("Database client not created.")

    db.ensure_table(model=AuthSession)
    db.ensure_table(model=Registration)
    db.ensure_table(model=User)
    db.ensure_table(model=ServiceMeta)
    db.ensure_table(model=ServiceProxy)
    db.ensure_table(model=ServiceConfig)
    db.ensure_table(model=ServiceRequest)
    db.ensure_table(model=Workspace)

    # Reconcile the service catalog against the on-disk repo. Adds new
    # packages, refreshes changed ones, removes rows whose package is
    # gone. Idempotent — safe to run on every boot.
    from robotlab_x.runtime import registry as _registry
    from robotlab_x.runtime.repo import writable_repo_dir
    # The writable root is where loads/installs land; downstream boot
    # (config-set provisioning) still threads it through for any writes.
    repo_dir = writable_repo_dir(settings)
    # Effective roots honour user-edited config/default.repo_paths over
    # env, so a UI-managed repo list takes effect on the next boot.
    roots = _registry.effective_repo_roots(settings, db)

    # Sideload (Phase 6): extract any archives an operator dropped in
    # <writable-root-parent>/repo-staging/ into the writable repo before
    # we reconcile, so air-gapped installs appear as LOADED types. No-op
    # when the dir is absent.
    try:
        staging = repo_dir.parent / "repo-staging"
        sl = _registry.sideload_dir(staging, repo_dir=repo_dir, db=db, reconcile_roots=roots)
        if sl.get("loaded") or sl.get("failed"):
            logger.info("sideload: %s", sl)
    except Exception:  # noqa: BLE001
        logger.warning("sideload scan failed (non-fatal)", exc_info=True)

    reconcile_catalog(db, roots)

    # Seed the singleton config/default row if missing. The UI's
    # ConfigPage GETs /v1/config/default on load; without a seeded row
    # it would 404 every time a fresh deployment boots.
    if not db.get_item("config", "default"):
        default_cfg = settings.model_dump()
        default_cfg["id"] = "default"
        default_cfg.setdefault("created_at", datetime.now(timezone.utc).isoformat())
        db.insert_item("config", "default", default_cfg)
        logger.info("Seeded config/default from env settings")

    # Start the subprocess discovery listener BEFORE reconcile so that
    # subprocess services that survived our restart get a chance to
    # announce themselves with a 'hello' before we go spawning new ones.
    _discovery.start()

    # Throttled per-topic publish-rate digest on /bus/stats — feeds the
    # Composer's live-flow overlay without exposing per-message traffic.
    _bus_stats.start()

    # Materialize the singleton "runtime" workspace (kind='runtime', id='runtime').
    # Its members are computed at read-time from the registry, but the row
    # itself owns the persistent canvas layout + edges.
    ensure_runtime_workspace(db)

    # Sync the active config set on disk → service_proxy rows. On first
    # boot under the new system the migrator writes yml files from the
    # existing rows; on every boot after that, the yml files become
    # authoritative and any drift propagates row-ward.
    # See docs/TODO_CONFIG_SETS.md for the contract.
    from robotlab_x.runtime.boot import boot_from_config_set
    from robotlab_x.runtime.config_sets import pin_booted_set
    data_dir_path = Path(settings.data_dir or "data")
    if not data_dir_path.is_absolute():
        data_dir_path = Path.cwd() / data_dir_path
    # Pin the active set for the life of this process BEFORE any provisioning
    # or runtime config-set I/O — a later UI "switch" rewrites the marker for
    # the next boot only and must not retarget the live process's writes.
    pin_booted_set()
    boot_report = boot_from_config_set(db, repo_dir, data_dir_path)
    logger.info("boot.config_set: %s", {
        k: v for k, v in boot_report.items() if k != "sync_actions"
    })

    # Bring back every service that was running when we shut down. Their
    # service_proxy rows still say 'running' but the processes are gone;
    # this resets them to 'stopped' and fires start_service. After this,
    # workspace.activated_at gets re-stamped where applicable.
    reconcile_running_proxies(db)
    restore_active_workspaces(db)

    # Periodic reconciler — converges drift unconditionally. Without it
    # we depend on every lifecycle event reaching every consumer, which
    # has historically been brittle (UI tab caches, dropped frames mid-
    # restart, orphan subprocesses surviving a crash, etc.).
    _reconciler.start()

    # ─── Runtime identity (multi-runtime federation, step 1) ──────────
    # Resolve once and persist; this id is the future ``@<id>`` topic
    # suffix that lets peer runtimes address us. Two override knobs:
    #   * RLX_RUNTIME_ID env var (direct, highest-priority env knob)
    #   * ROBOTLAB_X_RUNTIME_ID in .env → settings.runtime_id (standard
    #     pydantic-settings path; what most users will reach for since
    #     it's symmetrical with PORT, DATABASE_DIR, etc.)
    # See runtime/identity.py for the full priority order + format
    # rules.
    # runtime_id was resolved at the top of on_startup so in-process
    # services see the correct value during their boot; here we just
    # read the cached value.
    runtime_id = _identity.get_runtime_id()
    # Step 2a: hand the id to the bus so it can recognise self-suffixed
    # topics (``/foo@<this-runtime>`` → ``/foo`` local) and route
    # other-suffixed ones to the peer manager.
    get_bus().set_local_id(runtime_id)
    _publish_runtime_info(db, runtime_id, settings)

    # Step 2c: bind the FastAPI loop to the peer manager so cross-thread
    # bus.publish_sync callers (sync FastAPI workers) can still send
    # frames upstream to peers.
    try:
        loop = asyncio.get_running_loop()
        _peer_manager.bind_loop(loop)
    except RuntimeError:
        # on_startup is currently called from a sync context. The
        # bind happens on first call from an async context instead.
        pass

    # Step 2d: autoconnect to peers persisted in the runtime singleton's
    # service_config.peers. Each entry is a WS URL; the manager
    # idempotently dedupes so a manual POST /v1/peers/connect of the
    # same URL is a no-op. Connection happens lazily — these calls
    # return immediately; identification + bridging proceeds in the
    # background.
    runtime_row = db.get_item("service_proxy", "runtime") or {}
    runtime_cfg = runtime_row.get("service_config") or {}
    peer_urls = runtime_cfg.get("peers") or []
    for url in peer_urls:
        try:
            _peer_manager.connect(url)
            logger.info("peer_manager.boot: dialed persisted peer %s", url)
        except Exception:  # noqa: BLE001
            logger.exception("peer_manager.boot: failed to dial %s", url)

    # mDNS auto-discovery. Defaults: enabled + auto-connect to any
    # discovered peer. User can opt out by setting either flag false
    # in runtime.service_config.{mdns_enabled, mdns_auto_connect}.
    if runtime_cfg.get("mdns_enabled", True):
        try:
            port = int(settings.port) if hasattr(settings, "port") else 8998
            _mdns.start(
                runtime_id=runtime_id,
                port=port,
                version=_read_version(),
                auto_connect=bool(runtime_cfg.get("mdns_auto_connect", True)),
            )
        except Exception:  # noqa: BLE001
            logger.exception("mdns.start failed — discovery disabled this boot")

    # Start the runtime's own /runtime/runtime/state publisher — system
    # + process metrics every few seconds. The publisher is internally
    # idempotent so multiple on_startup invocations (HMR, test reuse)
    # don't stack tasks.
    try:
        from robotlab_x.runtime import system_state
        system_state.start_publisher(proxy_id="runtime", interval_s=3.0)
    except Exception:  # noqa: BLE001
        logger.exception("runtime.system_state: failed to start publisher")

    # Start the runtime's services-index publisher — aggregates every
    # service's /<type>/<id>/meta retained topic into a single
    # /runtime/runtime/services digest so consumers have a single
    # entry point to enumerate everything running in this process.
    try:
        from robotlab_x.runtime import services_index
        services_index.start_publisher()
    except Exception:  # noqa: BLE001
        logger.exception("runtime.services_index: failed to start publisher")

    # Start the runtime's types-index publisher — introspects every
    # registered service type's config_class, @service_method args,
    # and optional state/topic schemas, publishing JSON Schemas keyed
    # by type-name to /runtime/runtime/types/<type>. The schema home
    # for instances that reference a type by key in their meta payload.
    try:
        from robotlab_x.runtime import types_index
        types_index.start_publisher()
    except Exception:  # noqa: BLE001
        logger.exception("runtime.types_index: failed to start publisher")

    logger.info("Application has started successfully.")


def _publish_runtime_info(db: DatabaseAdapter, runtime_id: str, settings: RobotlabXConfig) -> None:
    """Announce this runtime on the bus + mirror id into the singleton row.

    Publishes a retained ``/runtime/info`` so a late peer subscriber
    catches the announcement on connect (the same way every service
    surfaces its retained ``/state``). Also writes ``runtime_id`` into
    the ``runtime`` service_proxy row's ``service_config`` so HTTP
    callers (UI, scripts) can read it without subscribing.
    """
    import os
    from datetime import datetime, timezone

    info = {
        "id": runtime_id,
        "version": _read_version(),
        "started_at": datetime.now(timezone.utc).isoformat(),
        "pid": os.getpid(),
    }
    try:
        get_bus().publish_sync("/runtime/info", info, retained=True)
        logger.info("runtime.identity: announced /runtime/info id=%s", runtime_id)
    except Exception:  # noqa: BLE001
        logger.exception("runtime.identity: failed to publish /runtime/info")

    try:
        proxy = db.get_item("service_proxy", "runtime")
        if proxy:
            cfg = dict(proxy.get("service_config") or {})
            cfg["runtime_id"] = runtime_id
            proxy["service_config"] = cfg
            db.update_item("service_proxy", "runtime", proxy, include_nulls=True)
    except Exception:  # noqa: BLE001
        logger.exception("runtime.identity: failed to mirror id into proxy row")


def _read_version() -> str:
    """Pull the version string the same way main.py does, but here so
    event_handlers doesn't take a hard dep on main.py. Best-effort —
    missing/malformed version.json yields '0.0.0'."""
    import json
    try:
        with open("version.json") as f:
            return str(json.load(f).get("version") or "0.0.0")
    except (OSError, json.JSONDecodeError):
        return "0.0.0"


def on_shutdown():
    logger.info("Application is shutting down.")
    # Stop the system_state publisher so it doesn't fight uvicorn's
    # task cancellation. asyncio.run() here is safe because on_shutdown
    # runs on the main thread post-loop, with no loop attached.
    try:
        from robotlab_x.runtime import system_state
        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(system_state.stop_publisher())
        finally:
            loop.close()
    except Exception:  # noqa: BLE001
        logger.exception("runtime.system_state: shutdown failed")


def on_new_registration(registration, request: Optional[Request] = None):
    logger.info("A new user has registered.")


def on_verify_registration(user: dict, registration: dict, db) -> dict:
    return user


def on_first_user(user: dict, db) -> None:
    """Per-app business logic for the first-user-claim flow.

    Called from /v1/auth/claim-first-user (api/first_user_routes.py) AFTER
    the request payload has been validated and the user dict assembled,
    but BEFORE the row is inserted into the user table. Mutate ``user``
    in place — typically to set roles.

    robotlab_x grants the first claimer Admin. Other apps that opt into
    the same flow (via the ``auth_bootstrap: first_user_claim`` config
    field) override this with their own role model — e.g. cannamatic
    would assign ``["tenant_admin"]`` and link a tenant row here.
    """
    user["roles"] = ["Admin"]
    logger.info("first user claimed: %s with roles=%s", user.get("email"), user["roles"])


def on_get_oauth_provider_config(request: Request) -> Optional[AuthOauthProviderConfig]:
    logger.info("Fetching OAuth provider configuration.")
    return None


def on_oauth_callback(
    callback_data: AuthOauthCallbackData,
    user_data: dict,
    request: Request,
):
    logger.info("Processing OAuth callback.")
    sanitized_account = {
        "id": callback_data.id,
        "email": callback_data.email,
        "user_id": callback_data.user_id,
    }
    return {"status": "success", "account": sanitized_account}


def on_websocket_connect(websocket):
    logger.info("New WebSocket connection established")


def on_websocket_message(data: str, websocket) -> Optional[str]:
    logger.info(f"WebSocket message received: {data[:100]}...")
    return f"Echo: {data}"


def on_websocket_disconnect(websocket):
    logger.info("WebSocket disconnected")


def on_get_auth_session_ttl_seconds(request: Request | None = None) -> int:
    """Refresh-token session lifetime in seconds.

    Default reads from settings.auth_session_ttl_seconds (config_base.py default: 86400 = 24h).
    Override this function per deployment to use a different value.
    """
    settings = get_settings()
    return settings.auth_session_ttl_seconds or 86400


def on_get_jwt_access_token_ttl_minutes(request: Request | None = None) -> int:
    """Access-token JWT lifetime in minutes.

    Default reads from settings.jwt_access_token_ttl_minutes (config_base default: 60).
    Set JWT_EXPIRATION_MINUTES=2 env var to test the refresh flow on short cycles.
    """
    settings = get_settings()
    return settings.jwt_access_token_ttl_minutes or 60


def on_get_auth_session_idle_timeout_seconds(request: Request | None = None) -> int:
    """Idle-timeout in seconds — sliding limit enforced at the next /v1/refresh-token call.

    Default reads from settings.auth_session_idle_timeout_seconds (config_base default: 1800 = 30m).
    Any value < 1 disables the check; only the absolute auth_session_ttl_seconds ceiling applies.
    """
    settings = get_settings()
    value = settings.auth_session_idle_timeout_seconds
    return value if value is not None else 1800


# ─── server.py extension hooks ───────────────────────────────────────


def register_admin_routes(app) -> None:
    """Called by the generated server.py at AppServer init to attach
    app-specific admin / debug / fixture endpoints. The template
    invokes this AFTER the generated CRUD routers + the .yml's
    api_extend block, so anything registered here can override generic
    routes when paths overlap (none do today).

    Robotlab_x registers the admin DB inspector here:

      * GET /v1/admin/table-list          — list every backend table
      * GET /v1/admin/table/{table}       — fetch every row in a table

    The Workspaces → Tables page (route /admin/tables) consumes both.
    """
    from robotlab_x.api.admin_db_api import router as admin_db_router
    app.include_router(admin_db_router, prefix="/v1", tags=["Admin DB"])

    # Recent-runtime-log buffer for the Logs page (GET /v1/logs).
    from robotlab_x.api.logs_api import router as logs_router
    app.include_router(logs_router, prefix="/v1", tags=["Logs"])

    # System control — GET /v1/system/info, POST /v1/system/restart.
    from robotlab_x.api.system_api import router as system_router
    app.include_router(system_router, prefix="/v1", tags=["System"])


def resolve_ui_dir() -> Optional[str]:
    """Called by the generated server.py to locate the compiled SPA.
    Returning a path overrides the default ``apps/robotlab_x/build``
    lookup; returning None falls through to that default.

    Robotlab_x uses this so PyInstaller --onedir bundles can find the
    UI at ``<install>/_internal/ui`` (where the spec file stages it)
    while dev runs still pick up the unfrozen ``build/`` next to the
    source tree. See ``robotlab_x.paths.ui_dir`` for the full
    frozen-vs-dev resolution.
    """
    from robotlab_x.paths import ui_dir
    resolved = ui_dir()
    return str(resolved) if resolved is not None else None
