# unmanaged
"""Integration tests for the remote service registry — Phase 2/3/4 of
docs/TODO_REPO.md.

The headline test (``test_load_then_install``) drives the full
ABSENT → LOADED → INSTALLED flow against a fresh local mirror that
the test builds inline:

  1. Stage a synthetic source repo with one minimal in-process service.
  2. Build a deterministic tar.gz + sha256 + catalog.yml that match
     what tools/build_services.py + publish_services.py produce.
  3. Point ``registry.load()`` at the local catalog, assert files
     land under repo_dir + the service_meta row appears with
     installed=False.
  4. Call ``registry.install()``, assert the row flips to
     installed=True (builtin → no real venv needed, exercises the
     state machine).
  5. Verify the integrity check by tampering with sha256.

Uses an in-memory FakeDB stub mirroring tests/test_lifecycle.py so we
don't depend on TinyDB or a live FastAPI app — same pattern as the
other unit tests in this directory.
"""
from __future__ import annotations

import hashlib
import io
import tarfile
from pathlib import Path
from typing import Any, Dict, Optional

import pytest
import yaml

from robotlab_x.runtime import registry


# ─── FakeDB — minimal DatabaseAdapter substitute ─────────────────────

class FakeDB:
    def __init__(self) -> None:
        self.tables: Dict[str, Dict[str, Dict[str, Any]]] = {}

    def _table(self, name: str) -> Dict[str, Dict[str, Any]]:
        return self.tables.setdefault(name, {})

    def insert_item(self, table: str, key: str, item: Dict[str, Any]) -> None:
        self._table(table)[key] = dict(item)

    def update_item(
        self, table: str, key: str, item: Dict[str, Any], include_nulls: bool = False
    ) -> None:
        self._table(table)[key] = dict(item)

    def get_item(self, table: str, key: str) -> Optional[Dict[str, Any]]:
        return self._table(table).get(key)

    def delete_item(self, table: str, key: str) -> None:
        self._table(table).pop(key, None)

    def get_all_items(self, table: str) -> list:
        return list(self._table(table).values())


# ─── helpers — build a local mirror identical to what the real tools
#     emit, but inline so the test is self-contained ────────────────

# A minimal in-process service. Real master_template is ~6 KB; this
# strip-down is intentionally tiny so test archive verification is
# obvious from the bytes.
_FAKE_SERVICE_NAME = "test_widget"
_FAKE_SERVICE_VERSION = "1.0.0"

_FAKE_PACKAGE_YML = """\
name: test_widget
description: |
  Synthetic in-process service used by tests/test_registry.py. Real
  services would have more, but everything below is enough for the
  framework to register the type at LOADED time.
language: builtin
status: development
author: test
tags: [test]

bundled: false

install:
  kind: builtin

entry:
  in_process:
    module: test_widget
    class: TestWidgetService
"""

_FAKE_SERVICE_PY = """\
# Synthetic — not actually run by the test. Present so the framework's
# scanner sees a well-formed dir.
from robotlab_x.framework import Service


class TestWidgetService(Service):
    type_name = "test_widget"
"""


def _stage_source(tmp_path: Path) -> Path:
    """Create a synthetic apps/robotlab_x/repo/<svc>/<ver>/ tree that
    looks like what a dev's working copy would contain."""
    src_repo = tmp_path / "src_repo"
    svc_dir = src_repo / _FAKE_SERVICE_NAME / _FAKE_SERVICE_VERSION
    svc_dir.mkdir(parents=True)
    (svc_dir / "package.yml").write_text(_FAKE_PACKAGE_YML)
    (svc_dir / "test_widget.py").write_text(_FAKE_SERVICE_PY)
    return src_repo


def _build_archive(src_repo: Path, name: str, version: str) -> bytes:
    """Tar up ``<name>/<version>/`` inside src_repo, deterministically.
    Mirrors tools/build_services.py's flags so the bytes match (mostly —
    we don't go to disk first)."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        # Walk the dir tree sorted so the archive is deterministic.
        type_dir = src_repo / name / version
        members = sorted(type_dir.rglob("*"))
        # Add the version dir itself first so an extract creates it.
        for p in [type_dir, *members]:
            arcname = str(p.relative_to(src_repo))
            ti = tf.gettarinfo(str(p), arcname=arcname)
            ti.mtime = 0
            ti.uid = 0
            ti.gid = 0
            ti.uname = ""
            ti.gname = ""
            if p.is_file():
                with open(p, "rb") as fp:
                    tf.addfile(ti, fp)
            else:
                tf.addfile(ti)
    return buf.getvalue()


def _publish_mirror(tmp_path: Path, src_repo: Path) -> Path:
    """Build the archive + catalog.yml for the synthetic service. Returns
    the catalog.yml path (use ``file://`` + this as ``catalog_url``)."""
    mirror = tmp_path / "mirror"
    svc_out = mirror / _FAKE_SERVICE_NAME
    svc_out.mkdir(parents=True)

    archive_bytes = _build_archive(src_repo, _FAKE_SERVICE_NAME, _FAKE_SERVICE_VERSION)
    sha = hashlib.sha256(archive_bytes).hexdigest()
    archive_name = f"{_FAKE_SERVICE_NAME}-{_FAKE_SERVICE_VERSION}.tar.gz"
    (svc_out / archive_name).write_bytes(archive_bytes)

    catalog = {
        "registry_version": 1,
        "target": "local",
        "services": [
            {
                "name": _FAKE_SERVICE_NAME,
                "description": "Synthetic in-process service for the registry test.",
                "tags": ["test"],
                "implements": [],
                "requires": [],
                "versions": [
                    {
                        "version": _FAKE_SERVICE_VERSION,
                        "archive": f"{_FAKE_SERVICE_NAME}/{archive_name}",
                        "sha256": sha,
                        "size_bytes": len(archive_bytes),
                        "language": "builtin",
                        "status": "development",
                        "install": {"kind": "builtin"},
                        "min_runtime": "0.1.0",
                        "bundled": False,
                    }
                ],
            }
        ],
    }
    catalog_path = mirror / "catalog.yml"
    catalog_path.write_text(yaml.safe_dump(catalog, sort_keys=False))
    return catalog_path


def _catalog_url(catalog_path: Path) -> str:
    return f"file://{catalog_path}"


# ─── tests ──────────────────────────────────────────────────────────


def test_fetch_catalog_parses_local_mirror(tmp_path):
    """Smoke: fetch_catalog can read a file:// URL and parse it."""
    src_repo = _stage_source(tmp_path)
    catalog_path = _publish_mirror(tmp_path, src_repo)

    cat = registry.fetch_catalog(_catalog_url(catalog_path))
    assert cat["registry_version"] == 1
    assert cat["services"][0]["name"] == _FAKE_SERVICE_NAME
    assert cat["services"][0]["versions"][0]["version"] == _FAKE_SERVICE_VERSION


def test_find_in_catalog_returns_merged_view(tmp_path):
    """find_in_catalog merges service-level + version-level fields."""
    src_repo = _stage_source(tmp_path)
    catalog_path = _publish_mirror(tmp_path, src_repo)
    cat = registry.fetch_catalog(_catalog_url(catalog_path))

    entry = registry.find_in_catalog(cat, _FAKE_SERVICE_NAME, _FAKE_SERVICE_VERSION)
    # Version-level fields
    assert entry["sha256"]
    assert entry["archive"].endswith(".tar.gz")
    # Service-level fields surfaced via merge
    assert entry["name"] == _FAKE_SERVICE_NAME
    assert "test" in (entry["tags"] or [])


def test_find_in_catalog_missing_raises(tmp_path):
    src_repo = _stage_source(tmp_path)
    catalog_path = _publish_mirror(tmp_path, src_repo)
    cat = registry.fetch_catalog(_catalog_url(catalog_path))

    with pytest.raises(registry.NotInCatalogError):
        registry.find_in_catalog(cat, "nonexistent", "1.0.0")


def test_load_then_install(tmp_path):
    """The headline test: an uninstalled (ABSENT) service can be
    loaded then installed, ending with installed=True in service_meta.
    """
    src_repo = _stage_source(tmp_path)
    catalog_path = _publish_mirror(tmp_path, src_repo)
    catalog_url = _catalog_url(catalog_path)

    # Fresh target repo dir — service is ABSENT.
    repo_dir = tmp_path / "target_repo"
    repo_dir.mkdir()
    db = FakeDB()

    # State at start: nothing in service_meta, no files under repo_dir.
    assert not (repo_dir / _FAKE_SERVICE_NAME).exists()
    assert db.get_item("service_meta", f"{_FAKE_SERVICE_NAME}@{_FAKE_SERVICE_VERSION}") is None

    # ABSENT → LOADED ------------------------------------------------
    row = registry.load(
        _FAKE_SERVICE_NAME,
        _FAKE_SERVICE_VERSION,
        catalog_url=catalog_url,
        repo_dir=repo_dir,
        db=db,
    )

    extracted = repo_dir / _FAKE_SERVICE_NAME / _FAKE_SERVICE_VERSION
    assert extracted.is_dir(), "extract should have created the type dir"
    assert (extracted / "package.yml").is_file(), "package.yml should be present after load"
    assert (extracted / "test_widget.py").is_file(), "source file should be present after load"

    meta_id = f"{_FAKE_SERVICE_NAME}@{_FAKE_SERVICE_VERSION}"
    db_row = db.get_item("service_meta", meta_id)
    assert db_row is not None, "reconcile_catalog should have inserted a service_meta row"
    assert db_row["name"] == _FAKE_SERVICE_NAME
    assert db_row["version"] == _FAKE_SERVICE_VERSION
    # LOADED but NOT yet INSTALLED — installed flag is whatever the
    # filesystem state implies (builtins start installed-ish per
    # manifest_to_service_meta, but pip services would start False).
    # We only assert the row exists here; the install transition is
    # the next step.
    assert row["name"] == _FAKE_SERVICE_NAME

    # LOADED → INSTALLED --------------------------------------------
    installed_row = registry.install(
        _FAKE_SERVICE_NAME,
        _FAKE_SERVICE_VERSION,
        repo_dir=repo_dir,
        db=db,
    )

    final = db.get_item("service_meta", meta_id)
    assert final is not None
    assert final["installed"] is True, f"install should set installed=True, got {final!r}"
    assert final.get("installation_exception") is None
    assert installed_row["installed"] is True


def test_install_pip_type_uses_on_event(tmp_path, monkeypatch):
    """Regression: registry.install must call installer.install_pip with the
    ``on_event`` kwarg (not ``on_progress``), and forward its structured
    events to the on_progress(step, line) callback. The builtin-only tests
    never exercised the pip path, so a wrong kwarg shipped and blew up as
    'install_pip() got an unexpected keyword argument on_progress' on the
    first real pip install (arduino on s1)."""
    from robotlab_x.runtime import installer
    from pathlib import Path as _P

    # A loaded pip type with source on disk so no copy/extract is needed.
    repo_dir = tmp_path / "repo"
    td = repo_dir / "widget_pip" / "1.0.0"
    td.mkdir(parents=True)
    (td / "package.yml").write_text("name: widget_pip\n")
    db = FakeDB()
    db.insert_item("service_meta", "widget_pip@1.0.0", {
        "id": "widget_pip@1.0.0", "name": "widget_pip", "version": "1.0.0",
        "dependency_manager": "pip",
        "package_spec": "-e ${APP_ROOT}/repo/widget_pip/1.0.0",
        "install_phase": "loaded",
    })

    captured = {}
    def fake_install_pip(package_spec, slot, repo_dir, *, on_event=None, **kw):
        captured["slot"] = slot
        captured["has_on_event"] = on_event is not None
        if on_event:
            on_event({"step_id": "install_deps", "status": "running", "detail": "pip…"})
        (_P(repo_dir) / slot / ".venv" / "bin").mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(installer, "install_pip", fake_install_pip)

    progress = []
    row = registry.install(
        "widget_pip", "1.0.0", repo_dir=repo_dir, db=db,
        on_progress=lambda step, line: progress.append((step, line)),
    )

    assert captured["slot"] == "widget_pip/1.0.0"
    assert captured["has_on_event"] is True
    assert row["install_phase"] == "installed"
    assert row["installed"] is True
    # The structured event was forwarded to on_progress(step, line).
    assert progress and progress[0][0] == "install_deps"


def test_install_pip_type_forwards_structured_on_event(tmp_path, monkeypatch):
    """registry.install must pass the FULL structured installer milestone
    dict through to a caller-supplied ``on_event`` (the registry REST
    endpoint relies on this to stream the same {step_id, label, index,
    total, status, detail, stream, error_code} schema the canvas/
    service_request flow emits, so one UI component renders both)."""
    from robotlab_x.runtime import installer
    from pathlib import Path as _P

    repo_dir = tmp_path / "repo"
    td = repo_dir / "widget_pip" / "1.0.0"
    td.mkdir(parents=True)
    (td / "package.yml").write_text("name: widget_pip\n")
    db = FakeDB()
    db.insert_item("service_meta", "widget_pip@1.0.0", {
        "id": "widget_pip@1.0.0", "name": "widget_pip", "version": "1.0.0",
        "dependency_manager": "pip",
        "package_spec": "-e ${APP_ROOT}/repo/widget_pip/1.0.0",
        "install_phase": "loaded",
    })

    EV = {"step_id": "install_deps", "label": "Install dependencies",
          "index": 3, "total": 3, "status": "completed"}

    def fake_install_pip(package_spec, slot, repo_dir, *, on_event=None, **kw):
        if on_event:
            on_event(dict(EV))
        (_P(repo_dir) / slot / ".venv" / "bin").mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(installer, "install_pip", fake_install_pip)

    events = []
    registry.install(
        "widget_pip", "1.0.0", repo_dir=repo_dir, db=db,
        on_event=events.append,
    )
    # The exact structured dict reached on_event — no flattening.
    assert events == [EV]


def test_load_sha256_mismatch_rejected(tmp_path):
    """A tampered catalog (sha256 doesn't match actual archive) must
    NOT extract anything to disk and must NOT touch service_meta."""
    src_repo = _stage_source(tmp_path)
    catalog_path = _publish_mirror(tmp_path, src_repo)

    # Tamper: rewrite catalog with a clearly-wrong sha.
    cat = yaml.safe_load(catalog_path.read_text())
    cat["services"][0]["versions"][0]["sha256"] = "0" * 64
    catalog_path.write_text(yaml.safe_dump(cat))

    repo_dir = tmp_path / "target_repo"
    repo_dir.mkdir()
    db = FakeDB()

    with pytest.raises(registry.IntegrityError) as exc_info:
        registry.load(
            _FAKE_SERVICE_NAME,
            _FAKE_SERVICE_VERSION,
            catalog_url=_catalog_url(catalog_path),
            repo_dir=repo_dir,
            db=db,
        )
    assert "sha256 mismatch" in str(exc_info.value)
    # Critical: no files extracted, no DB row created.
    assert not (repo_dir / _FAKE_SERVICE_NAME).exists()
    assert db.get_all_items("service_meta") == []


def test_install_without_load_fails_clearly(tmp_path):
    """Calling install on a service that was never loaded should
    raise InstallError with a message pointing the operator at load."""
    repo_dir = tmp_path / "target_repo"
    repo_dir.mkdir()
    db = FakeDB()

    with pytest.raises(registry.InstallError) as exc_info:
        registry.install("absent_service", "1.0.0", repo_dir=repo_dir, db=db)
    msg = str(exc_info.value)
    assert "absent_service" in msg
    assert "load" in msg.lower(), "error should hint at registry.load"


def test_uninstall_returns_to_loaded(tmp_path):
    """INSTALLED → LOADED flips the flag but keeps the source files."""
    src_repo = _stage_source(tmp_path)
    catalog_path = _publish_mirror(tmp_path, src_repo)

    repo_dir = tmp_path / "target_repo"
    repo_dir.mkdir()
    db = FakeDB()

    # Get to INSTALLED first.
    registry.load(
        _FAKE_SERVICE_NAME, _FAKE_SERVICE_VERSION,
        catalog_url=_catalog_url(catalog_path),
        repo_dir=repo_dir, db=db,
    )
    registry.install(
        _FAKE_SERVICE_NAME, _FAKE_SERVICE_VERSION,
        repo_dir=repo_dir, db=db,
    )
    meta_id = f"{_FAKE_SERVICE_NAME}@{_FAKE_SERVICE_VERSION}"
    assert db.get_item("service_meta", meta_id)["installed"] is True

    # Now uninstall.
    registry.uninstall(
        _FAKE_SERVICE_NAME, _FAKE_SERVICE_VERSION,
        repo_dir=repo_dir, db=db,
    )

    final = db.get_item("service_meta", meta_id)
    assert final["installed"] is False
    # Source files must STILL be there — uninstall != remove.
    extracted = repo_dir / _FAKE_SERVICE_NAME / _FAKE_SERVICE_VERSION
    assert (extracted / "package.yml").is_file(), \
        "uninstall must leave the source dir in place (LOADED state)"
