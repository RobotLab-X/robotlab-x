"""Shared HS256 JWT minting + verification for all AuthProvider implementations.

After OAuth callback or password login, the API server is the token authority —
the UI receives a JWT signed with ``JWT_SECRET_KEY`` that this same API server
can verify locally. Every ``AuthProvider`` (Local, Okta, Cognito, None) uses
the same logic; the differences between providers are only in *how identity is
verified*, not in token format.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt

logger = logging.getLogger(__name__)

JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "fallback_dev_key")
JWT_EXPIRATION_MINUTES_DEFAULT = 60


def resolve_jwt_expiration_minutes(ttl_minutes: Optional[int] = None) -> int:
    """Resolve the access-token TTL, in minutes.

    Precedence (highest first):
      1. ``JWT_EXPIRATION_MINUTES`` env var — local-test override that wins
         over everything. server.py always supplies an explicit ``ttl_minutes``
         value via the event-handler hook (the per-deployment knob), so without
         this env-var override there would be no way to short-circuit for
         testing without DB or config changes.
      2. Explicit ``ttl_minutes`` arg (set by ``server.py`` from
         ``on_get_jwt_access_token_ttl_minutes`` — sources from
         ``settings.jwt_access_token_ttl_minutes``).
      3. ``JWT_EXPIRATION_MINUTES_DEFAULT`` (60 minutes).
    """
    raw = os.environ.get("JWT_EXPIRATION_MINUTES")
    if raw:
        try:
            value = int(raw)
            if value > 0:
                return value
        except ValueError:
            logger.warning(
                "Invalid JWT_EXPIRATION_MINUTES env var %r; falling back to other sources",
                raw,
            )
    if ttl_minutes is not None and ttl_minutes > 0:
        return ttl_minutes
    return JWT_EXPIRATION_MINUTES_DEFAULT


_BLACKLIST = {"password_hash", "password_updated_at"}


def mint_jwt(user: dict, *, ttl_minutes: Optional[int] = None) -> str:
    """Mint an HS256 JWT for the given user dict.

    ``user`` must contain ``id`` and ``email``. The full dict (minus the blacklist
    of sensitive fields) is embedded under the ``user`` claim so endpoints can
    read role/group/tenant info without an extra DB roundtrip.
    """
    if not user:
        raise ValueError("mint_jwt: user cannot be empty")
    if not user.get("id"):
        raise ValueError("mint_jwt: user['id'] is required")
    if not user.get("email"):
        raise ValueError("mint_jwt: user['email'] is required")

    uid = user["id"].lower()
    user_payload = {k: v for k, v in user.items() if k not in _BLACKLIST}
    user_payload["id"] = uid
    user_payload["email"] = uid

    payload = {
        "sub": uid,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=resolve_jwt_expiration_minutes(ttl_minutes)),
        "user": user_payload,
    }
    token = jwt.encode(payload, JWT_SECRET_KEY, algorithm="HS256")
    return token if isinstance(token, str) else token.decode("utf-8")


def verify_jwt(token: str) -> Optional[dict]:
    """Verify an HS256 JWT and return its payload, or None if invalid/expired."""
    try:
        return jwt.decode(token, JWT_SECRET_KEY, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        logger.warning("JWT has expired")
    except jwt.InvalidTokenError:
        logger.warning("Invalid JWT")
    return None
