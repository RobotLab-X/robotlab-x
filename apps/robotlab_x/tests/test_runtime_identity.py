# unmanaged
"""Tests for runtime/identity.py — step 1 of multi-runtime federation.

Covers:
  * generate_id() yields adjective-noun shape
  * is_valid_id() format check (per the @<id> topic suffix grammar)
  * resolve_runtime_id picks: explicit > env > persisted > fresh+write
  * Cache + reset_for_tests round-trip
  * Fresh writes are persisted atomically (no half-written file on crash)
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Iterator

import pytest

from robotlab_x.runtime import identity


@pytest.fixture(autouse=True)
def _reset_cache_and_env(monkeypatch) -> Iterator[None]:
    """Every test starts with a fresh cache + no env override so we
    can be sure we're testing the path we think we are."""
    identity.reset_for_tests()
    monkeypatch.delenv("RLX_RUNTIME_ID", raising=False)
    yield
    identity.reset_for_tests()


# ─────────────────────────────────────────────────────────────────────
# generate_id + is_valid_id
# ─────────────────────────────────────────────────────────────────────


def test_generate_id_yields_two_parts_joined_by_hyphen():
    val = identity.generate_id()
    parts = val.split("-")
    assert len(parts) == 2
    assert all(p for p in parts)
    assert identity.is_valid_id(val)


def test_generate_id_varies_across_calls():
    """20 calls should not all return the same value — the pool has
    ~400 combinations so 20 identical draws would be a generator bug,
    not random luck."""
    seen = {identity.generate_id() for _ in range(20)}
    assert len(seen) > 1


def test_is_valid_id_format_constraints():
    assert identity.is_valid_id("funny-bot")
    assert identity.is_valid_id("a1")
    assert identity.is_valid_id("alpha-bravo-charlie")
    # Must start with a letter
    assert not identity.is_valid_id("1bot")
    # No uppercase
    assert not identity.is_valid_id("Funny-Bot")
    # No spaces / underscores / dots / @
    assert not identity.is_valid_id("funny bot")
    assert not identity.is_valid_id("funny_bot")
    assert not identity.is_valid_id("funny.bot")
    assert not identity.is_valid_id("funny@bot")
    # Empty + too long
    assert not identity.is_valid_id("")
    assert not identity.is_valid_id("x" * 100)
    # Not a string
    assert not identity.is_valid_id(None)        # type: ignore[arg-type]
    assert not identity.is_valid_id(12345)       # type: ignore[arg-type]


# ─────────────────────────────────────────────────────────────────────
# resolve_runtime_id priority: explicit > env > file > generate
# ─────────────────────────────────────────────────────────────────────


def test_resolve_explicit_arg_wins_over_env_and_file(tmp_path, monkeypatch):
    monkeypatch.setenv("RLX_RUNTIME_ID", "from-env")
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "runtime_id").write_text("from-file\n")
    out = identity.resolve_runtime_id(data_dir=tmp_path / "data", explicit="from-cli")
    assert out == "from-cli"
    # File untouched — explicit overrides are read-only
    assert (tmp_path / "data" / "runtime_id").read_text().strip() == "from-file"


def test_resolve_env_wins_over_file(tmp_path, monkeypatch):
    monkeypatch.setenv("RLX_RUNTIME_ID", "from-env")
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "runtime_id").write_text("from-file\n")
    out = identity.resolve_runtime_id(data_dir=tmp_path / "data")
    assert out == "from-env"
    assert (tmp_path / "data" / "runtime_id").read_text().strip() == "from-file"


def test_resolve_file_used_when_no_overrides(tmp_path):
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "runtime_id").write_text("from-file\n")
    out = identity.resolve_runtime_id(data_dir=tmp_path / "data")
    assert out == "from-file"


def test_resolve_generates_and_persists_when_nothing_exists(tmp_path):
    """The first boot writes the generated id to disk so subsequent
    boots are stable."""
    target = tmp_path / "data" / "runtime_id"
    assert not target.exists()
    out = identity.resolve_runtime_id(data_dir=tmp_path / "data")
    assert identity.is_valid_id(out)
    assert target.read_text().strip() == out


def test_resolve_recovers_from_malformed_persisted_file(tmp_path):
    """If the file content fails format check, fall back to generating
    a fresh id (and overwrite the bad file)."""
    target = tmp_path / "data" / "runtime_id"
    target.parent.mkdir()
    target.write_text("Garbage With Spaces!\n")
    out = identity.resolve_runtime_id(data_dir=tmp_path / "data")
    assert identity.is_valid_id(out)
    assert target.read_text().strip() == out
    assert target.read_text().strip() != "Garbage With Spaces!"


def test_resolve_rejects_invalid_explicit_then_falls_through(tmp_path, monkeypatch):
    monkeypatch.setenv("RLX_RUNTIME_ID", "from-env")
    out = identity.resolve_runtime_id(data_dir=tmp_path / "data", explicit="BAD ID")
    assert out == "from-env"


def test_resolve_rejects_invalid_env_then_falls_through(tmp_path, monkeypatch):
    monkeypatch.setenv("RLX_RUNTIME_ID", "BAD ID")
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "runtime_id").write_text("from-file\n")
    out = identity.resolve_runtime_id(data_dir=tmp_path / "data")
    assert out == "from-file"


# ─────────────────────────────────────────────────────────────────────
# settings_runtime_id — Pydantic-settings path (ROBOTLAB_X_RUNTIME_ID
# in .env). Lower priority than RLX_RUNTIME_ID but higher than the
# persisted file, so .env-driven overrides Just Work for one-shot
# launches without stomping the file.
# ─────────────────────────────────────────────────────────────────────


def test_settings_runtime_id_used_when_no_env_or_explicit(tmp_path):
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "runtime_id").write_text("from-file\n")
    out = identity.resolve_runtime_id(
        data_dir=tmp_path / "data", settings_runtime_id="from-settings",
    )
    assert out == "from-settings"
    # File untouched
    assert (tmp_path / "data" / "runtime_id").read_text().strip() == "from-file"


def test_rlx_env_beats_settings_runtime_id(tmp_path, monkeypatch):
    """RLX_RUNTIME_ID is the direct-knob override; settings is the
    standard pydantic-settings path. RLX wins on conflict."""
    monkeypatch.setenv("RLX_RUNTIME_ID", "from-rlx-env")
    out = identity.resolve_runtime_id(
        data_dir=tmp_path / "data", settings_runtime_id="from-settings",
    )
    assert out == "from-rlx-env"


def test_explicit_beats_settings_runtime_id(tmp_path):
    out = identity.resolve_runtime_id(
        data_dir=tmp_path / "data",
        explicit="from-cli",
        settings_runtime_id="from-settings",
    )
    assert out == "from-cli"


def test_invalid_settings_runtime_id_falls_through(tmp_path):
    """Garbage in settings → fall back to file/generate. We don't
    crash, we just ignore it."""
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "runtime_id").write_text("from-file\n")
    out = identity.resolve_runtime_id(
        data_dir=tmp_path / "data", settings_runtime_id="Bad Value!",
    )
    assert out == "from-file"


def test_none_settings_runtime_id_is_ignored(tmp_path):
    """Default Config value is None (no override). Same outcome as
    not passing the kwarg at all."""
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "runtime_id").write_text("from-file\n")
    out = identity.resolve_runtime_id(
        data_dir=tmp_path / "data", settings_runtime_id=None,
    )
    assert out == "from-file"


# ─────────────────────────────────────────────────────────────────────
# Cache + set_runtime_id
# ─────────────────────────────────────────────────────────────────────


def test_get_runtime_id_caches(tmp_path):
    """Two calls must return the same value — even if the disk file
    changes between them. The cache ensures one id per process."""
    target = tmp_path / "data" / "runtime_id"
    first = identity.get_runtime_id(data_dir=tmp_path / "data")
    # Mutate the file behind the cache's back
    target.write_text("different-name\n")
    second = identity.get_runtime_id(data_dir=tmp_path / "data")
    assert first == second


def test_set_runtime_id_seeds_cache():
    identity.set_runtime_id("seeded-bot")
    assert identity.get_runtime_id() == "seeded-bot"


def test_set_runtime_id_rejects_bad_format():
    with pytest.raises(ValueError):
        identity.set_runtime_id("Bad Name")


def test_reset_for_tests_clears_cache(tmp_path):
    identity.set_runtime_id("first-bot")
    assert identity.get_runtime_id() == "first-bot"
    identity.reset_for_tests()
    second = identity.get_runtime_id(data_dir=tmp_path / "data")
    assert second != "first-bot"   # generated fresh against tmp_path


# ─────────────────────────────────────────────────────────────────────
# Atomic write — no half-finished file on crash
# ─────────────────────────────────────────────────────────────────────


def test_write_uses_tmp_then_replace(tmp_path, monkeypatch):
    """Writes go through a sibling .tmp file then os.replace. If the
    process dies mid-write, the existing file (or absence) is
    untouched. We verify by stubbing Path.replace to count calls."""
    target = tmp_path / "data" / "runtime_id"
    target.parent.mkdir()
    target.write_text("existing-name\n")

    real_replace = Path.replace
    calls = []
    def tracked_replace(self, dst):
        calls.append((str(self), str(dst)))
        return real_replace(self, dst)
    monkeypatch.setattr(Path, "replace", tracked_replace)

    identity._write_persisted(target, "new-name")
    assert target.read_text().strip() == "new-name"
    assert len(calls) == 1
    src, dst = calls[0]
    assert src.endswith(".tmp")
    assert dst == str(target)
