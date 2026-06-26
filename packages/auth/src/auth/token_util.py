import hashlib
import os


def hash_refresh_token(token: str, secret: str = None) -> str:
    """
    Hash a refresh token with a server-side secret pepper.

    Uses SHA-256 over "<secret>:<token>" so that a leaked DB row cannot be
    replayed without also knowing the server secret.

    Returns a string of the form "sha256:<hex>".
    """
    if secret is None:
        secret = os.environ.get("JWT_SECRET_KEY", "fallback_dev_key")
    combined = f"{secret}:{token}"
    digest = hashlib.sha256(combined.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"
