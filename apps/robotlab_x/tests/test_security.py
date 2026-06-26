# unmanaged
"""Standalone tests for SecurityCore (stone 1 of config-sets).

These tests exercise the crypto + key management in isolation from the
rlx framework. The SecurityService wrapper is a thin async layer that
delegates to SecurityCore for everything substantive — covering Core
covers the contract.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from cryptography.fernet import Fernet, InvalidToken


# The security module ships under repo/security/1.0.0/. Make it
# importable for these tests without touching sys.path globally.
SECURITY_DIR = Path(__file__).parent.parent / "repo" / "security" / "1.0.0"
if str(SECURITY_DIR) not in sys.path:
    sys.path.insert(0, str(SECURITY_DIR))

from security import (  # noqa: E402  (path manipulation above)
    ENCRYPT_PREFIX,
    ENCRYPTED_PREFIX,
    SecurityCore,
)


def make_core(tmp_path: Path, **kwargs) -> SecurityCore:
    """Construct a SecurityCore with its key file pinned under tmp_path."""
    return SecurityCore(key_path=tmp_path / "key.bin", **kwargs)


# ─── round-trip ───────────────────────────────────────────────────────

def test_encrypt_decrypt_roundtrip(tmp_path):
    core = make_core(tmp_path)
    pt = "hello world"
    ct = core.encrypt(pt)
    assert ct.startswith(ENCRYPTED_PREFIX)
    assert core.decrypt(ct) == pt


def test_encrypt_strips_operator_seed_prefix(tmp_path):
    """`Encrypt--sekrit` should be encrypted as `sekrit`, not as
    `Encrypt--sekrit`. This is the operator-friendly path."""
    core = make_core(tmp_path)
    ct = core.encrypt(f"{ENCRYPT_PREFIX}sekrit")
    assert core.decrypt(ct) == "sekrit"


def test_encrypt_idempotent_on_already_encrypted(tmp_path):
    """Encrypting an already-Encrypted-- string returns it unchanged.
    Lets the loader walk a config tree without per-leaf prefix checks."""
    core = make_core(tmp_path)
    once = core.encrypt("once")
    twice = core.encrypt(once)
    assert once == twice
    assert core.decrypt(twice) == "once"


def test_unicode_plaintext(tmp_path):
    core = make_core(tmp_path)
    pt = "日本語🔐ünïcødé"
    ct = core.encrypt(pt)
    assert core.decrypt(ct) == pt


def test_empty_plaintext(tmp_path):
    core = make_core(tmp_path)
    ct = core.encrypt("")
    assert core.decrypt(ct) == ""


def test_plaintext_with_internal_prefix_not_stripped(tmp_path):
    """Only the LEADING `Encrypt--` is stripped — an internal occurrence
    of the prefix is part of the secret."""
    core = make_core(tmp_path)
    pt = f"prefix-not-mid-{ENCRYPT_PREFIX}embedded"
    ct = core.encrypt(pt)
    # Should encrypt the WHOLE thing (no leading prefix to strip).
    assert core.decrypt(ct) == pt


# ─── bad input ────────────────────────────────────────────────────────

def test_decrypt_missing_prefix_raises_value_error(tmp_path):
    core = make_core(tmp_path)
    with pytest.raises(ValueError, match="Encrypted--"):
        core.decrypt("not_a_token")


def test_decrypt_bad_token_raises_invalid_token(tmp_path):
    core = make_core(tmp_path)
    with pytest.raises(InvalidToken):
        core.decrypt(ENCRYPTED_PREFIX + "garbage_not_a_real_token")


def test_decrypt_empty_token_raises(tmp_path):
    core = make_core(tmp_path)
    with pytest.raises(InvalidToken):
        core.decrypt(ENCRYPTED_PREFIX)


# ─── key persistence ──────────────────────────────────────────────────

def test_key_generated_with_safe_permissions(tmp_path):
    """Auto-generated key file must be 0o600 (owner read+write only)."""
    make_core(tmp_path)
    key_path = tmp_path / "key.bin"
    assert key_path.is_file()
    mode = key_path.stat().st_mode & 0o777
    assert mode == 0o600, f"expected 0o600, got 0o{mode:03o}"


def test_key_persisted_across_instances(tmp_path):
    """A second instance loading the same key file decrypts the first's
    output — the key is on disk, not just in memory."""
    a = make_core(tmp_path)
    ct = a.encrypt("survives_restart")
    del a
    b = make_core(tmp_path)
    assert b.decrypt(ct) == "survives_restart"
    assert b.key_source.startswith("file:")
    assert "(generated)" not in b.key_source  # this run loaded the existing key


def test_wrong_key_fails_decrypt(tmp_path_factory):
    """Two cores with independent key files can't decrypt each other."""
    a_dir = tmp_path_factory.mktemp("a")
    b_dir = tmp_path_factory.mktemp("b")
    a = SecurityCore(key_path=a_dir / "key.bin")
    b = SecurityCore(key_path=b_dir / "key.bin")
    ct = a.encrypt("alice")
    with pytest.raises(InvalidToken):
        b.decrypt(ct)


# ─── key resolution priority ──────────────────────────────────────────

def test_env_var_override_takes_priority_over_file(tmp_path, monkeypatch):
    """Env var wins over an existing key file (and prevents one from
    being written)."""
    monkeypatch.setenv("RLX_TEST_KEY", Fernet.generate_key().decode("ascii"))
    core = make_core(tmp_path, env_var="RLX_TEST_KEY")
    assert "env:RLX_TEST_KEY" in core.key_source
    # No key file was written when env var supplied the key.
    assert not (tmp_path / "key.bin").exists()


def test_override_key_beats_env_and_file(tmp_path, monkeypatch):
    """Explicit override (used by tests and ops tooling) is the highest
    priority."""
    monkeypatch.setenv("RLX_TEST_KEY", Fernet.generate_key().decode("ascii"))
    override = Fernet.generate_key().decode("ascii")
    core = make_core(tmp_path, override_key=override, env_var="RLX_TEST_KEY")
    assert core.key_source == "override"
    # Roundtrip works with the override key.
    ct = core.encrypt("via_override")
    assert core.decrypt(ct) == "via_override"


def test_env_var_with_specific_key_decrypts_only_that_keys_output(
    tmp_path, monkeypatch
):
    """Sanity: switching the env var key invalidates ciphertext made
    under a different env var key."""
    k1 = Fernet.generate_key().decode("ascii")
    k2 = Fernet.generate_key().decode("ascii")
    monkeypatch.setenv("RLX_TEST_KEY", k1)
    a = make_core(tmp_path, env_var="RLX_TEST_KEY")
    ct = a.encrypt("under-k1")
    monkeypatch.setenv("RLX_TEST_KEY", k2)
    b = SecurityCore(key_path=tmp_path / "other.bin", env_var="RLX_TEST_KEY")
    with pytest.raises(InvalidToken):
        b.decrypt(ct)


def test_key_source_when_file_exists_does_not_say_generated(tmp_path):
    """First boot generates; later boots load. The key_source string
    distinguishes them — handy for ops audit."""
    first = make_core(tmp_path)
    assert "(generated)" in first.key_source
    second = make_core(tmp_path)
    assert "(generated)" not in second.key_source
    assert second.key_source.startswith("file:")
