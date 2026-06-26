# unmanaged
"""Subprocess service authentication.

Subprocess services that need to talk to the backend's bus (publish state,
subscribe to their control topic) authenticate via a long-lived JWT minted
at backend boot. The token is signed with the same JWT_SECRET_KEY as user
tokens, so the existing /v1/ws decode path accepts it without modification.

The token is generated lazily on first request and cached in module state
for the lifetime of the backend process. We do NOT persist it to disk:
JWT_SECRET_KEY might rotate, and a fresh boot mints a fresh token cheaply.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import jwt


logger = logging.getLogger(__name__)

_CACHED_TOKEN: Optional[str] = None


def _jwt_secret() -> str:
    return os.environ.get("JWT_SECRET_KEY", "fallback_dev_key")


def get_subprocess_token() -> str:
    """Long-lived JWT for subprocess bus access.

    Payload mirrors the user-token shape the WS endpoint expects: ``sub`` +
    ``user.roles=['Admin']`` so the connection isn't blocked by the
    require-role check. There's no ``exp`` claim — the token outlives the
    subprocess but is invalidated when JWT_SECRET_KEY rotates.
    """
    global _CACHED_TOKEN
    if _CACHED_TOKEN is not None:
        return _CACHED_TOKEN
    payload = {
        "sub": "subprocess",
        "user": {
            "id": "subprocess",
            "email": "subprocess@robotlab_x",
            "roles": ["Admin"],
            "status": "active",
        },
    }
    _CACHED_TOKEN = jwt.encode(payload, _jwt_secret(), algorithm="HS256")
    return _CACHED_TOKEN


def backend_url() -> str:
    """Best-effort 'where to reach the backend' URL for subprocess clients.

    Reads settings.port; defaults to localhost. Subprocess services run on
    the same host today, so localhost is correct. When we add remote
    workers, this becomes the bus broker address.
    """
    try:
        from config import get_settings
        s = get_settings()
        port = getattr(s, "port", None) or 8001
    except Exception:  # noqa: BLE001
        port = 8001
    return f"http://localhost:{port}"
