# unmanaged
"""Tests for the Service base's auto-mounted config API (stone 3 of
the config-sets spec).

Built around a minimal in-test ``EchoService`` subclass that has a
realistic mix of fields (plain str, int, SecretStr, optional). Exercises
the full save / load / reload / set_config flow against the real file
loader from stone 2.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Optional

import pytest
import yaml
from pydantic import Field, SecretStr

SRC = Path(__file__).parent.parent / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from rlx_bus import ServiceConfig  # noqa: E402
from robotlab_x.framework import Service, service_method  # noqa: E402
from robotlab_x.framework.service import ServiceMetadata  # noqa: E402
from robotlab_x.runtime.config_sets import (  # noqa: E402
    ENCRYPTED_PREFIX,
    save_proxy_yml,
)

# Stone 1's SecurityCore — used in tests that need realistic encrypt/
# decrypt round-trips (the fake we used initially didn't mimic the
# Encrypt-- prefix-stripping behavior).
SECURITY_DIR = Path(__file__).parent.parent / "repo" / "security" / "1.0.0"
if str(SECURITY_DIR) not in sys.path:
    sys.path.insert(0, str(SECURITY_DIR))
from security import SecurityCore  # noqa: E402


# ─── encrypt walk + SecretStr round-trip ──────────────────────────────


class EchoConfig(ServiceConfig):
    """Minimal mixed-shape config."""
    label: str = "default"
    count: int = Field(1, ge=1, le=99)
    api_key: Optional[SecretStr] = None
    note: Optional[str] = None


class EchoService(Service):
    """Subclass-of-Service whose only job is to record apply_config calls
    so tests can observe live propagation."""
    type_name = "echo"
    config_class = EchoConfig

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.apply_calls: list = []

    async def apply_config(self, diff):
        # Record every call for assertions; default base impl is a no-op.
        self.apply_calls.append(diff)


def make_echo(tmp_path, **cfg_kwargs) -> EchoService:
    """Build a wired-up EchoService rooted under tmp_path."""
    meta = ServiceMetadata(
        proxy_id="echo-1",
        service_meta_id="echo@1.0.0",
        type_name="echo",
        type_version="1.0.0",
        tags=[],
        singleton=False,
    )
    svc = EchoService(meta, dict(cfg_kwargs))
    # Pin the proxy yml path to tmp_path so save_config writes into the
    # test sandbox instead of touching the project's data/ dir.
    set_dir = tmp_path / "config_sets" / "default"
    svc._proxy_yml_path = lambda: set_dir / f"{svc.proxy_id}.yml"  # type: ignore
    # Disable the legacy DB mirror — these tests don't spin up TinyDB.
    svc._save_config_to_db_legacy = lambda: None  # type: ignore
    return svc


# ─── auto-mount discovery ────────────────────────────────────────────


def test_auto_mounted_methods_appear_on_subclass(tmp_path):
    """get_config / set_config / save_config / reload_config show up
    on any subclass for free via @service_method inheritance."""
    svc = make_echo(tmp_path)
    names = {m.name for m in svc.methods()}
    assert {"get_config", "set_config", "save_config", "reload_config"} <= names


# ─── get_config masks SecretStr ──────────────────────────────────────


def test_get_config_masks_secrets(tmp_path):
    svc = make_echo(tmp_path, label="a", count=3, api_key="sk-FAKE-12345")
    out = svc.get_config()
    assert out["label"] == "a"
    assert out["count"] == 3
    assert out["api_key"] == "**********"
    assert out["note"] is None


def test_get_config_with_no_secrets_returns_plain(tmp_path):
    svc = make_echo(tmp_path, label="hi", count=7)
    out = svc.get_config()
    assert out == {
        "topic_remap": {},  # inherited from ServiceConfig
        "label": "hi",
        "count": 7,
        "api_key": None,
        "note": None,
    }


# ─── save_config writes yml ──────────────────────────────────────────


def test_save_config_writes_yml_with_type_field(tmp_path):
    svc = make_echo(tmp_path, label="hi", count=5)
    result = svc.save_config()
    assert result["ok"] is True
    path = Path(result["path"])
    assert path.is_file()
    data = yaml.safe_load(path.read_text())
    assert data["type"] == "echo@1.0.0"
    assert data["label"] == "hi"
    assert data["count"] == 5


def test_save_config_refuses_secrets_without_security(tmp_path):
    """SecretStr field with a plaintext value + no security service →
    refuse to write. Secrets must never reach disk in plaintext."""
    svc = make_echo(tmp_path, api_key="sk-FAKE")
    # Force "no security available". Without this the framework's
    # _get_local_security_core() bootstraps a core straight from
    # repo/security (always present in-repo) + an auto-generated key, so
    # the secret would be encrypted rather than refused — the guard only
    # fires when NO core can be built. Mirrors the sibling tests, which
    # also drive _security_encrypt directly.
    svc._security_encrypt = lambda: None  # type: ignore
    result = svc.save_config()
    assert result["ok"] is False
    assert "security service" in result["error"].lower()
    # File must NOT have been written.
    assert not (tmp_path / "config_sets" / "default" / "echo-1.yml").exists()


def test_save_config_encrypts_secrets_when_security_available(tmp_path):
    """SecretStr field with security present → plaintext gets encrypted
    on the way to disk. Uses the real SecurityCore so we verify the
    actual encrypt contract (strip Encrypt-- prefix, etc.)."""
    core = SecurityCore(key_path=tmp_path / "security_key.bin")
    svc = make_echo(tmp_path, api_key="sk-FAKE-67890")
    svc._security_encrypt = lambda: core.encrypt  # type: ignore

    result = svc.save_config()
    assert result["ok"] is True

    written = yaml.safe_load(Path(result["path"]).read_text())
    assert written["api_key"].startswith(ENCRYPTED_PREFIX)
    # Plaintext absent — the file does NOT contain "sk-FAKE-67890".
    assert "sk-FAKE-67890" not in yaml.safe_dump(written)
    # Reverse the round-trip: decrypt the stored token → original.
    assert core.decrypt(written["api_key"]) == "sk-FAKE-67890"


def test_save_config_no_secrets_works_without_security(tmp_path):
    """Configs without any secret fields save fine even with no
    security service available."""
    svc = make_echo(tmp_path, label="plain", count=2)
    # Explicitly null out the security resolver
    svc._security_encrypt = lambda: None  # type: ignore
    result = svc.save_config()
    assert result["ok"] is True


# ─── set_config: validate + persist + apply ─────────────────────────


def run_async(coro):
    """Run an async coroutine to completion in a fresh loop."""
    return asyncio.new_event_loop().run_until_complete(coro)


def test_set_config_validates_patch(tmp_path):
    svc = make_echo(tmp_path, label="orig", count=5)
    # count >= 1 and <= 99
    result = run_async(svc.set_config({"count": 200}))
    assert result["ok"] is False
    assert "validation failed" in result["error"]
    # State unchanged
    assert svc.config.count == 5


def test_set_config_writes_file_and_swaps_in_memory(tmp_path):
    svc = make_echo(tmp_path, label="orig", count=5)
    result = run_async(svc.set_config({"label": "new", "count": 7}))
    assert result["ok"] is True
    assert result["diff"] == {"label": "new", "count": 7}
    assert svc.config.label == "new"
    assert svc.config.count == 7
    # File on disk reflects the new state
    data = yaml.safe_load(Path(result["path"]).read_text())
    assert data["label"] == "new"
    assert data["count"] == 7


def test_set_config_calls_apply_with_diff_only(tmp_path):
    svc = make_echo(tmp_path, label="orig", count=5)
    run_async(svc.set_config({"label": "new"}))  # count unchanged
    assert len(svc.apply_calls) == 1
    assert svc.apply_calls[0] == {"label": "new"}
    # No-op patch → still calls apply with empty diff (current behavior)
    run_async(svc.set_config({"label": "new"}))
    assert svc.apply_calls[1] == {}


def test_set_config_rolls_back_on_persist_failure(tmp_path):
    svc = make_echo(tmp_path, label="orig", count=5)
    # Force the save path to fail
    svc.save_config = lambda: {"ok": False, "error": "disk full"}  # type: ignore
    result = run_async(svc.set_config({"label": "new"}))
    assert result["ok"] is False
    assert "persist failed" in result["error"]
    # In-memory state rolled back to the original
    assert svc.config.label == "orig"


def test_set_config_masks_secret_in_diff(tmp_path):
    core = SecurityCore(key_path=tmp_path / "k.bin")
    svc = make_echo(tmp_path, label="x", count=1)
    svc._security_encrypt = lambda: core.encrypt  # type: ignore
    result = run_async(svc.set_config({"api_key": "sk-NEW-KEY"}))
    assert result["ok"] is True
    # Diff masks the new SecretStr value — operator sees the field
    # changed without leaking the plaintext over the wire.
    assert result["diff"]["api_key"] == "**********"


def test_set_config_non_dict_patch_rejected(tmp_path):
    svc = make_echo(tmp_path)
    result = run_async(svc.set_config("not a dict"))  # type: ignore
    assert result["ok"] is False
    assert "patch must be a dict" in result["error"]


# ─── reload_config: read file, apply diff ────────────────────────────


def test_reload_config_picks_up_external_edit(tmp_path):
    svc = make_echo(tmp_path, label="orig", count=5)
    # Operator-edited yml on disk (no encryption, no secrets)
    set_dir = tmp_path / "config_sets" / "default"
    save_proxy_yml(
        set_dir, "echo-1", "echo@1.0.0",
        EchoConfig(label="edited_externally", count=12),
        encrypt_fn=None,
    )
    result = run_async(svc.reload_config())
    assert result["ok"] is True
    assert result["diff"] == {"label": "edited_externally", "count": 12}
    assert svc.config.label == "edited_externally"
    assert svc.config.count == 12
    assert len(svc.apply_calls) == 1


def test_reload_config_missing_file(tmp_path):
    svc = make_echo(tmp_path, label="orig")
    result = run_async(svc.reload_config())
    assert result["ok"] is False
    assert "file not found" in result["error"]


def test_reload_config_validation_failure_keeps_old_state(tmp_path):
    svc = make_echo(tmp_path, label="orig", count=5)
    # Write a yml with an invalid count manually
    set_dir = tmp_path / "config_sets" / "default"
    set_dir.mkdir(parents=True)
    (set_dir / "echo-1.yml").write_text(yaml.safe_dump({
        "type": "echo@1.0.0",
        "count": 999,  # exceeds le=99
    }))
    result = run_async(svc.reload_config())
    assert result["ok"] is False
    assert "validation failed" in result["error"]
    assert svc.config.count == 5  # unchanged


# ─── apply_config default no-op ──────────────────────────────────────


class BareEchoService(Service):
    type_name = "echo"
    config_class = EchoConfig


def test_apply_config_default_is_no_op(tmp_path):
    """A subclass that doesn't override apply_config still works — the
    base default is a no-op."""
    meta = ServiceMetadata(
        proxy_id="echo-bare",
        service_meta_id="echo@1.0.0",
        type_name="echo",
        type_version="1.0.0",
        tags=[],
        singleton=False,
    )
    svc = BareEchoService(meta, {"label": "x", "count": 1})
    svc._proxy_yml_path = lambda: tmp_path / "config_sets" / "default" / "echo-bare.yml"
    svc._save_config_to_db_legacy = lambda: None  # type: ignore
    result = run_async(svc.set_config({"label": "y"}))
    assert result["ok"] is True
    # No assertion about apply being called — base default is a no-op,
    # we just confirm the path completes without error.


# ─── diff edge cases ─────────────────────────────────────────────────


def test_diff_secret_only_change_records_field_name(tmp_path):
    core = SecurityCore(key_path=tmp_path / "k.bin")
    svc = make_echo(tmp_path, label="x", count=1, api_key="old_value")
    svc._security_encrypt = lambda: core.encrypt  # type: ignore
    result = run_async(svc.set_config({"api_key": "new_value"}))
    assert result["ok"] is True
    assert "api_key" in result["diff"]
    assert result["diff"]["api_key"] == "**********"


def test_diff_clearing_optional_field(tmp_path):
    svc = make_echo(tmp_path, label="x", count=1, note="something")
    result = run_async(svc.set_config({"note": None}))
    assert result["ok"] is True
    assert result["diff"] == {"note": None}
