from typing import Callable, Dict
from .interface import AuthProvider
from .local_auth import LocalAuthProvider
from .none_auth import NoneAuthProvider
from .oauth_auth import OAuthAuthProvider


def get_auth_provider(config_provider: Callable[[], Dict[str, str]]) -> AuthProvider:
    """Return the AuthProvider that matches the app's configured ``auth_type``.

    Supported values (config_base ``auth_type`` Literal):
      - ``oauth``  → OAuthAuthProvider  (any OIDC/OAuth2 IdP)
      - ``local``  → LocalAuthProvider  (username/password against app db)
      - ``none``   → NoneAuthProvider   (authentication disabled)
    """
    config = config_provider()
    auth_type = config.get("auth_type", "local").lower()

    if auth_type == "oauth":
        return OAuthAuthProvider(config=config)
    if auth_type == "local":
        return LocalAuthProvider(config=config)
    if auth_type == "none":
        return NoneAuthProvider(config=config)
    raise ValueError(f"Unsupported auth_type: {auth_type}")
