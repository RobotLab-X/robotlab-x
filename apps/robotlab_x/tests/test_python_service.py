# unmanaged
"""PythonService tests.

Coverage:
  * list_scripts / get_script / save_script / delete_script — DB
    interaction via a FakeDB that mirrors the real database adapter API
  * run_script + run_inline call script_runner with the right
    output_topic and return a run_id
  * run_script raises KeyError for missing scripts
  * Recent-runs tracking after a fake meta-end event

script_runner is mocked — we don't actually fork a subprocess. The
existing script_runner tests cover that path.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock, patch

import pytest

# Make python_svc importable. Service module name is python_svc to
# avoid colliding with the stdlib "python" import path.
_PYTHON_DIR = Path(__file__).resolve().parents[1] / "repo" / "python" / "1.0.0"
if str(_PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(_PYTHON_DIR))


class FakeDB:
    """Minimal in-memory DatabaseAdapter substitute."""
    def __init__(self) -> None:
        self.tables: Dict[str, Dict[str, Dict[str, Any]]] = {}

    def _table(self, name: str) -> Dict[str, Dict[str, Any]]:
        return self.tables.setdefault(name, {})

    def insert_item(self, table: str, key: str, item: Dict[str, Any]) -> None:
        self._table(table)[key] = dict(item)

    def update_item(self, table: str, key: str, item: Dict[str, Any], include_nulls: bool = False) -> None:
        self._table(table)[key] = dict(item)

    def get_item(self, table: str, key: str) -> Optional[Dict[str, Any]]:
        return self._table(table).get(key)

    def get_all_items(self, table: str) -> List[Dict[str, Any]]:
        return list(self._table(table).values())

    def delete_item(self, table: str, key: str) -> None:
        self._table(table).pop(key, None)


@pytest.fixture
def fresh_bus(monkeypatch):
    from robotlab_x.runtime.bus import Bus
    from robotlab_x.runtime import bus as bus_mod
    bus = Bus()
    monkeypatch.setattr(bus_mod, "_default_bus", bus)
    return bus


@pytest.fixture
def svc(fresh_bus, monkeypatch):
    """PythonService instance with a FakeDB and the runner mocked.

    We patch ``database.factory.get_database_client`` to return our
    FakeDB so DB queries don't touch a real TinyDB file.
    """
    from python_svc import PythonService
    from robotlab_x.framework.service import ServiceMetadata

    db = FakeDB()
    # PythonService._db() does a fresh import each call — patch the
    # underlying factory so both the import path inside the service
    # and any framework save_config calls see the same DB.
    import database.factory as factory_mod  # noqa: E402  (lazy)
    monkeypatch.setattr(factory_mod, "get_database_client", lambda: db)

    meta = ServiceMetadata(
        proxy_id="python-1",
        service_meta_id="python@1.0.0",
        type_name="python",
        type_version="1.0.0",
        tags=[],
        singleton=False,
    )
    s = PythonService(meta=meta, config={})
    s._fake_db = db   # exposed for tests to seed rows
    return s


# ─────────────────────────────────────────────────────────────────────
# Script catalog CRUD
# ─────────────────────────────────────────────────────────────────────


def test_list_scripts_returns_empty_when_no_rows(svc):
    out = svc.list_scripts()
    assert out == {"scripts": []}


def test_list_scripts_includes_bodies(svc):
    """Default catalog view includes bodies so the UI can populate the
    editor without a separate roundtrip per script."""
    svc._fake_db.insert_item("script", "s1", {
        "id": "s1", "name": "hello", "body": "print('hi')", "language": "python",
    })
    out = svc.list_scripts()
    assert out["scripts"][0]["body"] == "print('hi')"


def test_get_script_by_id(svc):
    svc._fake_db.insert_item("script", "s1", {
        "id": "s1", "name": "hello", "body": "print('hi')",
    })
    out = svc.get_script(id="s1")
    assert out["script"]["body"] == "print('hi')"


def test_get_script_by_name(svc):
    svc._fake_db.insert_item("script", "abc", {
        "id": "abc", "name": "hello", "body": "print('hi')",
    })
    out = svc.get_script(id="hello")
    assert out["script"]["id"] == "abc"


def test_get_script_missing_raises(svc):
    with pytest.raises(KeyError):
        svc.get_script(id="nope")


@pytest.mark.asyncio
async def test_save_script_creates_new(svc):
    result = svc.save_script(name="adder", body="print(1+1)")
    new_id = result["script"]["id"]
    assert svc._fake_db.get_item("script", new_id)["name"] == "adder"
    assert svc._fake_db.get_item("script", new_id)["body"] == "print(1+1)"


@pytest.mark.asyncio
async def test_save_script_updates_existing(svc):
    svc._fake_db.insert_item("script", "s1", {
        "id": "s1", "name": "old", "body": "print('a')", "language": "python",
    })
    result = svc.save_script(name="new", body="print('b')", id="s1")
    assert result["script"]["name"] == "new"
    assert result["script"]["body"] == "print('b')"
    # Same row was updated, not duplicated
    assert len(svc._fake_db.get_all_items("script")) == 1


def test_save_script_unknown_id_raises(svc):
    with pytest.raises(KeyError):
        svc.save_script(name="x", body="x", id="does-not-exist")


@pytest.mark.asyncio
async def test_delete_script_by_id(svc):
    svc._fake_db.insert_item("script", "s1", {"id": "s1", "name": "x"})
    svc.delete_script(id="s1")
    assert svc._fake_db.get_all_items("script") == []


def test_delete_unknown_raises(svc):
    with pytest.raises(KeyError):
        svc.delete_script(id="nope")


# ─────────────────────────────────────────────────────────────────────
# rename_script / duplicate_script / search_scripts
# ─────────────────────────────────────────────────────────────────────


def test_rename_script_changes_only_name(svc):
    svc._fake_db.insert_item("script", "s1", {
        "id": "s1", "name": "old", "body": "print(1)", "language": "python",
    })
    result = svc.rename_script(id="s1", new_name="new")
    assert result["script"]["name"] == "new"
    assert result["script"]["body"] == "print(1)"
    assert svc._fake_db.get_item("script", "s1")["name"] == "new"


def test_rename_unknown_raises(svc):
    with pytest.raises(KeyError):
        svc.rename_script(id="nope", new_name="x")


def test_duplicate_script_creates_copy_with_new_id(svc):
    svc._fake_db.insert_item("script", "s1", {
        "id": "s1", "name": "demo", "body": "print(1)", "language": "python",
    })
    result = svc.duplicate_script(id="s1")
    new = result["script"]
    assert new["id"] != "s1"
    assert new["body"] == "print(1)"
    assert "(copy)" in new["name"]
    # Both rows present
    assert len(svc._fake_db.get_all_items("script")) == 2


def test_duplicate_script_honours_new_name(svc):
    svc._fake_db.insert_item("script", "s1", {
        "id": "s1", "name": "demo", "body": "x", "language": "python",
    })
    result = svc.duplicate_script(id="s1", new_name="my-fork")
    assert result["script"]["name"] == "my-fork"


def test_search_scripts_matches_name(svc):
    for i, n in enumerate(["alpha", "beta", "alphabet"]):
        svc._fake_db.insert_item("script", f"s{i}",
                                 {"id": f"s{i}", "name": n, "body": ""})
    result = svc.search_scripts(query="alpha")
    names = {s["name"] for s in result["scripts"]}
    assert names == {"alpha", "alphabet"}


def test_search_scripts_matches_body_when_enabled(svc):
    svc._fake_db.insert_item("script", "s1",
                             {"id": "s1", "name": "hello", "body": "import requests"})
    svc._fake_db.insert_item("script", "s2",
                             {"id": "s2", "name": "world", "body": "print('hi')"})
    result = svc.search_scripts(query="requests")
    assert [s["id"] for s in result["scripts"]] == ["s1"]


def test_search_scripts_skips_body_when_disabled(svc):
    svc._fake_db.insert_item("script", "s1",
                             {"id": "s1", "name": "hello", "body": "import requests"})
    result = svc.search_scripts(query="requests", in_body=False)
    assert result["scripts"] == []


def test_search_scripts_empty_query_returns_empty(svc):
    svc._fake_db.insert_item("script", "s1",
                             {"id": "s1", "name": "x", "body": ""})
    assert svc.search_scripts(query="")["scripts"] == []
    assert svc.search_scripts(query="   ")["scripts"] == []


# ─────────────────────────────────────────────────────────────────────
# run_script / run_inline call script_runner with the right output topic
# ─────────────────────────────────────────────────────────────────────


def test_run_script_calls_runner_with_output_topic(svc, monkeypatch):
    svc._fake_db.insert_item("script", "s1", {
        "id": "s1", "name": "echo", "body": "print('hi')",
    })
    fake_run_id = "abcd1234"
    runner_calls: List[Dict[str, Any]] = []

    def fake_run(script_id, body, *, timeout, output_topic):
        runner_calls.append({"script_id": script_id, "body": body,
                              "timeout": timeout, "output_topic": output_topic})
        return fake_run_id

    from robotlab_x.runtime import script_runner
    monkeypatch.setattr(script_runner, "run_in_background", fake_run)

    result = svc.run_script(id="s1", timeout=10.0)
    assert result["run_id"] == fake_run_id
    assert runner_calls == [{
        "script_id": "s1", "body": "print('hi')", "timeout": 10.0,
        "output_topic": "/python/python-1/output",
    }]
    # Recent runs tracked
    assert svc._recent_runs[0]["run_id"] == fake_run_id
    assert svc._recent_runs[0]["status"] == "running"


def test_run_inline_bypasses_db(svc, monkeypatch):
    fake_run_id = "xyz000"
    runner_calls: List[Dict[str, Any]] = []
    from robotlab_x.runtime import script_runner
    monkeypatch.setattr(script_runner, "run_in_background",
                        lambda sid, body, **kw: (runner_calls.append({"sid": sid, "body": body, **kw}), fake_run_id)[1])

    result = svc.run_inline(body="print(2+2)", name="quickmath")
    assert result["run_id"] == fake_run_id
    assert runner_calls[0]["sid"] == "quickmath"
    assert runner_calls[0]["body"] == "print(2+2)"
    assert runner_calls[0]["output_topic"] == "/python/python-1/output"


def test_run_inline_rejects_empty(svc):
    with pytest.raises(ValueError):
        svc.run_inline(body="", name="empty")
    with pytest.raises(ValueError):
        svc.run_inline(body="   ", name="whitespace")


def test_run_script_unknown_raises(svc):
    with pytest.raises(KeyError):
        svc.run_script(id="nope")


# ─────────────────────────────────────────────────────────────────────
# Result watcher updates recent_runs + publishes /result
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_run_end_event_marks_completed(svc, fresh_bus, monkeypatch):
    """Simulate the lifecycle: spawn a run, then publish the meta-end
    event on /python/python-1/output and verify the watcher updates
    recent_runs + publishes /result."""
    from robotlab_x.runtime import script_runner
    monkeypatch.setattr(script_runner, "run_in_background",
                        lambda *a, **kw: "run-aaa")
    svc._fake_db.insert_item("script", "s1", {
        "id": "s1", "name": "demo", "body": "print(1)",
    })

    # Capture /result publishes
    result_msgs: List[Any] = []
    async def collect_results():
        async for msg in fresh_bus.subscribe("/python/python-1/result", "test-result"):
            result_msgs.append(msg.payload)
            return

    res_task = asyncio.create_task(collect_results())
    await asyncio.sleep(0.01)

    svc.run_script(id="s1", timeout=5.0)
    # Give the spawned watcher task a chance to register its subscription
    await asyncio.sleep(0.02)

    # Publish the terminal meta event
    fresh_bus.publish_sync("/python/python-1/output", {
        "stream": "meta", "event": "end", "run_id": "run-aaa", "exit_code": 0,
    })

    await asyncio.wait_for(res_task, timeout=1.0)

    assert result_msgs[0]["status"] == "completed"
    assert result_msgs[0]["exit_code"] == 0
    # recent_runs updated
    entry = next(e for e in svc._recent_runs if e["run_id"] == "run-aaa")
    assert entry["status"] == "completed"
    assert entry["exit_code"] == 0


@pytest.mark.asyncio
async def test_timeout_then_end_marks_timeout_status(svc, fresh_bus, monkeypatch):
    """script_runner publishes 'timeout' then 'end' on a killed run.
    We should carry the timeout flag into the final status."""
    from robotlab_x.runtime import script_runner
    monkeypatch.setattr(script_runner, "run_in_background",
                        lambda *a, **kw: "run-bbb")
    svc._fake_db.insert_item("script", "s1", {
        "id": "s1", "name": "demo", "body": "while True: pass",
    })

    result_msgs: List[Any] = []
    async def collect_results():
        async for msg in fresh_bus.subscribe("/python/python-1/result", "test-result"):
            result_msgs.append(msg.payload)
            return

    res_task = asyncio.create_task(collect_results())
    await asyncio.sleep(0.01)

    svc.run_script(id="s1", timeout=1.0)
    await asyncio.sleep(0.02)

    # Timeout then end (matches script_runner's actual sequence)
    fresh_bus.publish_sync("/python/python-1/output", {
        "stream": "meta", "event": "timeout", "run_id": "run-bbb",
    })
    fresh_bus.publish_sync("/python/python-1/output", {
        "stream": "meta", "event": "end", "run_id": "run-bbb", "exit_code": -15,
    })
    await asyncio.wait_for(res_task, timeout=1.0)

    assert result_msgs[0]["status"] == "timeout"
    assert result_msgs[0]["exit_code"] == -15


# ─────────────────────────────────────────────────────────────────────
# Config schema
# ─────────────────────────────────────────────────────────────────────


def test_python_config_inherits_topic_remap():
    from python_svc import PythonConfig
    c = PythonConfig()
    assert c.topic_remap == {}
