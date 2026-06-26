from typing import Optional
from .interface import AuthProvider


class NoneAuthProvider(AuthProvider):
    """No-op auth provider — auth_type='none' bypasses all authentication."""

    def __init__(self, config=None):
        pass

    def register_user(self, username: str, password: str = None, password_hash: str = None) -> dict:
        return {"id": username, "username": username}

    def authenticate(self, username: str, password: str, in_token: str = None) -> Optional[str]:
        return "none"

    def get_user(self, token: str) -> Optional[dict]:
        return {"id": "anonymous", "username": "anonymous", "roles": ["Admin"]}

    def refresh_token(self, refresh_token: str) -> Optional[str]:
        return refresh_token

    def logout(self, token: str) -> bool:
        return True

    def generate_token(self, user: dict, *, ttl_minutes: Optional[int] = None) -> str:
        # auth_type='none' disables auth entirely; return a sentinel rather than a
        # real JWT. Callers that need a verifiable token should pick a real auth_type.
        return "none"
