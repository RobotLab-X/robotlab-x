"""
Generic authentication utilities for FastAPI applications.
Provides dual authentication support (token + shared secret) and role-based access control.

Usage:
    # In your app initialization:
    from auth.auth_util import create_auth_dependencies
    from config import create_app_settings
    
    settings, config_provider = create_app_settings("my_app", MyConfig)
    auth_deps = create_auth_dependencies(config_provider)
    
    # In your API routes:
    @app.get("/secure-endpoint")
    def secure_endpoint(user: dict = Depends(auth_deps.require_role(["Admin"]))):
        return {"message": f"Hello {user['username']}"}
"""
import base64
import logging
from fastapi import Depends, HTTPException, Security, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional, Callable, Dict, Any, List
import time
import random
from .factory import get_auth_provider

logger = logging.getLogger(__name__)

# Module-level storage for shared secret validator callback
# This ensures all AuthDependencies instances share the same callback
_global_shared_secret_validator: Optional[Callable[[str], Optional[dict]]] = None
# Callback for Basic auth: receives (username, password) → user dict or None
_global_basic_auth_validator: Optional[Callable[[str, str], Optional[dict]]] = None

def base36encode(number):
    """Convert a positive integer to a base-36 string."""
    if number < 0:
        raise ValueError("number must be positive")
    digits = '0123456789abcdefghijklmnopqrstuvwxyz'
    if number == 0:
        return '0'
    result = ''
    while number:
        number, remainder = divmod(number, 36)
        result = digits[remainder] + result
    return result


def generate_timestamp_id():
    """Generate a timestamp-based ID for this app."""
    timestamp_part = base36encode(int(time.time() * 1000))
    random_part = base36encode(int(random.random() * (36 ** 6))).zfill(6)
    return f"{timestamp_part}-{random_part}"



class AuthDependencies:
    """Authentication dependencies for FastAPI that support dual auth (token + shared secret)."""
    
    def __init__(self, config_provider: Callable[[], Dict[str, Any]]):
        self.config_provider = config_provider
        self.auth = get_auth_provider(config_provider)
        self.security = HTTPBearer(auto_error=False)
    
    def set_shared_secret_validator(self, validator: Callable[[str], Optional[dict]]):
        """
        Set a callback function to validate shared secrets (API keys).
        
        The validator function should:
        - Accept a single string parameter (the API key)
        - Return a dict with user info (id, username, email, roles, etc.) if valid
        - Return None if invalid
        
        Example:
            def validate_api_key(api_key: str) -> Optional[dict]:
                client = db.get_search_client_by_secret(api_key)
                if client:
                    return {
                        "id": client.id,
                        "username": client.name,
                        "email": f"{client.id}@client.internal",
                        "roles": client.roles,
                        "tenant_id": client.tenant_id,
                        "volume_ids": client.volume_ids
                    }
                return None
            
            auth_deps.set_shared_secret_validator(validate_api_key)
        """
        global _global_shared_secret_validator
        _global_shared_secret_validator = validator
        logger.info("Shared secret validator callback registered (global)")

    def set_basic_auth_validator(self, validator: Callable[[str, str], Optional[dict]]):
        """
        Set a callback for Basic auth  validation.

        The validator receives (username, password) decoded from the
        Authorization: Basic <base64> header and should return a user dict
        or None if the credentials are invalid.
        """
        global _global_basic_auth_validator
        _global_basic_auth_validator = validator
        logger.info("Basic auth validator callback registered (global)")

    def get_current_user_or_service(
        self,
        credentials: Optional[HTTPAuthorizationCredentials] = Security(HTTPBearer(auto_error=False)),
        x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
        authorization: Optional[str] = Header(None, alias="Authorization"),
    ) -> dict:
        """Get current authenticated user from token OR validate service via shared secret."""
        
        # Check auth type in config
        config = self.config_provider()
        auth_type = config.get("auth_type", "local").lower()

        # Authentication is bypassed only when auth_type is explicitly set to "none".
        if auth_type == "none":
            logger.debug("Authentication disabled - allowing access")
            return {"id": "no-auth", "username": "no-auth", "roles": [], "auth_type": "none"}
        
        # Try shared secret authentication first (for service-to-service calls)
        if isinstance(x_api_key, str) and x_api_key:
            logger.debug("Attempting shared secret authentication")
            
            # First, try the app-specific validator callback if registered
            global _global_shared_secret_validator
            if _global_shared_secret_validator:
                logger.debug("Using app-specific shared secret validator")
                try:
                    user = _global_shared_secret_validator(x_api_key)
                    if user:
                        logger.info(f"API key validated via callback for user: {user.get('username')}")
                        user["auth_type"] = "shared_secret"
                        return user
                except Exception as e:
                    logger.error(f"Error in shared secret validator callback: {e}")
                    raise HTTPException(status_code=500, detail="Internal authentication error")
            
            # Fall back to global api_shared_secret from config
            expected_secret = config.get("api_shared_secret")
            if expected_secret and x_api_key == expected_secret:
                logger.info("Service authenticated via global shared secret")
                # FIXME - make configurable service user info 
                return {
                    "id": "service",
                    "email": "service@service.internal", 
                    "username": "service",
                    "roles": [],  # Global fallback grants no roles (least privilege)
                    "auth_type": "shared_secret"
                }
            
            # Invalid API key
            logger.warning("Invalid shared secret provided")
            raise HTTPException(status_code=401, detail="Invalid API key")

        # Try Basic auth (METRC-style: Authorization: Basic base64(user_key:software_api_key))
        if isinstance(authorization, str) and authorization.lower().startswith("basic "):
            logger.debug("Attempting Basic auth authentication")
            try:
                decoded = base64.b64decode(authorization[6:].strip()).decode("utf-8")
                username, _, password = decoded.partition(":")
            except Exception:
                raise HTTPException(status_code=401, detail="Invalid Basic auth encoding")
            global _global_basic_auth_validator
            if _global_basic_auth_validator:
                try:
                    user = _global_basic_auth_validator(username, password)
                    if user:
                        logger.info(f"Basic auth validated for user: {user.get('username')}")
                        user["auth_type"] = "basic_auth"
                        return user
                except Exception as e:
                    logger.error(f"Error in Basic auth validator: {e}")
                    raise HTTPException(status_code=500, detail="Internal authentication error")
            raise HTTPException(status_code=401, detail="Invalid credentials")

        # Try token authentication (for user calls)
        if isinstance(credentials, HTTPAuthorizationCredentials):
            logger.debug("Attempting token authentication")
            try:
                user = self.get_current_user(credentials)
                user["auth_type"] = "token"
                return user
            except HTTPException as e:
                logger.warning(f"Token authentication failed: {e.detail}")
                raise e
        
        # No authentication method provided
        logger.warning("No authentication credentials provided")
        raise HTTPException(
            status_code=401, 
            detail="Authentication required: provide Bearer token or X-API-Key header"
        )
    
    def get_current_user(self, credentials: HTTPAuthorizationCredentials) -> dict:
        """Get current authenticated user from token."""
        logger.debug("Getting current user from credentials")
        token = credentials.credentials
        
        try:
            user = self.auth.get_user(token)
            
            if not user:
                raise HTTPException(status_code=401, detail="Invalid or expired token")
            
            # Check if the token is an MFA token and validate accordingly
            if user.get("mfa_required") and not user.get("mfa_verified"):
                raise HTTPException(status_code=401, detail="MFA verification required")
            
            return user
        except Exception as e:
            logger.error(f"Error while authenticating user: {e}")
            raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    def require_role(self, required_roles: List[str]):
        """Dependency factory for role-based access control that also allows service authentication."""
        logger.debug(f"Creating dual auth role checker for required roles: {required_roles}")

        def role_checker(user: dict = Depends(self.get_current_user_or_service)):
            logger.debug(f"Checking user/service roles: {user}")
            
            auth_type = user.get("auth_type")
            if auth_type == "none":
                logger.debug("Authentication disabled - access granted")
                return user

            # `or []` (not `get(..., [])`) because the column may be present
            # but NULL — a user row freshly logged in that hasn't gone through
            # the verify hook yet has roles = None, which would crash the
            # `in user_roles` checks below.
            user_roles = user.get("roles") or []

            if auth_type == "shared_secret":
                logger.info(f"Shared secret authentication detected; validating roles: {required_roles}")
            
            # Allow access if no roles are required
            if not required_roles:
                return user

            if "Admin" in user_roles:
                return user
                    
            if not any(role in user_roles for role in required_roles):
                logger.error(f"Access denied for user {user.get('username')}: insufficient roles {user_roles} for required roles {required_roles}")
                raise HTTPException(status_code=403, detail="Access denied: Insufficient permissions")
            
            return user
        return role_checker

    def require_role_or_service(self, required_roles: List[str]):
        """Alias for require_role for backward compatibility."""
        return self.require_role(required_roles)


def create_auth_dependencies(config_provider: Callable[[], Dict[str, Any]]) -> AuthDependencies:
    """Factory function to create auth dependencies for an app."""
    return AuthDependencies(config_provider)


def no_auth_required():
    """No-op dependency for disabled authentication."""
    return {}


def no_role_required():
    """No-op role check when auth is disabled."""
    return {}
