"""Contract tests for auth.registration_flow.

These define the behavior every app's managed registration_service inherits
once Phase 4 collapses the per-app templates. Apps add specifics in their
on_verify_registration hook; this module is responsible for hook discovery,
proto-user shape, idempotency, and crash safety.
"""
import types
import pytest

from auth.registration_flow import (
    build_proto_user_from_registration,
    verify_and_register,
)


class FakeDB:
    def __init__(self):
        self.items = {}
        self.inserts = []
        self.updates = []

    def insert_item(self, table, item_id, data):
        self.items.setdefault(table, {})[item_id] = data
        self.inserts.append((table, item_id, data))
        return data

    def get_item(self, table, item_id):
        return self.items.get(table, {}).get(item_id)

    def update_item(self, table, item_id, data):
        self.items.setdefault(table, {})[item_id] = data
        self.updates.append((table, item_id, data))
        return data


@pytest.fixture
def db():
    return FakeDB()


def _registration(
    *,
    token="tok-1",
    email="user@example.com",
    state="registered",
    tenant_id=None,
    extras=None,
):
    rec = {
        "id": token,
        "verification_token": token,
        "user_id": email,
        "email": email,
        "fullname": "Test User",
        "password_hash": "$argon2id$dummy",
        "state": state,
        "tenant_id": tenant_id,
        "created": 1700000000000,
        "client_base_url": "https://example.com",
    }
    if extras:
        rec.update(extras)
    return rec


def _hook_module(on_verify_registration=None, name="fake.handlers"):
    """Build an ad-hoc module-like object exposing a verify hook."""
    mod = types.ModuleType(name)
    if on_verify_registration is not None:
        mod.on_verify_registration = on_verify_registration
    return mod


# ── build_proto_user_from_registration ──────────────────────────────────────


def test_proto_user_has_canonical_shape():
    """Every proto-user must carry these fields with these defaults."""
    reg = _registration()
    user = build_proto_user_from_registration(reg)

    assert user["id"] == reg["user_id"]
    assert user["email"] == reg["email"]
    assert user["email_verified"] is True
    assert user["fullname"] == reg["fullname"]
    assert user["password_hash"] == reg["password_hash"]
    assert user["roles"] == []
    assert user["status"] == "active"
    assert user["auth_provider"] == "local"
    assert user["tenant_id"] is None
    assert user["created"] == reg["created"]
    assert isinstance(user["modified"], int) and user["modified"] > 0


def test_proto_user_id_falls_back_to_email():
    """If registration has no explicit user_id, the email is used as id."""
    reg = _registration()
    reg["user_id"] = None
    user = build_proto_user_from_registration(reg)
    assert user["id"] == reg["email"]


def test_proto_user_carries_tenant_id_when_registration_has_one():
    """on_new_registration hooks (e.g. cannamatic's tenant creation) stamp
    tenant_id onto the registration. The proto-user must pick it up."""
    reg = _registration(tenant_id="tenant-123")
    user = build_proto_user_from_registration(reg)
    assert user["tenant_id"] == "tenant-123"


# ── verify_and_register: lookup + idempotency ───────────────────────────────


def test_unknown_token_raises(db):
    with pytest.raises(ValueError, match="Registration not found"):
        verify_and_register(db, "missing")


def test_db_missing_raises():
    with pytest.raises(ValueError, match="database not configured"):
        verify_and_register(None, "anything")


def test_already_verified_is_idempotent(db):
    """Re-clicking the link must not re-insert a user or re-run the hook."""
    reg = _registration(state="verified")
    db.insert_item("registration", reg["id"], reg)
    sentinel = []
    mod = _hook_module(lambda u, r, d: (sentinel.append(1), u)[1])

    result = verify_and_register(db, reg["id"], hook_module=mod)

    assert result["status"] == "already_verified"
    assert db.get_item("user", reg["email"]) is None
    assert sentinel == []  # hook MUST NOT run on idempotent path


def test_registration_state_flips_to_verified_on_first_call(db):
    reg = _registration()
    db.insert_item("registration", reg["id"], reg)

    verify_and_register(db, reg["id"])

    assert db.get_item("registration", reg["id"])["state"] == "verified"


# ── verify_and_register: hook integration ───────────────────────────────────


def test_hook_is_called_with_user_registration_db(db):
    """The hook signature contract: (proto_user, registration, db)."""
    reg = _registration()
    db.insert_item("registration", reg["id"], reg)
    seen = {}

    def hook(user, registration, hook_db):
        seen["user"] = user
        seen["registration"] = registration
        seen["db"] = hook_db
        user["roles"] = ["test_role"]
        return user

    verify_and_register(db, reg["id"], hook_module=_hook_module(hook))

    assert seen["user"]["email"] == reg["email"]
    assert seen["user"]["roles"] == ["test_role"]  # observed AFTER mutation
    assert seen["registration"]["id"] == reg["id"]
    assert seen["db"] is db


def test_hook_return_value_is_inserted(db):
    """Whatever dict the hook returns is what hits the user table."""
    reg = _registration()
    db.insert_item("registration", reg["id"], reg)

    def hook(user, registration, hook_db):
        user["roles"] = ["tenant_admin"]
        user["custom_field"] = "added_by_hook"
        return user

    verify_and_register(db, reg["id"], hook_module=_hook_module(hook))

    inserted = db.get_item("user", reg["email"])
    assert inserted["roles"] == ["tenant_admin"]
    assert inserted["custom_field"] == "added_by_hook"


def test_no_hook_module_inserts_proto_user(db, caplog):
    """No hook_module → proto-user inserted with roles=[]. Info-logged."""
    reg = _registration()
    db.insert_item("registration", reg["id"], reg)

    with caplog.at_level("INFO"):
        result = verify_and_register(db, reg["id"], hook_module=None)

    assert result["status"] == "verified"
    user = db.get_item("user", reg["email"])
    assert user["roles"] == []
    assert any("no hook_module" in r.message for r in caplog.records)


def test_missing_on_verify_registration_logs_warning(db, caplog):
    """hook_module without on_verify_registration → warning + proto-user."""
    reg = _registration()
    db.insert_item("registration", reg["id"], reg)
    mod = _hook_module()  # no hook attached

    with caplog.at_level("WARNING"):
        verify_and_register(db, reg["id"], hook_module=mod)

    user = db.get_item("user", reg["email"])
    assert user["roles"] == []
    assert any("not defined" in r.message for r in caplog.records)


def test_non_callable_hook_logs_warning(db, caplog):
    """on_verify_registration set to a non-callable (e.g. a stray constant) →
    warning + proto-user."""
    reg = _registration()
    db.insert_item("registration", reg["id"], reg)
    mod = _hook_module()
    mod.on_verify_registration = "not-a-function"  # type: ignore[attr-defined]

    with caplog.at_level("WARNING"):
        verify_and_register(db, reg["id"], hook_module=mod)

    user = db.get_item("user", reg["email"])
    assert user["roles"] == []
    assert any("not callable" in r.message for r in caplog.records)


def test_hook_raising_falls_back_to_proto_user(db, caplog):
    """A buggy hook (raises) must NOT break /v1/verify. The user is still
    inserted with empty roles; the exception is logged."""
    reg = _registration()
    db.insert_item("registration", reg["id"], reg)

    def bad_hook(user, registration, hook_db):
        raise RuntimeError("boom")

    with caplog.at_level("ERROR"):
        result = verify_and_register(db, reg["id"], hook_module=_hook_module(bad_hook))

    assert result["status"] == "verified"
    user = db.get_item("user", reg["email"])
    assert user["roles"] == []
    assert any("raised" in r.message for r in caplog.records)


def test_hook_wrong_signature_falls_back_to_proto_user(db, caplog):
    """The metrc-style alias-mismatch case: hook accepts wrong arg count.
    Today this is a crash; the helper turns it into a logged exception +
    proto-user fallback."""
    reg = _registration()
    db.insert_item("registration", reg["id"], reg)

    def two_arg_hook(item, _request):  # pragma: no cover - signature only
        return item

    with caplog.at_level("ERROR"):
        verify_and_register(db, reg["id"], hook_module=_hook_module(two_arg_hook))

    user = db.get_item("user", reg["email"])
    assert user["roles"] == []


def test_hook_returning_non_dict_falls_back(db, caplog):
    """A hook that returns None / a string / anything-not-dict must not
    poison the insert. We log and fall back to the proto-user."""
    reg = _registration()
    db.insert_item("registration", reg["id"], reg)

    def hook(user, registration, hook_db):
        return None  # forgot to return user

    with caplog.at_level("WARNING"):
        verify_and_register(db, reg["id"], hook_module=_hook_module(hook))

    user = db.get_item("user", reg["email"])
    assert user["roles"] == []
    assert any("returned" in r.message and "expected dict" in r.message
               for r in caplog.records)


# ── verify_and_register: existing-user path ─────────────────────────────────


def test_existing_user_skips_hook_and_flips_email_verified(db):
    """If the user table already has a record for user_id, just flip
    email_verified + status. Roles are preserved (no hook run)."""
    reg = _registration()
    db.insert_item("registration", reg["id"], reg)
    db.insert_item("user", reg["email"], {
        "id": reg["email"],
        "email": reg["email"],
        "email_verified": False,
        "status": "invited",
        "roles": ["preexisting"],
        "auth_provider": "local",
    })
    hook_calls = []

    def hook(u, r, d):
        hook_calls.append(1)
        u["roles"] = ["wrong"]
        return u

    result = verify_and_register(db, reg["id"], hook_module=_hook_module(hook))

    assert result["status"] == "user_existed"
    user = db.get_item("user", reg["email"])
    assert user["email_verified"] is True
    assert user["status"] == "active"
    assert user["roles"] == ["preexisting"]
    assert hook_calls == []


def test_existing_user_picks_up_tenant_id_from_registration(db):
    """If on_new_registration stamped a tenant_id and the user predated it,
    backfill the tenant_id onto the existing user."""
    reg = _registration(tenant_id="tenant-xyz")
    db.insert_item("registration", reg["id"], reg)
    db.insert_item("user", reg["email"], {
        "id": reg["email"],
        "email": reg["email"],
        "email_verified": False,
        "status": "invited",
        "roles": [],
        "tenant_id": None,
    })

    verify_and_register(db, reg["id"])

    user = db.get_item("user", reg["email"])
    assert user["tenant_id"] == "tenant-xyz"


def test_existing_user_does_not_overwrite_existing_tenant_id(db):
    """If the existing user already has a tenant_id, don't trample it."""
    reg = _registration(tenant_id="tenant-xyz")
    db.insert_item("registration", reg["id"], reg)
    db.insert_item("user", reg["email"], {
        "id": reg["email"],
        "email": reg["email"],
        "email_verified": False,
        "status": "invited",
        "roles": [],
        "tenant_id": "tenant-original",
    })

    verify_and_register(db, reg["id"])

    assert db.get_item("user", reg["email"])["tenant_id"] == "tenant-original"
