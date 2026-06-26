"""Generic OAuth/OIDC authentication provider.

This provider is vendor-agnostic. It handles any OIDC/OAuth2 IdP — Okta,
Cognito, Auth0, Google, etc. — because once the OAuth callback completes,
the API server is the sole authority for session tokens (HS256 JWT issued
via jwt_util.mint_jwt, refreshed via /v1/refresh-token).

Vendor-specific concerns (issuer/authorize/token/userinfo URLs, scopes,
PKCE, group claim mapping) belong in the application's
``on_get_oauth_provider_config`` and ``on_oauth_callback`` hooks, where they
populate the AuthOauthProviderConfig and translate IdP claims into the
canonical user dict. This class never talks to the IdP at runtime; it only
verifies server-minted JWTs.

Methods other than ``get_user`` and ``generate_token`` raise
NotImplementedError because:
  - authenticate / register_user — done by the IdP via the OAuth code-exchange
    flow, not by this server. Use LocalAuthProvider for password auth.
  - refresh_token — handled by the /v1/refresh-token endpoint which rotates
    the DB-backed refresh-token UUID and mints a new HS256 JWT directly. The
    AuthProvider isn't on that path.
  - logout — handled by /v1/logout (deletes the auth_session row) plus the
    IdP's logout endpoint (via AuthOauthProviderConfig.logout_url).
"""
import logging
from typing import Dict, Optional

from .interface import AuthProvider
from .jwt_util import mint_jwt, verify_jwt

logger = logging.getLogger(__name__)


class OAuthAuthProvider(AuthProvider):
    """OIDC/OAuth2 provider. Server-issued HS256 JWT is the only runtime token."""

    def __init__(self, config: Dict[str, str]):
        # No IdP-specific config is read here. The vendor connection lives in
        # AuthOauthProviderConfig populated by on_get_oauth_provider_config.
        logger.info("Initialized OAuth auth provider (server-issued JWT only)")

    def get_user(self, token: str) -> Optional[Dict]:
        """Resolve a Bearer token to a user dict via server-issued JWT verification."""
        payload = verify_jwt(token)
        if not payload:
            return None
        user = payload.get("user") or {}
        user.setdefault("id", payload.get("sub"))
        user.setdefault("email", payload.get("sub"))
        return user

    def generate_token(self, user: dict, *, ttl_minutes: Optional[int] = None) -> str:
        """Mint a server-issued HS256 JWT for a user the IdP has already verified."""
        return mint_jwt(user, ttl_minutes=ttl_minutes)

    def authenticate(self, username: str, password: str, in_token: str = None) -> Optional[str]:
        raise NotImplementedError(
            "OAuth provider does not support direct authentication. "
            "Use the IdP OAuth callback flow (/callback → on_oauth_callback)."
        )

    def register_user(self, username: str, password: str = None, password_hash: str = None) -> dict:
        raise NotImplementedError(
            "OAuth provider does not register users. Manage users in the IdP."
        )

    def refresh_token(self, refresh_token: str) -> Optional[str]:
        raise NotImplementedError(
            "OAuth provider does not refresh tokens directly. "
            "Use the /v1/refresh-token endpoint, which rotates the DB-backed "
            "refresh-token UUID and mints a new HS256 JWT."
        )

    def logout(self, token: str) -> bool:
        # Stateless: server JWT is invalidated by deleting the auth_session row
        # in the /v1/logout endpoint. The IdP-side logout is driven by the UI
        # redirecting to AuthOauthProviderConfig.logout_url.
        return True
