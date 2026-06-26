"""Canonical Registration → User flow.

Lives in the auth package so every app's managed registration_service can
collapse to a thin wrapper that supplies the db handle and its
event_handlers module. Specifics — role assignment, tenant linkage, custom
fields — belong in the app's ``on_verify_registration`` hook; this module
only knows about the ``registration`` and ``user`` tables.

Public surface
--------------

- ``build_proto_user_from_registration(registration: dict) -> dict``
    Pure helper that codifies the AuthUser ⊆ AuthRegistration field
    mapping. Returns a freshly-built user dict with ``roles=[]``,
    ``email_verified=True``, ``status="active"``, ``auth_provider="local"``.

- ``verify_and_register(db, token, *, hook_module=None) -> dict``
    The canonical flow. Looks up the registration, marks it verified,
    builds the proto-user, invokes the optional verify hook, and inserts
    the user. Returns a status dict the caller can wrap in its own
    ServiceResponseMessage.

Hook contract
-------------

The verify hook is looked up via ``getattr(hook_module, "on_verify_registration")``.

- Signature: ``on_verify_registration(user: dict, registration: dict, db) -> dict``
- Called once, between the proto-user build and the user insert.
- Expected to return the (possibly mutated) user dict.
- If the hook is missing, raises, or returns a non-dict, the flow logs and
  falls back to the proto-user (so a broken hook degrades to a no-role
  user rather than crashing the verify endpoint).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


def build_proto_user_from_registration(registration: dict) -> dict:
    """Build the proto-user dict from a (verified) registration record.

    Copies the fields that an AuthUser shares with AuthRegistration and
    sets the constants that every successful verify produces. Apps that
    want richer users (extra fields, tenant linkage, roles) do so in the
    on_verify_registration hook.

    ``tenant_id`` is opportunistically copied from the registration if an
    earlier hook (e.g. on_new_registration) has stamped one onto it.
    """
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    user_id = registration.get("user_id") or registration.get("email")
    return {
        "id": user_id,
        "tenant_id": registration.get("tenant_id"),
        "email": registration.get("email"),
        "email_verified": True,
        "fullname": registration.get("fullname"),
        "password_hash": registration.get("password_hash"),
        "roles": [],
        "status": "active",
        "auth_provider": "local",
        "created": registration.get("created") or now_ms,
        "modified": now_ms,
    }


def verify_and_register(db, token: str, *, hook_module: Any = None) -> dict:
    """Look up ``registration`` by ``token``, mark it verified, and produce
    the corresponding ``user`` row.

    Returns one of:
        {"status": "already_verified", "message": "Email already verified"}
        {"status": "user_existed", "user": <dict>, "message": "Email verified successfully"}
        {"status": "verified", "user": <dict>, "message": "Registration verified successfully"}

    Raises ``ValueError`` when no registration matches ``token``.
    """
    if db is None:
        raise ValueError("verify database not configured")

    registration = db.get_item("registration", token)
    if not registration:
        raise ValueError(f"Registration not found for token: {token}")

    if registration.get("state") == "verified":
        logger.info("Registration %s already verified", token)
        return {"status": "already_verified", "message": "Email already verified"}

    registration["state"] = "verified"
    db.update_item("registration", registration.get("id"), registration)

    user_id = registration.get("user_id") or registration.get("email")
    existing_user = db.get_item("user", user_id)
    if existing_user:
        # Don't run the hook on this path — the user record predates this
        # verify cycle, the caller might have set roles/tenant deliberately
        # and we shouldn't trample them. Just flip the verification bits.
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        existing_user["email_verified"] = True
        existing_user["status"] = "active"
        existing_user["modified"] = now_ms
        if registration.get("tenant_id") and not existing_user.get("tenant_id"):
            existing_user["tenant_id"] = registration["tenant_id"]
        db.update_item("user", user_id, existing_user)
        logger.info("User %s already existed; email_verified flipped", user_id)
        return {
            "status": "user_existed",
            "user": existing_user,
            "message": "Email verified successfully",
        }

    user = build_proto_user_from_registration(registration)
    user = _invoke_verify_hook(hook_module, user, registration, db)
    db.insert_item("user", user["id"], user)
    logger.info(
        "User %s created with roles=%s tenant_id=%s",
        user_id, user.get("roles"), user.get("tenant_id"),
    )
    return {
        "status": "verified",
        "user": user,
        "message": "Registration verified successfully",
    }


def _invoke_verify_hook(hook_module: Any, user: dict, registration: dict, db) -> dict:
    """Call ``hook_module.on_verify_registration`` if it exists. Falls back
    to the proto-user on every failure mode: missing module, missing hook,
    hook raise, non-callable, wrong return type. Each failure is logged so
    operators can spot misconfigured apps without crashing the verify
    endpoint."""
    if hook_module is None:
        logger.info(
            "verify_and_register: no hook_module supplied; "
            "user will be inserted with no roles",
        )
        return user

    hook = getattr(hook_module, "on_verify_registration", None)
    if hook is None:
        logger.warning(
            "verify_and_register: %s.on_verify_registration is not defined; "
            "user will be inserted with no roles",
            getattr(hook_module, "__name__", "<hook_module>"),
        )
        return user
    if not callable(hook):
        logger.warning(
            "verify_and_register: %s.on_verify_registration is not callable (%r); "
            "user will be inserted with no roles",
            getattr(hook_module, "__name__", "<hook_module>"), type(hook).__name__,
        )
        return user

    try:
        result = hook(user, registration, db)
    except Exception:
        logger.exception(
            "verify_and_register: %s.on_verify_registration raised; "
            "falling back to proto-user with no roles",
            getattr(hook_module, "__name__", "<hook_module>"),
        )
        return user

    if not isinstance(result, dict):
        logger.warning(
            "verify_and_register: %s.on_verify_registration returned %r, "
            "expected dict; using proto-user with no roles",
            getattr(hook_module, "__name__", "<hook_module>"), type(result).__name__,
        )
        return user
    return result
