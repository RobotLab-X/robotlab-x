import tempfile
import shutil
import os
import pytest
from auth.local_auth import LocalAuthProvider
from database.factory import create_database_client, get_database_client
from models.database_tinydb_config import DatabaseTinydbConfig

@pytest.fixture
def tinydb_instance():
    temp_dir = tempfile.mkdtemp()
    config = DatabaseTinydbConfig()  # use all defaults
    create_database_client(config)
    db = get_database_client()  # default name
    yield db
    shutil.rmtree(temp_dir)

@pytest.fixture
def auth_provider(tinydb_instance):
    config = {"foo": "bar"}
    LocalAuthProvider._instance = None
    provider = LocalAuthProvider(config)
    provider.database = tinydb_instance
    return provider

def test_register_and_authenticate(auth_provider):
    username = "testuser@example.com"
    password = "testpass"
    # Remove user if it already exists for idempotency
    if auth_provider.database.get_item("user", username):
        auth_provider.database.delete_item("user", username)
    result = auth_provider.register_user(username, password_hash=auth_provider.generate_hash(password))
    assert result["username"] == username
    token = auth_provider.authenticate(username, password)
    assert token is not None
    user = auth_provider.get_user(token)
    assert user["id"] == username
    assert user["email"] == username
    assert auth_provider.logout(token) is True

def test_register_duplicate_user(auth_provider):
    username = "dupe@example.com"
    password_hash = auth_provider.generate_hash("pw")
    # Remove user if it already exists for idempotency
    if auth_provider.database.get_item("user", username):
        auth_provider.database.delete_item("user", username)
    auth_provider.register_user(username, password_hash=password_hash)
    with pytest.raises(ValueError):
        auth_provider.register_user(username, password_hash=password_hash)

def test_authenticate_wrong_password(auth_provider):
    username = "wrongpw@example.com"
    password = "pw1"
    # Remove user if it already exists for idempotency
    if auth_provider.database.get_item("user", username):
        auth_provider.database.delete_item("user", username)
    auth_provider.register_user(username, password_hash=auth_provider.generate_hash(password))
    assert auth_provider.authenticate(username, "badpw") is None

def test_generate_token_and_refresh(auth_provider):
    user = {"id": "refresh@example.com", "email": "refresh@example.com", "roles": ["User"]}
    # Remove user if it already exists for idempotency
    if auth_provider.database.get_item("user", user["id"]):
        auth_provider.database.delete_item("user", user["id"])
    auth_provider.database.insert_item("user", user["id"], user)
    token = auth_provider.generate_token(user)
    assert token is not None
    new_token = auth_provider.refresh_token(token)
    assert new_token is not None
    assert isinstance(new_token, str)


# ---------------------------------------------------------------------------
# Access-token TTL resolution + override
# ---------------------------------------------------------------------------

import jwt
from auth.local_auth import (
    JWT_SECRET_KEY,
    JWT_EXPIRATION_MINUTES_DEFAULT,
    _resolve_jwt_expiration_minutes,
)


def test_resolve_ttl_default_when_no_overrides(monkeypatch):
    monkeypatch.delenv("JWT_EXPIRATION_MINUTES", raising=False)
    assert _resolve_jwt_expiration_minutes() == JWT_EXPIRATION_MINUTES_DEFAULT


def test_resolve_ttl_uses_env_var_when_present(monkeypatch):
    monkeypatch.setenv("JWT_EXPIRATION_MINUTES", "7")
    assert _resolve_jwt_expiration_minutes() == 7


def test_resolve_ttl_env_var_wins_over_explicit_arg(monkeypatch):
    """Env var is the local-test escape hatch; it wins over the per-deployment hook."""
    monkeypatch.setenv("JWT_EXPIRATION_MINUTES", "7")
    assert _resolve_jwt_expiration_minutes(ttl_minutes=3) == 7


def test_resolve_ttl_explicit_arg_used_when_no_env(monkeypatch):
    """Without the env-var override, the explicit arg drives TTL."""
    monkeypatch.delenv("JWT_EXPIRATION_MINUTES", raising=False)
    assert _resolve_jwt_expiration_minutes(ttl_minutes=3) == 3


def test_resolve_ttl_invalid_env_falls_back_to_default(monkeypatch):
    monkeypatch.setenv("JWT_EXPIRATION_MINUTES", "not-a-number")
    assert _resolve_jwt_expiration_minutes() == JWT_EXPIRATION_MINUTES_DEFAULT


def test_resolve_ttl_zero_or_negative_ignored(monkeypatch):
    monkeypatch.delenv("JWT_EXPIRATION_MINUTES", raising=False)
    # Negative or zero is treated as "no override" — fall through to default
    assert _resolve_jwt_expiration_minutes(ttl_minutes=0) == JWT_EXPIRATION_MINUTES_DEFAULT
    assert _resolve_jwt_expiration_minutes(ttl_minutes=-1) == JWT_EXPIRATION_MINUTES_DEFAULT


def test_generate_token_respects_ttl_minutes_arg(auth_provider):
    user = {"id": "ttl@example.com", "email": "ttl@example.com"}
    token = auth_provider.generate_token(user, ttl_minutes=2)
    decoded = jwt.decode(token, JWT_SECRET_KEY, algorithms=["HS256"])
    # exp should be roughly now + 2 minutes (120s), allow drift for test runtime
    import time
    exp = decoded["exp"]
    delta = exp - int(time.time())
    assert 110 <= delta <= 130, f"Expected ~120s, got {delta}s"


def test_generate_token_falls_back_to_env_when_no_arg(auth_provider, monkeypatch):
    monkeypatch.setenv("JWT_EXPIRATION_MINUTES", "4")
    user = {"id": "envttl@example.com", "email": "envttl@example.com"}
    token = auth_provider.generate_token(user)
    decoded = jwt.decode(token, JWT_SECRET_KEY, algorithms=["HS256"])
    import time
    delta = decoded["exp"] - int(time.time())
    assert 230 <= delta <= 250, f"Expected ~240s (4 min), got {delta}s"
