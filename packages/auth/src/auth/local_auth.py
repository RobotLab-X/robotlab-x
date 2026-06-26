import logging
import hashlib
import secrets
import os
import jwt
from datetime import datetime, timedelta, timezone
from typing import Optional
from threading import Lock
from .interface import AuthProvider
from database.interface import DatabaseAdapter
from models.auth_user import AuthUser

logger = logging.getLogger(__name__)

# JWT minting + verification now lives in jwt_util so every AuthProvider
# implementation can share it. The re-exports below preserve the old import
# surface for existing tests / external callers.
from .jwt_util import (
    JWT_SECRET_KEY,
    JWT_EXPIRATION_MINUTES_DEFAULT,
    mint_jwt,
    verify_jwt,
    resolve_jwt_expiration_minutes as _resolve_jwt_expiration_minutes,
)

USERS_TABLE = "user"  # Apps must have a 'user' table that inherits from AuthUser


from typing import Dict, Callable
from threading import Lock
from database.interface import DatabaseAdapter
from database.factory import get_database_client
class LocalAuthProvider(AuthProvider):
    """Local authentication provider (uses DatabaseAdapter for persistence, JWT for tokens)."""

    _instance = None
    _lock = Lock()

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            with cls._lock:
                if not cls._instance:  # Double-checked locking
                    # Call the parent __new__ method without passing args/kwargs
                    cls._instance = super(LocalAuthProvider, cls).__new__(cls)
        return cls._instance

    def __init__(self, config: Dict[str, str]):
        """
        Initialize the local authentication provider.

        :param config: The configuration dictionary. Reads ``data_dir`` —
            the per-process working directory — to locate the
            ``admin_password.txt`` file. When unset, falls back to the
            current working directory (legacy behaviour). Apps that
            declare a ``data_dir`` field on their settings get
            instance-local admin password isolation for free.
        """
        if hasattr(self, "_initialized") and self._initialized:
            return
        self._initialized = True

        # Optional data_dir for admin_password.txt co-location. Pulled
        # from the config dict (which is typically ``settings.model_dump()``)
        # so apps that already declare ``data_dir`` in their pydantic
        # settings (continuous_mfa, robotlab_x, …) get instance-local
        # password isolation without touching this constructor.
        self._data_dir = config.get("data_dir") if isinstance(config, dict) else None

        # Bootstrap mode for the user table:
        #   "admin_seed"        (default, back-compat) — seed a hardcoded
        #                       admin@cloudseeder.ai with a generated
        #                       password in admin_password.txt
        #   "first_user_claim"  — do NOT seed; the app exposes a
        #                       /v1/auth/claim-first-user endpoint that
        #                       lets the operator establish the first
        #                       account themselves, with per-app role
        #                       assignment via event_handlers.on_first_user
        # Apps opt in via their pydantic settings field auth_bootstrap.
        # Absent → "admin_seed", which preserves every existing app.
        self._bootstrap_mode = (
            config.get("auth_bootstrap", "admin_seed")
            if isinstance(config, dict) else "admin_seed"
        )

        # Use the database factory to get a DatabaseAdapter instance if provided
        self.database = get_database_client()

        # Initialize users in the database
        self._initialize_users()

    # WARNING - to have a form of authentication we need a concept of users and roles for authorization
    def _initialize_users(self):
        if not self.database:
            logger.warning("There does not appear to be a database configured. No users nor authentication will be available.")
            return
        if self._bootstrap_mode == "first_user_claim":
            # The app owns user creation — the operator claims the first
            # account interactively via /v1/auth/claim-first-user. Do NOT
            # auto-seed admin@cloudseeder.ai here, or the claim endpoint
            # will see a populated table and refuse.
            logger.info(
                "LocalAuth: auth_bootstrap=first_user_claim — skipping admin seed; "
                "operator must claim the first user via the app's claim endpoint."
            )
            return
        # Ensure the users table exists and create a default Admin user if empty.
        #
        # DEPRECATED: the admin_seed bootstrap writes a generated password to
        # admin_password.txt on disk — an onboarding technique no production
        # deployment should rely on. Prefer auth_bootstrap="first_user_claim"
        # (the operator claims the first account interactively via
        # /v1/auth/claim-first-user). admin_seed is kept only for legacy apps;
        # do not adopt it for new ones.
        if not self.database.get_all_items(USERS_TABLE):
            logger.warning(
                "LocalAuth: auth_bootstrap=admin_seed is DEPRECATED — it seeds "
                "admin@cloudseeder.ai and writes admin_password.txt. Migrate to "
                "auth_bootstrap=first_user_claim."
            )
            admin_password = self._get_or_create_admin_password()
            admin_password_hash = self.generate_hash(admin_password)
            
            now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
            admin_user = AuthUser(
                id="admin@cloudseeder.ai",
                email="admin@cloudseeder.ai",
                password_hash=admin_password_hash,
                roles=["Admin"],
                status="active",
                auth_provider="local",
                created=now_ms,
                modified=now_ms
            )
            self.database.insert_item(
                USERS_TABLE,
                "admin@cloudseeder.ai",
                admin_user.model_dump(exclude_none=True)
            )

    def _generate_jwt(self, user_id: str, *, ttl_minutes: Optional[int] = None) -> str:
        """Mint an HS256 JWT for the given user_id (looks up the user record in the DB)."""
        if not user_id:
            raise ValueError("_generate_jwt Username cannot be empty")

        user_id = user_id.lower()
        user = self.database.get_item(USERS_TABLE, user_id) or {}
        # Don't leak credential material into the JWT payload.
        for key in ("password_hash", "password", "token"):
            user.pop(key, None)
        # mint_jwt requires id + email; synthesize them from the lookup key when missing.
        user.setdefault("id", user_id)
        user.setdefault("email", user_id)
        return mint_jwt(user, ttl_minutes=ttl_minutes)

    def _verify_jwt(self, token: str) -> Optional[dict]:
        """Verify a JWT and return its payload if valid."""
        return verify_jwt(token)

    def _get_or_create_admin_password(self):
        # Co-locate the password file with the rest of the instance's
        # working state when the app declared a data_dir; fall back to
        # cwd for legacy callers. Creates the parent directory if
        # missing so a fresh data_dir (e.g. /tmp/<app>-<runtime>/) on
        # first boot doesn't trip on "file not found in nonexistent
        # directory".
        if self._data_dir:
            data_dir_path = self._data_dir
            os.makedirs(data_dir_path, exist_ok=True)
            password_file = os.path.join(data_dir_path, "admin_password.txt")
        else:
            password_file = "admin_password.txt"
        if os.path.exists(password_file):
            with open(password_file, "r") as file:
                password = file.read().strip()
            print(f"Admin password loaded from file: {password_file}")
        else:
            password = secrets.token_urlsafe(16)  # Generates a secure random password
            with open(password_file, "w") as file:
                file.write(password)
            print(f"New admin password generated and saved: {password_file}")

        return password


    # FIXME - change username to id
    # Deprecated - since the whole registration object should be passed, and the details handled in a "per app" way
    def register_user(self, username: str, password: str = None, password_hash: str = None) -> dict:
        if password_hash is None and password is not None:
            raise ValueError("register_user Password hash or password is required when registering a user")
        if password_hash is not None and password is not None:
            raise ValueError("register_user Password hash and password cannot be provided at the same time")
        
        username = username.lower()

        if self.database.get_item(USERS_TABLE, username):
            raise ValueError(f"register_user user already exists {username}")
        if password_hash is None:
            password_hash = self.generate_hash(password)
        
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        new_user = AuthUser(
            id=username,
            email=username,
            password_hash=password_hash,
            roles=[],
            status="active",
            auth_provider="local",
            created=now_ms,
            modified=now_ms
        )
        self.database.insert_item(
            USERS_TABLE,
            username,
            new_user.model_dump(exclude_none=True)
        )
        return {"username": username, "message": "User registered"}

    def authenticate(self, user_id: str, password: str, *, ttl_minutes: Optional[int] = None) -> Optional[str]:
        """Authenticate a user and return a fresh access-token JWT on success.

        ``ttl_minutes`` overrides the JWT lifetime (forwarded to ``_generate_jwt``).
        """
        logger.info(f"Authenticating user: {user_id}")
        if not user_id:
            raise ValueError("authenticate user_id cannot be empty")

        user_id = user_id.lower()

        user = self.database.get_item(USERS_TABLE, user_id)
        if user:
            user.pop("token", None)
            user["login_count"] = (user.get("login_count") or 0) + 1
            self.database.update_item(USERS_TABLE, user_id, user)
            if user["password_hash"] == self.generate_hash(password):
                token = self._generate_jwt(user_id, ttl_minutes=ttl_minutes)
                user["last_login"] = int(datetime.now(timezone.utc).timestamp() * 1000)
                self.database.update_item(USERS_TABLE, user_id, user)
                return token
            else:
                self.database.update_item(USERS_TABLE, user_id, {"last_unsuccessful_login": int(datetime.now(timezone.utc).timestamp() * 1000)})
        return None

    def get_user(self, token: str) -> Optional[dict]:
        payload = self._verify_jwt(token)
        if payload:
            username = payload.get("sub")
            if not username:
                raise ValueError("get_user sub username cannot be empty")
            username = username.lower()
            user = self.database.get_item(USERS_TABLE, username)
            # DEBUG LOGGING
            # logger.info(f"[AUTH DEBUG] DB path: {getattr(self, 'sqlite_path', getattr(self.database, 'sqlite_path', 'unknown'))}")
            # logger.info(f"[AUTH DEBUG] Looking up user: {username}")
            # logger.info(f"[AUTH DEBUG] User record: {user}")
            # logger.info(f"[AUTH DEBUG] Token in DB: {user.get('token') if user else None}")
            # logger.info(f"[AUTH DEBUG] Token in request: {token}")
            if user:
                user.pop("password_hash", None)
                user.pop("password", None)
                user.pop("token", None)
                return user
        return None

    def refresh_token(self, refresh_token: str) -> Optional[str]:
        """Generate a new token if the refresh token is valid."""
        payload = self._verify_jwt(refresh_token)
        if payload:
            username = payload.get("sub")
            if not username:
                raise ValueError("refresh_token sub username cannot be empty")
            username = username.lower()
            user = self.database.get_item(USERS_TABLE, username)
            if user:
                new_token = self._generate_jwt(username)
                user.pop("token", None)
                # Update only the modified timestamp
                update_data = {"modified": int(datetime.now(timezone.utc).timestamp() * 1000)}
                self.database.update_item(USERS_TABLE, username, update_data)
                logger.info(f"Token refreshed for user {username}.")
                return new_token
        logger.warning("Invalid refresh token provided.")
        return None

    def logout(self, token: str) -> bool:
        """Log out a user by invalidating their token."""
        payload = self._verify_jwt(token)
        if payload:
            username = payload.get("sub")
            if not username:
                raise ValueError("logout username cannot be empty")
            username = username.lower()
            user = self.database.get_item(USERS_TABLE, username)
            if user:
                # Update only the modified timestamp
                update_data = {"modified": int(datetime.now(timezone.utc).timestamp() * 1000)}
                self.database.update_item(USERS_TABLE, username, update_data)
                logger.info(f"User {username} logged out successfully.")
                return True
        logger.warning("Invalid token provided for logout.")
        return False

    def generate_token(self, user: dict, *, ttl_minutes: Optional[int] = None) -> str:
        """Mint a server-issued HS256 JWT for the given user dict.

        ``ttl_minutes`` overrides the access-token lifetime; see
        :func:`auth.jwt_util.resolve_jwt_expiration_minutes` for precedence.
        """
        return mint_jwt(user, ttl_minutes=ttl_minutes)
