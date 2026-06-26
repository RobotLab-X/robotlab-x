# unmanaged
"""Tests for the config-set loader (stone 2 of TODO_CONFIG_SETS).

These tests build mini config-set directories on tmp_path and drive the
loader end-to-end. Real registry manifests come from a one-time scan
of ``repo/`` so we exercise the actual type-resolution + Service-class
loading paths.

Encryption is tested via an injected ``decrypt_fn`` — the SecurityCore
itself has its own test file (test_security.py). Here we only verify
that the loader walks the tree, calls the function, and surfaces
failures properly.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Dict

import pytest

import yaml as _yaml  # noqa: F401  (writing yml in tests)

SRC = Path(__file__).parent.parent / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from robotlab_x.runtime.config_sets import (  # noqa: E402
    ENCRYPTED_PREFIX,
    SET_ENV_VAR,
    CandidateInfo,
    CapabilityUnsatisfied,
    ConfigSetMissing,
    DecryptError,
    ProxyYmlInvalid,
    ProxyYmlMissing,
    RuntimeYmlInvalid,
    TypeNotInRegistry,
    active_set_dir,
    active_set_name,
    check_capability,
    decrypt_tree,
    discover_candidates,
    load_config_set,
    load_proxy_yml,
    load_runtime_yml,
)
from robotlab_x.runtime.repo import scan_repo  # noqa: E402


REPO_DIR = Path(__file__).parent.parent / "repo"


@pytest.fixture(scope="module")
def manifests() -> Dict[str, "any"]:
    """Real registry manifests scanned from the in-repo types."""
    out = {m.id: m for m in scan_repo(REPO_DIR.resolve())}
    assert "clock@1.0.0" in out, "clock manifest missing — test repo broken"
    assert "security@1.0.0" in out, "security manifest missing — stone 1 not landed?"
    return out


def write_yml(path: Path, content: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    import yaml
    path.write_text(yaml.safe_dump(content))


# ─── active set resolution ────────────────────────────────────────────


def test_active_set_name_default(monkeypatch):
    monkeypatch.delenv(SET_ENV_VAR, raising=False)
    assert active_set_name() == "default"


def test_active_set_name_from_env(monkeypatch):
    monkeypatch.setenv(SET_ENV_VAR, "demo")
    assert active_set_name() == "demo"


def test_active_set_name_blank_env_falls_back(monkeypatch):
    monkeypatch.setenv(SET_ENV_VAR, "   ")
    assert active_set_name() == "default"


def test_active_set_dir_resolves_under_data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv(SET_ENV_VAR, "demo")
    assert active_set_dir(tmp_path) == (tmp_path / "config_sets" / "demo").resolve()


# ─── runtime.yml ──────────────────────────────────────────────────────


def test_load_runtime_yml_missing_file_returns_empty(tmp_path):
    rt = load_runtime_yml(tmp_path)
    assert rt.start_order == []


def test_load_runtime_yml_empty_file_returns_empty(tmp_path):
    (tmp_path / "runtime.yml").write_text("")
    rt = load_runtime_yml(tmp_path)
    assert rt.start_order == []


def test_load_runtime_yml_happy_path(tmp_path):
    write_yml(tmp_path / "runtime.yml", {"start_order": ["arduino-1", "servo-1"]})
    rt = load_runtime_yml(tmp_path)
    assert rt.start_order == ["arduino-1", "servo-1"]


def test_load_runtime_yml_not_a_mapping(tmp_path):
    (tmp_path / "runtime.yml").write_text("- foo\n- bar\n")
    with pytest.raises(RuntimeYmlInvalid, match="yaml mapping"):
        load_runtime_yml(tmp_path)


def test_load_runtime_yml_bad_start_order_shape(tmp_path):
    write_yml(tmp_path / "runtime.yml", {"start_order": "not_a_list"})
    with pytest.raises(RuntimeYmlInvalid, match="list of strings"):
        load_runtime_yml(tmp_path)


def test_load_runtime_yml_malformed_yaml(tmp_path):
    (tmp_path / "runtime.yml").write_text("start_order: [unclosed")
    with pytest.raises(RuntimeYmlInvalid, match="failed to parse"):
        load_runtime_yml(tmp_path)


# ─── decryption tree walk ─────────────────────────────────────────────


def test_decrypt_tree_no_op_when_fn_none():
    tree = {"a": "Encrypted--xxx", "b": "plain"}
    assert decrypt_tree(tree, None) == tree


def test_decrypt_tree_applies_to_matching_leaves():
    calls = []

    def fake_decrypt(s):
        calls.append(s)
        return s[len(ENCRYPTED_PREFIX):] + "_decrypted"

    tree = {"a": "Encrypted--abc", "b": "plain", "n": 42}
    out = decrypt_tree(tree, fake_decrypt)
    assert out == {"a": "abc_decrypted", "b": "plain", "n": 42}
    assert calls == ["Encrypted--abc"]


def test_decrypt_tree_recurses_into_dicts_and_lists():
    def fake(s):
        return s[len(ENCRYPTED_PREFIX):]

    tree = {
        "outer": {
            "list": ["plain", "Encrypted--secret1", 7],
            "nested": {"key": "Encrypted--secret2"},
        }
    }
    out = decrypt_tree(tree, fake)
    assert out["outer"]["list"] == ["plain", "secret1", 7]
    assert out["outer"]["nested"]["key"] == "secret2"


def test_decrypt_tree_does_not_mutate_input():
    def fake(s):
        return "plaintext"

    tree = {"a": "Encrypted--abc"}
    decrypt_tree(tree, fake)
    assert tree == {"a": "Encrypted--abc"}  # original untouched


def test_decrypt_tree_failure_wraps_as_decrypt_error():
    def bad(s):
        raise RuntimeError("kaboom")

    with pytest.raises(DecryptError, match="kaboom"):
        decrypt_tree({"a": "Encrypted--abc"}, bad)


# ─── load_proxy_yml ───────────────────────────────────────────────────


def test_load_proxy_yml_missing_file(tmp_path, manifests):
    with pytest.raises(ProxyYmlMissing):
        load_proxy_yml(tmp_path, "clock-99", manifests, REPO_DIR)


def test_load_proxy_yml_missing_type_field(tmp_path, manifests):
    write_yml(tmp_path / "clock-1.yml", {"interval_ms": 500})
    with pytest.raises(ProxyYmlInvalid, match="missing a top-level"):
        load_proxy_yml(tmp_path, "clock-1", manifests, REPO_DIR)


def test_load_proxy_yml_unknown_type(tmp_path, manifests):
    write_yml(tmp_path / "x-1.yml", {"type": "nonsense@99.0.0"})
    with pytest.raises(TypeNotInRegistry):
        load_proxy_yml(tmp_path, "x-1", manifests, REPO_DIR)


def test_load_proxy_yml_bare_name_resolves_to_unique_version(tmp_path, manifests):
    """If only one version of a type is installed, ``type: clock`` works
    without the @version suffix — friendly to operators."""
    write_yml(tmp_path / "clock-1.yml", {"type": "clock", "interval_ms": 250})
    entry = load_proxy_yml(tmp_path, "clock-1", manifests, REPO_DIR)
    assert entry.type_id == "clock@1.0.0"
    assert entry.config.interval_ms == 250


def test_load_proxy_yml_happy_path(tmp_path, manifests):
    write_yml(tmp_path / "clock-1.yml", {
        "type": "clock@1.0.0",
        "interval_ms": 1234,
    })
    entry = load_proxy_yml(tmp_path, "clock-1", manifests, REPO_DIR)
    assert entry.proxy_id == "clock-1"
    assert entry.type_id == "clock@1.0.0"
    assert entry.manifest.name == "clock"
    assert entry.config.interval_ms == 1234


def test_load_proxy_yml_validation_failure(tmp_path, manifests):
    """Pydantic catches bad values; we surface as ProxyYmlInvalid."""
    write_yml(tmp_path / "clock-1.yml", {
        "type": "clock@1.0.0",
        "interval_ms": 10,  # below ge=50 floor
    })
    with pytest.raises(ProxyYmlInvalid, match="config validation failed"):
        load_proxy_yml(tmp_path, "clock-1", manifests, REPO_DIR)


def test_load_proxy_yml_decrypt_walk_runs(tmp_path, manifests):
    """An Encrypted-- leaf goes through decrypt_fn before Pydantic sees it."""
    decoded = {}

    def fake_decrypt(s):
        decoded[s] = True
        return s[len(ENCRYPTED_PREFIX):]  # strip prefix → "plaintext"

    write_yml(tmp_path / "clock-1.yml", {
        "type": "clock@1.0.0",
        "interval_ms": 500,
        # ServiceConfig has extra="allow" so this extra field is accepted.
        "some_secret": "Encrypted--plaintext",
    })
    entry = load_proxy_yml(tmp_path, "clock-1", manifests, REPO_DIR, decrypt_fn=fake_decrypt)
    assert decoded == {"Encrypted--plaintext": True}
    # The validated config carries the decrypted value.
    assert getattr(entry.config, "some_secret", None) == "plaintext"


# ─── capability check ─────────────────────────────────────────────────


def test_check_capability_satisfied(manifests):
    from dataclasses import dataclass
    # Build a minimal LoadedEntry-like with requires=['crypto']
    m = manifests["security@1.0.0"]
    # security implements crypto, requires nothing — trivially satisfied
    from robotlab_x.runtime.config_sets import LoadedEntry
    entry = LoadedEntry(
        proxy_id="security",
        type_id="security@1.0.0",
        manifest=m,
        config=None,
    )
    check_capability(entry, set())  # no exception


def test_check_capability_unsatisfied(manifests):
    """Build a synthetic LoadedEntry whose requires list isn't in
    provided. Real services from the in-repo registry happen to all
    have empty requires, so we patch a copy of the clock manifest."""
    from copy import deepcopy
    from robotlab_x.runtime.config_sets import LoadedEntry
    m = deepcopy(manifests["clock@1.0.0"])
    m.requires = ["some_capability"]
    entry = LoadedEntry(
        proxy_id="clock-1", type_id=m.id, manifest=m, config=None,
    )
    with pytest.raises(CapabilityUnsatisfied, match="some_capability"):
        check_capability(entry, set())


def test_check_capability_satisfied_by_provided(manifests):
    from copy import deepcopy
    from robotlab_x.runtime.config_sets import LoadedEntry
    m = deepcopy(manifests["clock@1.0.0"])
    m.requires = ["crypto"]
    entry = LoadedEntry(
        proxy_id="clock-1", type_id=m.id, manifest=m, config=None,
    )
    check_capability(entry, {"crypto"})  # ok


# ─── candidates ───────────────────────────────────────────────────────


def test_discover_candidates_empty_dir(tmp_path):
    assert discover_candidates(tmp_path, []) == []


def test_discover_candidates_excludes_start_order_and_runtime_yml(tmp_path):
    write_yml(tmp_path / "runtime.yml", {"start_order": ["a"]})
    write_yml(tmp_path / "a.yml", {"type": "clock@1.0.0"})
    write_yml(tmp_path / "b.yml", {"type": "clock@1.0.0"})  # candidate
    write_yml(tmp_path / "c.yml", {"type": "clock@1.0.0"})  # candidate
    cands = discover_candidates(tmp_path, ["a"])
    names = sorted(c.proxy_id for c in cands)
    assert names == ["b", "c"]


def test_discover_candidates_records_parse_failures(tmp_path):
    (tmp_path / "broken.yml").write_text("not: valid: yml: :")
    cands = discover_candidates(tmp_path, [])
    assert len(cands) == 1
    assert cands[0].proxy_id == "broken"
    assert cands[0].parse_error is not None


def test_discover_candidates_records_missing_type(tmp_path):
    write_yml(tmp_path / "no_type.yml", {"interval_ms": 500})
    cands = discover_candidates(tmp_path, [])
    assert len(cands) == 1
    assert cands[0].proxy_id == "no_type"
    assert cands[0].type_id is None
    assert cands[0].parse_error == "no type: field"


# ─── end-to-end ───────────────────────────────────────────────────────


def test_load_config_set_missing_dir_raises(tmp_path):
    with pytest.raises(ConfigSetMissing):
        list(load_config_set(tmp_path / "does_not_exist", {}, REPO_DIR))


def test_load_config_set_happy_path(tmp_path, manifests):
    """One clock-1.yml + a matching runtime.yml → one yielded entry."""
    write_yml(tmp_path / "runtime.yml", {"start_order": ["clock-1"]})
    write_yml(tmp_path / "clock-1.yml", {"type": "clock@1.0.0", "interval_ms": 500})
    entries = list(load_config_set(tmp_path, manifests, REPO_DIR))
    assert len(entries) == 1
    assert entries[0].proxy_id == "clock-1"
    assert entries[0].config.interval_ms == 500


def test_load_config_set_extra_start_order_prepended(tmp_path, manifests):
    """Singletons get prepended via extra_start_order (stone 4 supplies this)."""
    write_yml(tmp_path / "runtime.yml", {"start_order": ["clock-1"]})
    write_yml(tmp_path / "clock-1.yml", {"type": "clock@1.0.0"})
    write_yml(tmp_path / "security.yml", {"type": "security@1.0.0"})
    entries = list(load_config_set(
        tmp_path, manifests, REPO_DIR, extra_start_order=["security"],
    ))
    assert [e.proxy_id for e in entries] == ["security", "clock-1"]


def test_load_config_set_dedup_extra_with_user_listed(tmp_path, manifests):
    """If user listed a singleton in start_order, don't double-add it."""
    write_yml(tmp_path / "runtime.yml", {"start_order": ["security", "clock-1"]})
    write_yml(tmp_path / "security.yml", {"type": "security@1.0.0"})
    write_yml(tmp_path / "clock-1.yml", {"type": "clock@1.0.0"})
    entries = list(load_config_set(
        tmp_path, manifests, REPO_DIR, extra_start_order=["security"],
    ))
    ids = [e.proxy_id for e in entries]
    assert ids == ["security", "clock-1"]
    assert ids.count("security") == 1


def test_load_config_set_missing_proxy_yml_aborts(tmp_path, manifests):
    write_yml(tmp_path / "runtime.yml", {"start_order": ["clock-1", "ghost-1"]})
    write_yml(tmp_path / "clock-1.yml", {"type": "clock@1.0.0"})
    it = load_config_set(tmp_path, manifests, REPO_DIR)
    first = next(it)
    assert first.proxy_id == "clock-1"
    with pytest.raises(ProxyYmlMissing):
        next(it)


def test_load_config_set_capability_check_runs(tmp_path, manifests):
    """Synthetically require a capability nobody provides; expect failure."""
    from copy import deepcopy
    m = deepcopy(manifests["clock@1.0.0"])
    m.requires = ["nonexistent_capability"]
    local_manifests = dict(manifests)
    local_manifests[m.id] = m  # override

    write_yml(tmp_path / "runtime.yml", {"start_order": ["clock-1"]})
    write_yml(tmp_path / "clock-1.yml", {"type": "clock@1.0.0"})
    with pytest.raises(CapabilityUnsatisfied, match="nonexistent_capability"):
        list(load_config_set(tmp_path, local_manifests, REPO_DIR))


def test_load_config_set_capability_satisfied_by_prior_entry(tmp_path, manifests):
    """A later proxy requires something an earlier proxy implements."""
    from copy import deepcopy
    consumer = deepcopy(manifests["clock@1.0.0"])
    consumer.requires = ["crypto"]
    local_manifests = dict(manifests)
    local_manifests[consumer.id] = consumer

    # security implements crypto; it goes first.
    write_yml(tmp_path / "runtime.yml", {"start_order": ["security", "clock-1"]})
    write_yml(tmp_path / "security.yml", {"type": "security@1.0.0"})
    write_yml(tmp_path / "clock-1.yml", {"type": "clock@1.0.0"})
    entries = list(load_config_set(tmp_path, local_manifests, REPO_DIR))
    assert [e.proxy_id for e in entries] == ["security", "clock-1"]


# ─────────────────────────────────────────────────────────────────────
# Regression: save_proxy_yml must serialize NESTED Pydantic models.
#
# A config whose fields hold live BaseModel instances (e.g. a
# motor_control MotorControlConfig with channels: List[MotorChannel],
# or an ik_solver config with joints) used to crash yaml.safe_dump with
# RepresenterError — silently aborting the whole save so the operator's
# yml stayed frozen at its last all-scalar state (channels lost, no
# desired_state written). _unwrap_for_serialization now recurses into
# BaseModel instances. These tests pin that.
# ─────────────────────────────────────────────────────────────────────


def test_save_proxy_yml_serializes_nested_models(tmp_path):
    from pydantic import BaseModel
    from robotlab_x.runtime.config_sets import save_proxy_yml

    class Inner(BaseModel):
        topic: str
        index: int = 0

    class Channel(BaseModel):
        id: str
        motor: int = 1
        input_source: "Inner | None" = None

    class Cfg(BaseModel):
        channels: list = []

    cfg = Cfg(channels=[
        Channel(id="left", motor=1, input_source=Inner(topic="/joystick/joystick-1/input", index=3)),
        Channel(id="right", motor=2),
    ])

    path = save_proxy_yml(tmp_path, "motor_control-1", "motor_control@1.0.0", cfg)
    loaded = _yaml.safe_load(path.read_text())

    assert loaded["type"] == "motor_control@1.0.0"
    assert isinstance(loaded["channels"], list) and len(loaded["channels"]) == 2
    left = loaded["channels"][0]
    # nested model became a plain dict, not a !!python object tag
    assert left == {"id": "left", "motor": 1,
                    "input_source": {"topic": "/joystick/joystick-1/input", "index": 3}}
    assert loaded["channels"][1]["input_source"] is None


def test_save_proxy_yml_writes_desired_state(tmp_path):
    from pydantic import BaseModel
    from robotlab_x.runtime.config_sets import save_proxy_yml

    class Cfg(BaseModel):
        channels: list = []

    path = save_proxy_yml(tmp_path, "motor_control-1", "motor_control@1.0.0",
                          Cfg(channels=[]), desired_state="running")
    loaded = _yaml.safe_load(path.read_text())
    assert loaded["desired_state"] == "running"
