"""
Session lifecycle helpers shared by all auth types (local, okta, cognito, none).

server.py (and server.py.j2) should call these three functions directly —
there is no session logic left in the template.

  create_session()        — called from /v1/login
  validate_and_rotate()   — called from /v1/refresh-token (local/DB path)
  revoke_all_sessions()   — called from /v1/logout
"""
import logging
import time
import uuid
from typing import Optional, Tuple

from .session_policy import REFRESH_TOKEN_TTL_MS, SESSION_MAX_LIFETIME_MS
from .token_util import hash_refresh_token

logger = logging.getLogger(__name__)


def create_session(
    db,
    user: dict,
    user_agent: Optional[str] = None,
    ip_address: Optional[str] = None,
) -> Tuple[str, str]:
    """
    Persist a new auth_session row and return (refresh_token, session_id).

    The raw refresh_token is returned to the caller (to send to the client)
    and is never persisted — only its hash is stored.
    """
    now_ms = int(time.time() * 1000)
    refresh_token = str(uuid.uuid4())
    session_id = f"sess_{uuid.uuid4().hex[:16]}"

    session = {
        "id": session_id,
        "user_id": user["id"],
        "tenant_id": user.get("tenant_id"),
        "refresh_token_hash": hash_refresh_token(refresh_token),
        "status": "active",
        "created": now_ms,
        "expires_at": now_ms + REFRESH_TOKEN_TTL_MS,
        "last_used_at": now_ms,
        "user_agent": user_agent,
        "ip_address": ip_address,
    }

    try:
        db.insert_item("auth_session", session_id, session)
    except Exception:
        db.update_item("auth_session", session_id, session)

    return refresh_token, session_id


def validate_and_rotate(db, refresh_token: str) -> Tuple[dict, str]:
    """
    Validate a refresh token against the DB and rotate it.

    Enforces:
      - Token must match an active session row
      - Session must not be past its expires_at (30-day rolling window)
      - Session must not exceed SESSION_MAX_LIFETIME_MS from created (hard max)

    On success, writes the new token hash and last_used_at, then returns
    (session, new_refresh_token).  Raises ValueError on any failure.
    """
    token_hash = hash_refresh_token(refresh_token)
    sessions = db.query_items("auth_session", {"refresh_token_hash": token_hash})
    if not sessions:
        raise ValueError("Invalid refresh token")

    session = sessions[0]
    now_ms = int(time.time() * 1000)

    if session.get("status") != "active":
        raise ValueError("Session is not active")

    if session.get("expires_at") and now_ms > session["expires_at"]:
        session["status"] = "expired"
        db.update_item("auth_session", session["id"], session)
        raise ValueError("Refresh token expired")

    if now_ms - session.get("created", now_ms) > SESSION_MAX_LIFETIME_MS:
        session["status"] = "expired"
        db.update_item("auth_session", session["id"], session)
        raise ValueError("Session max lifetime exceeded — please log in again")

    new_refresh_token = str(uuid.uuid4())
    session["refresh_token_hash"] = hash_refresh_token(new_refresh_token)
    session["last_used_at"] = now_ms
    db.update_item("auth_session", session["id"], session)

    return session, new_refresh_token


def revoke_all_sessions(db, user_id: str) -> int:
    """
    Delete every active session row for this user.  Returns count deleted.

    We delete (not mark revoked) so the rows are gone and cannot be replayed
    even by an attacker with DB read access.
    """
    sessions = db.query_items("auth_session", {"user_id": user_id, "status": "active"})
    deleted = 0
    for session in sessions:
        try:
            db.delete_item("auth_session", session["id"])
            deleted += 1
        except Exception as exc:
            logger.error("Failed to delete session %s: %s", session["id"], exc)
    return deleted
