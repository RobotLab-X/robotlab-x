# unmanaged
"""Tests for boot-from-config-set (stone 4)."""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest
import yaml

SRC = Path(__file__).parent.parent / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

REPO_DIR = Path(__file__).parent.parent / "repo"

from robotlab_x.runtime.boot import (  # noqa: E402
    MIGRATION_MARKER,
    _set_is_empty,
    bootstrap_security_core,
    migrate_db_to_config_set,
    sync_config_set_to_db,
)
from robotlab_x.runtime.repo import scan_repo  # noqa: E402


@pytest.fixture(scope="module")
def manifests():
    return {m.id: m for m in scan_repo(REPO_DIR.resolve())}


# ─── stub DB (in-memory, mimics TinyDB adapter surface) ───────────────


class StubDB:
    """Minimal in-memory stand-in for the DatabaseAdapter used by boot.py.

    Only the methods boot.py calls are implemented; everything else
    would never be exercised in stone-4 tests."""

    def __init__(self):
        self.tables: Dict[str, Dict[str, Any]] = {"service_proxy": {}}

    def get_all_items(self, table: str) -> List[Dict[str, Any]]:
        return list(self.tables.get(table, {}).values())

    def get_item(self, table: str, key: str) -> Optional[Dict[str, Any]]:
        return self.tables.get(table, {}).get(key)

    def insert_item(self, table: str, key: str, row: Dict[str, Any]) -> None:
        self.tables.setdefault(table, {})[key] = dict(row)

    def update_item(self, table: str, key: str, row: Dict[str, Any], *, include_nulls=True) -> None:
        self.tables.setdefault(table, {})[key] = dict(row)


# ─── empty-set predicate ──────────────────────────────────────────────


def test_set_is_empty_true_for_missing_dir(tmp_path):
    assert _set_is_empty(tmp_path / "no_such_dir") is True


def test_set_is_empty_true_when_only_runtime_yml(tmp_path):
    (tmp_path / "runtime.yml").write_text("start_order: []")
    assert _set_is_empty(tmp_path) is True


def test_set_is_empty_true_when_only_dotfiles(tmp_path):
    (tmp_path / ".migrated").write_text("x")
    assert _set_is_empty(tmp_path) is True


def test_set_is_empty_false_when_proxy_yml_present(tmp_path):
    (tmp_path / "clock-1.yml").write_text("type: clock@1.0.0")
    assert _set_is_empty(tmp_path) is False


# ─── migrator ─────────────────────────────────────────────────────────


def test_migrate_db_to_config_set_writes_yml_per_row(tmp_path, manifests):
    db = StubDB()
    db.insert_item("service_proxy", "clock-1", {
        "id": "clock-1",
        "service_meta_id": "clock@1.0.0",
        "service_config": {"interval_ms": 500},
        "status": "running",
    })
    db.insert_item("service_proxy", "clock-2", {
        "id": "clock-2",
        "service_meta_id": "clock@1.0.0",
        "service_config": {"interval_ms": 1500},
        "status": "stopped",
    })

    written = migrate_db_to_config_set(db, tmp_path, manifests, REPO_DIR)
    assert sorted(written) == ["clock-1", "clock-2"]
    one = yaml.safe_load((tmp_path / "clock-1.yml").read_text())
    assert one["type"] == "clock@1.0.0"
    assert one["interval_ms"] == 500
    two = yaml.safe_load((tmp_path / "clock-2.yml").read_text())
    assert two["interval_ms"] == 1500
    # Marker file written
    assert (tmp_path / MIGRATION_MARKER).is_file()


def test_migrate_idempotent_skips_existing_files(tmp_path, manifests):
    """Hand-authored yml must NEVER be clobbered by the migrator."""
    db = StubDB()
    db.insert_item("service_proxy", "clock-1", {
        "id": "clock-1",
        "service_meta_id": "clock@1.0.0",
        "service_config": {"interval_ms": 999},
    })
    # Pre-existing hand-authored yml with a different value.
    tmp_path.mkdir(exist_ok=True)
    (tmp_path / "clock-1.yml").write_text(yaml.safe_dump({
        "type": "clock@1.0.0",
        "interval_ms": 100,
    }))
    written = migrate_db_to_config_set(db, tmp_path, manifests, REPO_DIR)
    assert written == []  # nothing migrated
    # File content untouched
    out = yaml.safe_load((tmp_path / "clock-1.yml").read_text())
    assert out["interval_ms"] == 100


def test_migrate_skips_unknown_types(tmp_path, manifests):
    """Row pointing at a type not in the registry is logged + skipped,
    not crashed on."""
    db = StubDB()
    db.insert_item("service_proxy", "ghost-1", {
        "id": "ghost-1",
        "service_meta_id": "ghost@99.0.0",
        "service_config": {},
    })
    written = migrate_db_to_config_set(db, tmp_path, manifests, REPO_DIR)
    assert written == []
    assert not (tmp_path / "ghost-1.yml").exists()


# ─── sync (yml → row) ─────────────────────────────────────────────────


def test_sync_creates_row_from_yml(tmp_path, manifests):
    db = StubDB()
    (tmp_path / "clock-1.yml").write_text(yaml.safe_dump({
        "type": "clock@1.0.0", "interval_ms": 750,
    }))
    actions = sync_config_set_to_db(db, tmp_path, manifests)
    assert actions == {"clock-1": "created"}
    row = db.get_item("service_proxy", "clock-1")
    assert row is not None
    assert row["service_meta_id"] == "clock@1.0.0"
    assert row["service_config"] == {"interval_ms": 750}


def test_sync_updates_existing_row(tmp_path, manifests):
    db = StubDB()
    db.insert_item("service_proxy", "clock-1", {
        "id": "clock-1",
        "service_meta_id": "clock@1.0.0",
        "service_config": {"interval_ms": 100},
        "status": "running",
        "pid": 12345,
    })
    # Yml on disk says interval_ms=999 — file wins.
    (tmp_path / "clock-1.yml").write_text(yaml.safe_dump({
        "type": "clock@1.0.0", "interval_ms": 999,
    }))
    actions = sync_config_set_to_db(db, tmp_path, manifests)
    assert actions == {"clock-1": "updated"}
    row = db.get_item("service_proxy", "clock-1")
    assert row["service_config"] == {"interval_ms": 999}
    # Ephemera preserved.
    assert row["status"] == "running"
    assert row["pid"] == 12345


def test_sync_bumps_installed_to_running_when_in_start_order(tmp_path, manifests):
    db = StubDB()
    db.insert_item("service_proxy", "clock-1", {
        "id": "clock-1",
        "service_meta_id": "clock@1.0.0",
        "service_config": {"interval_ms": 100},
        "status": "stopped",
    })
    (tmp_path / "runtime.yml").write_text(yaml.safe_dump({
        "start_order": ["clock-1"],
    }))
    (tmp_path / "clock-1.yml").write_text(yaml.safe_dump({
        "type": "clock@1.0.0", "interval_ms": 100,
    }))
    sync_config_set_to_db(db, tmp_path, manifests)
    # Now in start_order, so status flipped to 'running' for reconcile
    # to pick up and spawn.
    assert db.get_item("service_proxy", "clock-1")["status"] == "running"


def test_sync_preserves_running_status_outside_start_order(tmp_path, manifests):
    """If the row is already running but NOT in start_order, leave it."""
    db = StubDB()
    db.insert_item("service_proxy", "clock-1", {
        "id": "clock-1",
        "service_meta_id": "clock@1.0.0",
        "service_config": {"interval_ms": 100},
        "status": "running",
    })
    (tmp_path / "clock-1.yml").write_text(yaml.safe_dump({
        "type": "clock@1.0.0", "interval_ms": 200,
    }))
    sync_config_set_to_db(db, tmp_path, manifests)
    assert db.get_item("service_proxy", "clock-1")["status"] == "running"


def test_sync_skips_malformed_yml(tmp_path, manifests):
    db = StubDB()
    (tmp_path / "broken.yml").write_text("not: : valid")
    actions = sync_config_set_to_db(db, tmp_path, manifests)
    assert actions["broken"].startswith("skipped:")
    assert db.get_item("service_proxy", "broken") is None


def test_sync_skips_unknown_type(tmp_path, manifests):
    db = StubDB()
    (tmp_path / "x.yml").write_text(yaml.safe_dump({
        "type": "nonsense@99.0.0",
    }))
    actions = sync_config_set_to_db(db, tmp_path, manifests)
    assert actions["x"].startswith("skipped:unknown_type:")


def test_sync_resolves_bare_type_name(tmp_path, manifests):
    """type: clock (no @version) resolves to the unique installed
    version, mirroring the load path."""
    db = StubDB()
    (tmp_path / "clock-1.yml").write_text(yaml.safe_dump({
        "type": "clock",
        "interval_ms": 250,
    }))
    sync_config_set_to_db(db, tmp_path, manifests)
    row = db.get_item("service_proxy", "clock-1")
    assert row["service_meta_id"] == "clock@1.0.0"


def test_sync_ignores_runtime_yml_and_dotfiles(tmp_path, manifests):
    db = StubDB()
    (tmp_path / "runtime.yml").write_text(yaml.safe_dump({"start_order": []}))
    (tmp_path / ".migrated").write_text("x")
    actions = sync_config_set_to_db(db, tmp_path, manifests)
    assert actions == {}


# ─── e2e: migrate then sync round-trips ───────────────────────────────


def test_migrate_then_sync_roundtrips_config(tmp_path, manifests):
    db = StubDB()
    db.insert_item("service_proxy", "clock-1", {
        "id": "clock-1",
        "service_meta_id": "clock@1.0.0",
        "service_config": {"interval_ms": 1234},
        "status": "running",
    })
    migrate_db_to_config_set(db, tmp_path, manifests, REPO_DIR)
    # Wipe the row to simulate a clean DB on subsequent boot.
    db.tables["service_proxy"].clear()
    actions = sync_config_set_to_db(db, tmp_path, manifests)
    assert actions == {"clock-1": "created"}
    row = db.get_item("service_proxy", "clock-1")
    # Pydantic model_dump includes topic_remap (inherited from ServiceConfig).
    # The round-trip preserves the original value; we just allow the
    # extra field.
    assert row["service_config"]["interval_ms"] == 1234


# ─── security bootstrap ───────────────────────────────────────────────


def test_bootstrap_security_core_returns_core(tmp_path):
    """A SecurityCore can be instantiated inline during boot — no need
    for the SecurityService to be running yet."""
    core = bootstrap_security_core(tmp_path, repo_dir=REPO_DIR)
    assert core is not None
    ct = core.encrypt("test-secret")
    assert ct.startswith("Encrypted--")
    assert core.decrypt(ct) == "test-secret"
    # Key file landed under tmp_path/security/key.bin
    assert (tmp_path / "security" / "key.bin").is_file()


def test_migrator_encrypts_secrets_when_core_available(tmp_path, manifests):
    """Stone-4 + stone-1 interlock: when a service's config has
    SecretStr fields, the migrator runs them through the encrypt walk
    before they hit disk."""
    # This needs a service type that has a SecretStr field; brain has
    # api_key but it's plain str currently. Use the test EchoService
    # from test_service_config — but it's defined inline there.
    # Instead, just verify the migrator's encrypt_fn parameter wires
    # through to the save path by writing a row whose service_config
    # already carries an Encrypt-- marker.
    db = StubDB()
    db.insert_item("service_proxy", "clock-1", {
        "id": "clock-1",
        "service_meta_id": "clock@1.0.0",
        "service_config": {
            "interval_ms": 500,
            # extra=allow on ServiceConfig means this extra field rides
            # through. The migrator should encrypt it on the way out.
            "tagged_secret": "Encrypt--my-fake-token",
        },
    })
    core = bootstrap_security_core(tmp_path, repo_dir=REPO_DIR)
    written = migrate_db_to_config_set(
        db, tmp_path / "set", manifests, REPO_DIR,
        encrypt_fn=core.encrypt,
    )
    assert written == ["clock-1"]
    out = yaml.safe_load((tmp_path / "set" / "clock-1.yml").read_text())
    # Encrypt-- marker got encrypted, plaintext never reached disk.
    assert out["tagged_secret"].startswith("Encrypted--")
    assert "my-fake-token" not in yaml.safe_dump(out)
    # Round-trip: decrypt the stored value
    assert core.decrypt(out["tagged_secret"]) == "my-fake-token"
