"""reconcile_catalog robustness — an empty or failed repo scan must NOT
wipe the live catalog.

This guards the "uninstall → catalog suddenly empty / sources 500 / must
restart the backend" failure: a transient or misconfigured scan (wrong
cwd, a root mid-rewrite) returning zero manifests used to prune every
service_meta row. The guard keeps the catalog intact in that case.
"""
from __future__ import annotations

from pathlib import Path

from robotlab_x.runtime import catalog
from robotlab_x.runtime.catalog import reconcile_catalog


class FakeDB:
    def __init__(self) -> None:
        self.t: dict = {}

    def insert_item(self, table, key, item):
        self.t.setdefault(table, {})[key] = dict(item)

    def update_item(self, table, key, item, include_nulls=False):
        self.t.setdefault(table, {})[key] = dict(item)

    def get_item(self, table, key):
        return self.t.get(table, {}).get(key)

    def delete_item(self, table, key):
        self.t.get(table, {}).pop(key, None)

    def get_all_items(self, table):
        return list(self.t.get(table, {}).values())


def _seed(db: FakeDB, *ids: str) -> None:
    for i in ids:
        db.insert_item("service_meta", i, {"id": i, "name": i.split("@")[0]})


def test_empty_scan_does_not_wipe_catalog(tmp_path, monkeypatch):
    """0 manifests + existing rows → skip, keep every row."""
    db = FakeDB()
    _seed(db, "servo@1.0.0", "arduino@1.0.0", "echo_http@1.0.0")
    monkeypatch.setattr(catalog, "scan_repos", lambda roots: [])

    summary = reconcile_catalog(db, [tmp_path])

    assert summary.get("skipped") == "empty_scan_guard"
    assert summary["removed"] == 0
    assert {r["id"] for r in db.get_all_items("service_meta")} == {
        "servo@1.0.0", "arduino@1.0.0", "echo_http@1.0.0",
    }


def test_scan_exception_keeps_catalog(tmp_path, monkeypatch):
    """A scan that raises → reconcile keeps the catalog intact, no throw."""
    db = FakeDB()
    _seed(db, "servo@1.0.0")

    def boom(roots):
        raise RuntimeError("transient scan failure")

    monkeypatch.setattr(catalog, "scan_repos", boom)

    summary = reconcile_catalog(db, [tmp_path])

    assert summary.get("error") == "scan_failed"
    assert {r["id"] for r in db.get_all_items("service_meta")} == {"servo@1.0.0"}


def test_empty_scan_on_empty_catalog_is_noop(tmp_path, monkeypatch):
    """0 manifests + 0 existing rows → genuinely empty, no error/skip."""
    db = FakeDB()
    monkeypatch.setattr(catalog, "scan_repos", lambda roots: [])

    summary = reconcile_catalog(db, [tmp_path])

    assert summary["found"] == 0
    assert summary["removed"] == 0
    assert db.get_all_items("service_meta") == []
