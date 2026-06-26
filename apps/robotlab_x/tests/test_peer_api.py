# unmanaged
"""Peer service-layer tests — the backing logic for the generated peer
router (resource_slug "peers", methods list + request).

The router is a thin ``create_crud_router`` shim; all behaviour lives in
``services/peer_service.py`` which delegates to ``peer_manager``. We test:
  * GET /v1/peers shape — get_all_peer returns a list of snapshots
  * POST /v1/peers-request {action: connect}  persists the URL
  * POST /v1/peers-request {action: disconnect} drops + unpersists
  * unknown action → 400
  * the persistence helpers handle missing DB / runtime row gracefully

The connect path uses peer_manager.connect under the hood; we mock it
out so these tests don't need a real WebSocket server (those paths are
covered by test_peer_manager.py).
"""
from __future__ import annotations

from typing import Any, Dict
from unittest.mock import MagicMock

import pytest

from robotlab_x.services import peer_service
from robotlab_x.runtime.peer_connection import PeerState


class FakeDB:
    """Minimal in-memory adapter (mirrors test_python_service's)."""
    def __init__(self) -> None:
        self.tables: Dict[str, Dict[str, Dict[str, Any]]] = {}

    def get_item(self, table: str, key: str):
        return self.tables.get(table, {}).get(key)

    def update_item(self, table: str, key: str, item, include_nulls: bool = False) -> None:
        self.tables.setdefault(table, {})[key] = dict(item)

    def insert_item(self, table: str, key: str, item) -> None:
        self.tables.setdefault(table, {})[key] = dict(item)


@pytest.fixture
def fresh_db(monkeypatch) -> FakeDB:
    """Replace get_database_client globally so peer_service.persist hits
    our FakeDB."""
    db = FakeDB()
    monkeypatch.setattr(
        "robotlab_x.services.peer_service.get_database_client", lambda: db,
    )
    return db


@pytest.fixture
def seeded_runtime(fresh_db) -> FakeDB:
    """The runtime singleton row needs to exist for the persistence
    helper to do anything useful."""
    fresh_db.insert_item("service_proxy", "runtime", {
        "id": "runtime", "name": "runtime",
        "service_meta_id": "runtime@1.0.0",
        "status": "running", "service_config": {},
    })
    return fresh_db


# ─────────────────────────────────────────────────────────────────────
# _persist_peers
# ─────────────────────────────────────────────────────────────────────


def test_persist_peers_writes_dedup_sorted(seeded_runtime):
    """Same URL twice → one entry. Out of order → sorted output. Keeps
    the persisted list stable so a runtime restart connects in the
    same order every time."""
    peer_service._persist_peers([
        "ws://b/v1/ws", "ws://a/v1/ws", "ws://a/v1/ws", "ws://c/v1/ws",
    ])
    saved = seeded_runtime.get_item("service_proxy", "runtime")["service_config"]["peers"]
    assert saved == ["ws://a/v1/ws", "ws://b/v1/ws", "ws://c/v1/ws"]


def test_persist_peers_no_runtime_row_is_noop(fresh_db):
    """If the singleton row hasn't been seeded yet (early boot test),
    the persist helper should silently skip rather than crash."""
    peer_service._persist_peers(["ws://x"])
    # No table created
    assert fresh_db.tables == {}


def test_persist_peers_no_db_is_noop(monkeypatch):
    """Persist runs through DB layer; if DB unavailable (e.g. graceful
    shutdown), the helper logs + returns without raising."""
    monkeypatch.setattr(
        "robotlab_x.services.peer_service.get_database_client", lambda: None,
    )
    peer_service._persist_peers(["ws://x"])   # must not raise


# ─────────────────────────────────────────────────────────────────────
# get_all_peer (GET /v1/peers)
# ─────────────────────────────────────────────────────────────────────


def test_list_peers_empty_when_none(monkeypatch):
    monkeypatch.setattr(
        "robotlab_x.services.peer_service.peer_manager.peers", lambda: {},
    )
    out = peer_service.get_all_peer(None, None)
    assert out == []


def test_list_peers_returns_snapshot(monkeypatch):
    """Each entry includes id + key (id-or-url), url, remote_id, state,
    upstream_subs — exactly what the UI needs to render the row."""
    monkeypatch.setattr(
        "robotlab_x.services.peer_service.peer_manager.peers",
        lambda: {
            "silly-droid": {
                "url": "ws://10.0.0.5:8998/v1/ws",
                "remote_id": "silly-droid",
                "state": "connected",
                "upstream_subs": ["/foo"],
            },
        },
    )
    out = peer_service.get_all_peer(None, None)
    assert out == [{
        "id": "silly-droid",
        "key": "silly-droid",
        "url": "ws://10.0.0.5:8998/v1/ws",
        "remote_id": "silly-droid",
        "state": "connected",
        "upstream_subs": ["/foo"],
    }]


# ─────────────────────────────────────────────────────────────────────
# process_peer_request — connect
# ─────────────────────────────────────────────────────────────────────


def test_connect_peer_returns_pre_identification_state(seeded_runtime, monkeypatch):
    """Just-opened connection is in CONNECTING / IDENTIFYING; the
    request meta reports whatever state the manager has at that moment
    so the UI can poll until it flips to connected."""
    fake_pc = MagicMock()
    fake_pc.remote_id = None
    fake_pc.url = "ws://10.0.0.5:8998/v1/ws"
    fake_pc.state = PeerState.IDENTIFYING

    monkeypatch.setattr(
        "robotlab_x.services.peer_service.peer_manager.connect",
        lambda url: fake_pc,
    )
    monkeypatch.setattr(
        "robotlab_x.services.peer_service.peer_manager.peers",
        lambda: {"@ws://10.0.0.5:8998/v1/ws": {
            "url": "ws://10.0.0.5:8998/v1/ws",
            "remote_id": None, "state": "identifying", "upstream_subs": [],
        }},
    )

    out = peer_service.process_peer_request(
        {"action": "connect", "url": "ws://10.0.0.5:8998"}, None, None)
    meta = out["metadata"]
    assert meta["url"] == "ws://10.0.0.5:8998/v1/ws"
    assert meta["remote_id"] is None
    assert meta["state"] == "identifying"
    # And the URL got persisted
    cfg = seeded_runtime.get_item("service_proxy", "runtime")["service_config"]
    assert cfg["peers"] == ["ws://10.0.0.5:8998/v1/ws"]


def test_connect_peer_propagates_failures(monkeypatch):
    """If peer_manager.connect raises (e.g. invalid URL), the request
    raises 500 with the error message — not a silent success."""
    from fastapi import HTTPException

    def _boom(url):
        raise ValueError("bad url")
    monkeypatch.setattr(
        "robotlab_x.services.peer_service.peer_manager.connect", _boom)
    with pytest.raises(HTTPException) as exc:
        peer_service.process_peer_request(
            {"action": "connect", "url": "garbage"}, None, None)
    assert exc.value.status_code == 500
    assert "bad url" in str(exc.value.detail)


def test_unknown_action_is_400():
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        peer_service.process_peer_request({"action": "bogus"}, None, None)
    assert exc.value.status_code == 400


# ─────────────────────────────────────────────────────────────────────
# process_peer_request — disconnect
# ─────────────────────────────────────────────────────────────────────


def test_disconnect_peer_removes_from_persistence(seeded_runtime, monkeypatch):
    # Seed the persisted list with one URL, then disconnect.
    seeded_runtime.update_item("service_proxy", "runtime", {
        "id": "runtime",
        "service_meta_id": "runtime@1.0.0",
        "service_config": {"peers": ["ws://a/v1/ws", "ws://b/v1/ws"]},
    })

    called: list = []
    async def fake_disconnect(key):
        called.append(key)
    monkeypatch.setattr(
        "robotlab_x.services.peer_service.peer_manager.disconnect", fake_disconnect,
    )
    # No manager loop in the test → _run_async falls back to asyncio.run.
    monkeypatch.setattr(peer_service.peer_manager, "_manager_loop", None, raising=False)
    monkeypatch.setattr(
        "robotlab_x.services.peer_service.peer_manager.peers",
        # 'silly-droid' is connected — appears in the snapshot
        lambda: {"silly-droid": {
            "url": "ws://a/v1/ws", "remote_id": "silly-droid",
            "state": "connected", "upstream_subs": [],
        }},
    )

    out = peer_service.process_peer_request(
        {"action": "disconnect", "key": "silly-droid"}, None, None)
    meta = out["metadata"]
    assert meta["key"] == "silly-droid"
    assert meta["disconnected"] is True
    assert called == ["silly-droid"]


def test_disconnect_peer_unknown_key_is_idempotent(monkeypatch):
    """Disconnecting an unknown key returns disconnected=False but
    doesn't error — UI can call this on a stale entry without crashing."""
    called: list = []
    async def fake_disconnect(key):
        called.append(key)
    monkeypatch.setattr(
        "robotlab_x.services.peer_service.peer_manager.disconnect", fake_disconnect,
    )
    monkeypatch.setattr(peer_service.peer_manager, "_manager_loop", None, raising=False)
    monkeypatch.setattr(
        "robotlab_x.services.peer_service.peer_manager.peers", lambda: {},
    )
    out = peer_service.process_peer_request(
        {"action": "disconnect", "key": "not-a-peer"}, None, None)
    assert out["metadata"]["disconnected"] is False
    # disconnect is still called (idempotent)
    assert called == ["not-a-peer"]
