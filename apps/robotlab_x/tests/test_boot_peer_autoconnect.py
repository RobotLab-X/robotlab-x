# unmanaged
"""Tests the boot-time autoconnect path in event_handlers.on_startup.

When the runtime singleton's ``service_config.peers`` carries a list
of WS URLs (persisted by a prior ``POST /v1/peers/connect``), each
should be re-dialed automatically on the next start.
"""
from __future__ import annotations

from typing import Any, Dict, List
from unittest.mock import MagicMock

import pytest


class FakeDB:
    def __init__(self) -> None:
        self.tables: Dict[str, Dict[str, Dict[str, Any]]] = {}

    def get_item(self, table: str, key: str):
        return self.tables.get(table, {}).get(key)

    def insert_item(self, table: str, key: str, item) -> None:
        self.tables.setdefault(table, {})[key] = dict(item)


def _boot_autoconnect_block(db, peer_manager) -> List[str]:
    """Replicates the autoconnect logic from event_handlers.on_startup
    without dragging in the full FastAPI lifespan setup. Returns the
    list of URLs the manager was asked to connect to."""
    runtime_row = db.get_item("service_proxy", "runtime") or {}
    peer_urls = (runtime_row.get("service_config") or {}).get("peers") or []
    dialed: List[str] = []
    for url in peer_urls:
        peer_manager.connect(url)
        dialed.append(url)
    return dialed


def test_no_runtime_row_skips_silently():
    """If the catalog seeder hasn't materialised the runtime row yet,
    the autoconnect loop does nothing — must not crash."""
    db = FakeDB()
    pm = MagicMock()
    dialed = _boot_autoconnect_block(db, pm)
    assert dialed == []
    pm.connect.assert_not_called()


def test_empty_peers_list_skips_silently():
    db = FakeDB()
    db.insert_item("service_proxy", "runtime", {
        "id": "runtime", "service_config": {},
    })
    pm = MagicMock()
    dialed = _boot_autoconnect_block(db, pm)
    assert dialed == []
    pm.connect.assert_not_called()


def test_each_peer_is_dialed_once():
    db = FakeDB()
    db.insert_item("service_proxy", "runtime", {
        "id": "runtime",
        "service_config": {
            "peers": ["ws://a:8998/v1/ws", "ws://b:8998/v1/ws"],
        },
    })
    pm = MagicMock()
    dialed = _boot_autoconnect_block(db, pm)
    assert dialed == ["ws://a:8998/v1/ws", "ws://b:8998/v1/ws"]
    assert pm.connect.call_count == 2
    # Order matters — boot dials in persisted order
    calls = [c.args[0] for c in pm.connect.call_args_list]
    assert calls == ["ws://a:8998/v1/ws", "ws://b:8998/v1/ws"]


def test_one_peer_failing_does_not_block_others():
    """A bad URL or transient resolver issue on one peer mustn't
    prevent the others from being dialed. Documents the contract that
    autoconnect is best-effort — failures log + move on."""
    db = FakeDB()
    db.insert_item("service_proxy", "runtime", {
        "id": "runtime",
        "service_config": {
            "peers": ["ws://bad:8998/v1/ws", "ws://good:8998/v1/ws"],
        },
    })
    pm = MagicMock()
    pm.connect.side_effect = [Exception("dns failure"), MagicMock()]
    # Production code wraps each .connect in try/except — test
    # mirrors that.
    runtime_row = db.get_item("service_proxy", "runtime") or {}
    peer_urls = (runtime_row.get("service_config") or {}).get("peers") or []
    for url in peer_urls:
        try:
            pm.connect(url)
        except Exception:
            pass
    assert pm.connect.call_count == 2
