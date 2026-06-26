# unmanaged
"""Tests for the boot-time bridge from ROBOTLAB_X_JWT_SECRET to
JWT_SECRET_KEY.

Without the bridge, .env files using the standard ROBOTLAB_X_* naming
have no effect on auth — the auth code reads JWT_SECRET_KEY directly,
falls back to "fallback_dev_key" otherwise. That's a silent footgun
for federation (peer A signs with the right secret because someone
set JWT_SECRET_KEY; peer B uses the fallback because they only set
ROBOTLAB_X_JWT_SECRET → 403 at handshake).
"""
from __future__ import annotations

import os

import pytest

from robotlab_x.event_handlers import _bridge_jwt_secret


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    """Each test starts with both vars cleared so we can assert
    exactly what got set."""
    monkeypatch.delenv("JWT_SECRET_KEY", raising=False)
    monkeypatch.delenv("ROBOTLAB_X_JWT_SECRET", raising=False)
    yield


def test_bridge_copies_when_target_unset(monkeypatch):
    monkeypatch.setenv("ROBOTLAB_X_JWT_SECRET", "my-secret-123")
    _bridge_jwt_secret()
    assert os.environ.get("JWT_SECRET_KEY") == "my-secret-123"


def test_existing_jwt_secret_key_wins(monkeypatch):
    """Direct override path — power users can set JWT_SECRET_KEY
    in their shell to override .env without editing files."""
    monkeypatch.setenv("ROBOTLAB_X_JWT_SECRET", "from-dotenv")
    monkeypatch.setenv("JWT_SECRET_KEY", "from-shell-override")
    _bridge_jwt_secret()
    assert os.environ.get("JWT_SECRET_KEY") == "from-shell-override"


def test_no_op_when_neither_set():
    """Boot without any JWT env var configured — bridge does nothing,
    downstream auth code falls back to 'fallback_dev_key' as before."""
    _bridge_jwt_secret()
    assert "JWT_SECRET_KEY" not in os.environ


def test_empty_robotlab_secret_does_not_override(monkeypatch):
    """An empty ROBOTLAB_X_JWT_SECRET (someone left ``=`` blank in
    .env) shouldn't blow away a working JWT_SECRET_KEY."""
    monkeypatch.setenv("ROBOTLAB_X_JWT_SECRET", "")
    monkeypatch.setenv("JWT_SECRET_KEY", "real-secret")
    _bridge_jwt_secret()
    assert os.environ.get("JWT_SECRET_KEY") == "real-secret"


def test_empty_target_not_treated_as_set(monkeypatch):
    """JWT_SECRET_KEY="" should bridge — empty string is falsy so the
    early-return doesn't trigger. Documents the contract that 'unset'
    and 'empty' are both replaceable by ROBOTLAB_X_JWT_SECRET."""
    monkeypatch.setenv("JWT_SECRET_KEY", "")
    monkeypatch.setenv("ROBOTLAB_X_JWT_SECRET", "from-bridge")
    _bridge_jwt_secret()
    assert os.environ.get("JWT_SECRET_KEY") == "from-bridge"


# ─────────────────────────────────────────────────────────────────────
# CLI --env_file parsing — done in robotlab_x/__init__.py so the early
# bootstrap can override the default .env when the user passes
# ``--env_file .env.peer``. The function only PEEKS at sys.argv; it
# doesn't consume args (main.py re-parses with argparse).
# ─────────────────────────────────────────────────────────────────────


def _argv(*xs: str) -> list[str]:
    """Build a sys.argv stand-in. First slot is the program name."""
    return ["robotlab_x", *xs]


def test_cli_env_file_underscore_form(monkeypatch):
    from robotlab_x import _cli_env_file
    monkeypatch.setattr("sys.argv", _argv("--env_file", ".env.peer"))
    assert _cli_env_file() == ".env.peer"


def test_cli_env_file_dash_form(monkeypatch):
    from robotlab_x import _cli_env_file
    monkeypatch.setattr("sys.argv", _argv("--env-file", ".env.peer"))
    assert _cli_env_file() == ".env.peer"


def test_cli_env_file_equals_form(monkeypatch):
    from robotlab_x import _cli_env_file
    monkeypatch.setattr("sys.argv", _argv("--env_file=.env.peer"))
    assert _cli_env_file() == ".env.peer"


def test_cli_env_file_none_when_absent(monkeypatch):
    from robotlab_x import _cli_env_file
    monkeypatch.setattr("sys.argv", _argv("--something", "else"))
    assert _cli_env_file() is None


def test_cli_env_file_handles_trailing_flag_without_value(monkeypatch):
    """``--env_file`` at the end of argv with no value following — be
    forgiving (return None) rather than IndexError-crash before main.py
    even gets to argparse."""
    from robotlab_x import _cli_env_file
    monkeypatch.setattr("sys.argv", _argv("--env_file"))
    assert _cli_env_file() is None
