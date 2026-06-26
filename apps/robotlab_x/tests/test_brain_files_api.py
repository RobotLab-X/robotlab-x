# unmanaged
"""Regression for the brain workspace file API root resolution.

Mirrors the s1 deploy split: bundled workflows ship in the brain TYPE
bundle, which on a deploy lives in a READ-ONLY repo_paths root (the
image's baked-in repo/) while repo_dir is a SEPARATE writable volume
(var/repo). ``_resolve_brain_roots`` must find the bundled workflows
across every effective root — resolving against repo_dir alone returned
None there, so the UI showed no bundled workflows ("doesn't see the
prebundled workflows") even though the brain type loaded fine.

Dependency-free FakeDB, same shape as tests/test_multi_repo.py.
"""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, Optional

from robotlab_x.api import brain_files_api


class FakeDB:
    def __init__(self) -> None:
        self.tables: Dict[str, Dict[str, Dict[str, Any]]] = {}

    def _t(self, name: str) -> Dict[str, Dict[str, Any]]:
        return self.tables.setdefault(name, {})

    def insert_item(self, table: str, key: str, item: Dict[str, Any]) -> None:
        self._t(table)[key] = dict(item)

    def get_item(self, table: str, key: str) -> Optional[Dict[str, Any]]:
        return self._t(table).get(key)


def _settings(repo_dir: Path, repo_paths, data_dir: Path):
    return SimpleNamespace(
        repo_dir=str(repo_dir),
        repo_paths=[str(p) for p in repo_paths],
        registries=[],
        registry_url=None,
        data_dir=str(data_dir),
    )


def _make_brain_bundle(root: Path, version: str = "1.0.0") -> Path:
    wf = root / "brain" / version / "workflows" / "observe_room"
    wf.mkdir(parents=True)
    (wf / "workflow.yaml").write_text("name: observe_room\n")
    return root / "brain" / version / "workflows"


def test_resolve_brain_roots_finds_bundled_in_readonly_root(tmp_path, monkeypatch):
    writable = tmp_path / "var" / "repo"   # empty writable volume (repo_dir)
    writable.mkdir(parents=True)
    ro = tmp_path / "bundled"              # read-only image root (repo_paths)
    bundled = _make_brain_bundle(ro)
    data_dir = tmp_path / "data"; data_dir.mkdir()

    db = FakeDB()
    db.insert_item("service_proxy", "brain-1", {
        "id": "brain-1", "service_meta_id": "brain@1.0.0", "service_config": {},
    })
    monkeypatch.setattr(brain_files_api, "get_database_client", lambda: db)
    monkeypatch.setattr(brain_files_api, "get_settings",
                        lambda: _settings(writable, [ro], data_dir))

    workspace_dir, bundled_dir = brain_files_api._resolve_brain_roots("brain-1")
    assert workspace_dir == (data_dir / "brain" / "brain-1").resolve()
    # Bundled workflows resolved from the read-only root, not repo_dir.
    assert bundled_dir == bundled.resolve()


def test_resolve_brain_roots_none_when_no_bundle_anywhere(tmp_path, monkeypatch):
    writable = tmp_path / "var" / "repo"; writable.mkdir(parents=True)
    data_dir = tmp_path / "data"; data_dir.mkdir()
    db = FakeDB()
    db.insert_item("service_proxy", "brain-1", {
        "id": "brain-1", "service_meta_id": "brain@1.0.0", "service_config": {},
    })
    monkeypatch.setattr(brain_files_api, "get_database_client", lambda: db)
    monkeypatch.setattr(brain_files_api, "get_settings",
                        lambda: _settings(writable, [], data_dir))

    _workspace, bundled_dir = brain_files_api._resolve_brain_roots("brain-1")
    assert bundled_dir is None  # workspace-only — still functional


# ─── mutation → list_workflows lifecycle (regression) ─────────────────
#
# Locks the contract the brain UI's Run pane depends on: after an
# operator mutates the workspace (duplicate / rename / delete / new),
#   1. the resulting workspace is EXACTLY what list_workflows reports —
#      the workflow loads under its DIRECTORY name (normalized), the old
#      name is gone after a rename;
#   2. the backend publishes a files/changed event with the right kind,
#      which is what the UI subscribes to in order to auto-refresh the
#      workflow list (the bug: a rename/duplicate appeared in the tree
#      but not the runnable list → "Brain hasn't reported this workflow
#      yet").
import sys as _sys

_BRAIN_PKG = Path(__file__).resolve().parents[1] / "repo" / "brain" / "1.0.0"
if str(_BRAIN_PKG) not in _sys.path:
    _sys.path.insert(0, str(_BRAIN_PKG))
from brain.context_loader import list_workflow_dirs, load_workflow  # noqa: E402


def _setup_brain(tmp_path, monkeypatch, workflows=("my_flow",)):
    """A brain-1 proxy whose workspace holds the given workflow dirs.
    Returns (workspace_dir, captured_events) where captured_events is a
    growing list of (path, kind) from _publish_file_change."""
    data_dir = tmp_path / "data"
    ws = data_dir / "brain" / "brain-1"
    (ws / "workflows").mkdir(parents=True)
    for name in workflows:
        d = ws / "workflows" / name
        d.mkdir()
        (d / "workflow.yaml").write_text("description: test flow\nmax_steps: 5\n")
        (d / "prompt.md").write_text("do the thing\n")
    repo_dir = tmp_path / "var" / "repo"
    repo_dir.mkdir(parents=True)

    db = FakeDB()
    db.insert_item("service_proxy", "brain-1", {
        "id": "brain-1", "service_meta_id": "brain@1.0.0", "service_config": {},
    })
    monkeypatch.setattr(brain_files_api, "get_database_client", lambda: db)
    monkeypatch.setattr(brain_files_api, "get_settings",
                        lambda: _settings(repo_dir, [], data_dir))
    events: list = []
    monkeypatch.setattr(brain_files_api, "_publish_file_change",
                        lambda proxy_id, path, kind: events.append((path, kind)))
    return ws, events


def test_duplicate_workflow_is_reported_and_runnable(tmp_path, monkeypatch):
    ws, events = _setup_brain(tmp_path, monkeypatch)
    resp = brain_files_api.duplicate_brain_workflow(
        "brain-1",
        brain_files_api.DuplicateRequest(source_path="workflows/my_flow", dest_name="my_flow_copy"),
        _=None,
    )
    assert resp.dest_path == "workflows/my_flow_copy"
    assert (ws / "workflows" / "my_flow_copy" / "workflow.yaml").is_file()
    # What list_workflows sees: the copy, named by its DIRECTORY.
    dirs = list_workflow_dirs(ws)
    assert "my_flow_copy" in dirs
    assert load_workflow("my_flow_copy", ws).name == "my_flow_copy"
    # The event the UI auto-refreshes on.
    assert ("workflows/my_flow_copy", "created") in events


def test_rename_workflow_reported_under_new_name_old_gone(tmp_path, monkeypatch):
    ws, events = _setup_brain(tmp_path, monkeypatch)
    resp = brain_files_api.rename_file(
        "brain-1",
        brain_files_api.RenameRequest(from_path="workflows/my_flow", to_path="workflows/brain_test"),
        _=None,
    )
    assert resp.to_path == "workflows/brain_test"
    dirs = list_workflow_dirs(ws)
    assert "brain_test" in dirs, "renamed workflow must be reported under its new dir name"
    assert "my_flow" not in dirs, "old name must be gone after rename"
    assert load_workflow("brain_test", ws).name == "brain_test"
    # Rename = delete(old) + create(new); the UI refreshes on both.
    assert ("workflows/my_flow", "deleted") in events
    assert ("workflows/brain_test", "created") in events


def test_new_workflow_is_reported_and_loadable(tmp_path, monkeypatch):
    ws, events = _setup_brain(tmp_path, monkeypatch, workflows=())
    resp = brain_files_api.new_workflow(
        "brain-1",
        brain_files_api.NewWorkflowRequest(name="fresh_flow"),
        _=None,
    )
    assert resp.dest_path == "workflows/fresh_flow"
    dirs = list_workflow_dirs(ws)
    assert "fresh_flow" in dirs
    assert load_workflow("fresh_flow", ws).name == "fresh_flow"
    assert ("workflows/fresh_flow", "created") in events


def test_delete_workflow_removed_from_listing(tmp_path, monkeypatch):
    ws, events = _setup_brain(tmp_path, monkeypatch)
    brain_files_api.delete_file("brain-1", path="workflows/my_flow", recursive=True, _=None)
    dirs = list_workflow_dirs(ws)
    assert "my_flow" not in dirs
    assert ("workflows/my_flow", "deleted") in events
