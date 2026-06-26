"""auth package."""

from .interface import AuthProvider
from .factory import get_auth_provider
from .auth_util import AuthDependencies, create_auth_dependencies, no_auth_required, no_role_required
from .local_auth import LocalAuthProvider
from .none_auth import NoneAuthProvider
from .oauth_auth import OAuthAuthProvider

__version__ = "0.1.0"

__all__ = [
    "AuthProvider",
    "get_auth_provider",
    "AuthDependencies",
    "create_auth_dependencies",
    "no_auth_required",
    "no_role_required",
    "LocalAuthProvider",
    "NoneAuthProvider",
    "OAuthAuthProvider",
]
