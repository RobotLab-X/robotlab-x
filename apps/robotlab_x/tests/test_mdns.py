# unmanaged
"""Tests for runtime/mdns.py — auto-discovery wiring.

Doesn't hit real multicast — the ``start()`` API takes optional
``zc_factory`` + ``browser_factory`` injection points so we can drive
the ServiceBrowser callback with mock state changes and assert the
right peer_manager.connect calls happen.
"""
from __future__ import annotations

from typing import List
from unittest.mock import MagicMock

import pytest

from robotlab_x.runtime import mdns


# Real ServiceStateChange has Added / Updated / Removed.
class _FakeStateChange:
    Added = "added"
    Updated = "updated"
    Removed = "removed"


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    """Each test starts with mdns module state cleared. We stub the
    zeroconf module so the local imports inside mdns.start /
    _on_service_change find ServiceInfo + ServiceStateChange without
    touching real multicast.

    ServiceInfo is a passthrough (the test doesn't care about its
    internals); ServiceStateChange uses our fake enum stand-in.
    """
    mdns.reset_for_tests()
    fake_module = type("_FakeZeroconfModule", (), {
        "ServiceStateChange": _FakeStateChange,
        "ServiceInfo": MagicMock(),
    })
    monkeypatch.setitem(__import__("sys").modules, "zeroconf", fake_module)
    yield
    mdns.reset_for_tests()


def _fake_zc_factory():
    """Constructs a MagicMock that mimics Zeroconf enough for start()
    to register + browse without crashing."""
    mock = MagicMock()
    # get_service_info: tests override per-case.
    mock.get_service_info = MagicMock(return_value=None)
    return mock


def _fake_browser_factory(callback_holder):
    """Build a browser_factory that captures the callback so the test
    can invoke it directly."""
    def factory(zc, service_type, handler):
        callback_holder.append(handler)
        return MagicMock()
    return factory


# ─────────────────────────────────────────────────────────────────────
# start / stop
# ─────────────────────────────────────────────────────────────────────


def test_start_registers_and_browses(monkeypatch):
    cb_holder: List = []
    fake_zc = _fake_zc_factory()
    mdns.start(
        runtime_id="witty-gizmo", port=8998,
        zc_factory=lambda: fake_zc,
        browser_factory=_fake_browser_factory(cb_holder),
    )
    assert mdns.is_started()
    # register_service was called
    fake_zc.register_service.assert_called_once()
    # Browser callback was wired
    assert len(cb_holder) == 1


def test_start_is_idempotent(monkeypatch):
    cb_holder: List = []
    fake_zc = _fake_zc_factory()
    mdns.start(
        runtime_id="witty-gizmo", port=8998,
        zc_factory=lambda: fake_zc,
        browser_factory=_fake_browser_factory(cb_holder),
    )
    mdns.start(
        runtime_id="witty-gizmo", port=8998,
        zc_factory=lambda: fake_zc,
        browser_factory=_fake_browser_factory(cb_holder),
    )
    # register_service still called only once
    assert fake_zc.register_service.call_count == 1


def test_stop_unregisters_and_closes(monkeypatch):
    cb_holder: List = []
    fake_zc = _fake_zc_factory()
    mdns.start(
        runtime_id="witty-gizmo", port=8998,
        zc_factory=lambda: fake_zc,
        browser_factory=_fake_browser_factory(cb_holder),
    )
    mdns.stop()
    fake_zc.unregister_all_services.assert_called_once()
    fake_zc.close.assert_called_once()
    assert not mdns.is_started()


# ─────────────────────────────────────────────────────────────────────
# Discovery callback — _on_service_change
# ─────────────────────────────────────────────────────────────────────


def _fire_added(zc, name: str, peer_id: str, host_v4: str, port: int) -> None:
    """Helper: simulate a zeroconf Added event by populating
    get_service_info + invoking the module callback directly."""
    import socket
    info = MagicMock()
    info.properties = {b"id": peer_id.encode("utf-8"),
                       b"version": b"1.0.0"}
    info.addresses = [socket.inet_aton(host_v4)]
    info.port = port
    # No SRV hostname → the code falls back to the IPv4 address. Must be
    # set explicitly: a bare MagicMock returns a truthy auto-attribute
    # for ``.server``, which the hostname-preference path would otherwise
    # splice into the URL instead of host_v4.
    info.server = None
    zc.get_service_info.return_value = info
    mdns._on_service_change(zc, mdns._SERVICE_TYPE, name, _FakeStateChange.Added)


def test_discovery_auto_connects_to_remote_peer(monkeypatch):
    """Discovery must hop onto the bound asyncio loop because the
    zeroconf browser thread can't call asyncio.create_task() directly.
    Our fake loop captures the call_soon_threadsafe scheduling and
    immediately fires the inner _connect_on_loop helper."""
    cb_holder: List = []
    fake_zc = _fake_zc_factory()
    connect_calls: List[str] = []
    monkeypatch.setattr(
        "robotlab_x.runtime.peer_manager.connect",
        lambda url: connect_calls.append(url) or MagicMock(),
    )

    # Fake loop — its call_soon_threadsafe(fn, *args) calls fn(*args)
    # synchronously. Good enough to verify the hop happens.
    class _FakeLoop:
        def call_soon_threadsafe(self, fn, *args):
            fn(*args)
    monkeypatch.setattr(
        "robotlab_x.runtime.peer_manager._manager_loop", _FakeLoop(),
    )

    mdns.start(
        runtime_id="witty-gizmo", port=8998,
        zc_factory=lambda: fake_zc,
        browser_factory=_fake_browser_factory(cb_holder),
        auto_connect=True,
    )
    _fire_added(fake_zc, "silly-droid._robotlabx._tcp.local.",
                peer_id="silly-droid", host_v4="10.0.0.5", port=8998)
    assert connect_calls == ["ws://10.0.0.5:8998/v1/ws"]


def test_discovery_skips_self(monkeypatch):
    """The browser sees our own announcement too — we filter by
    runtime_id to avoid auto-dialing ourselves."""
    cb_holder: List = []
    fake_zc = _fake_zc_factory()
    connect_calls: List[str] = []
    monkeypatch.setattr(
        "robotlab_x.runtime.peer_manager.connect",
        lambda url: connect_calls.append(url) or MagicMock(),
    )
    mdns.start(
        runtime_id="witty-gizmo", port=8998,
        zc_factory=lambda: fake_zc,
        browser_factory=_fake_browser_factory(cb_holder),
    )
    _fire_added(fake_zc, "witty-gizmo._robotlabx._tcp.local.",
                peer_id="witty-gizmo", host_v4="127.0.0.1", port=8998)
    assert connect_calls == []


def test_discovery_respects_auto_connect_false(monkeypatch):
    """With auto_connect off, discovered peers are LOGGED but not
    dialed — user must connect manually from the Topology page."""
    cb_holder: List = []
    fake_zc = _fake_zc_factory()
    connect_calls: List[str] = []
    monkeypatch.setattr(
        "robotlab_x.runtime.peer_manager.connect",
        lambda url: connect_calls.append(url) or MagicMock(),
    )
    mdns.start(
        runtime_id="witty-gizmo", port=8998,
        zc_factory=lambda: fake_zc,
        browser_factory=_fake_browser_factory(cb_holder),
        auto_connect=False,
    )
    _fire_added(fake_zc, "silly-droid._robotlabx._tcp.local.",
                peer_id="silly-droid", host_v4="10.0.0.5", port=8998)
    assert connect_calls == []


def test_discovery_ignores_records_without_id(monkeypatch):
    """A service on our type that lacks an 'id' property is some
    stranger's record — never auto-connect."""
    cb_holder: List = []
    fake_zc = _fake_zc_factory()
    connect_calls: List[str] = []
    monkeypatch.setattr(
        "robotlab_x.runtime.peer_manager.connect",
        lambda url: connect_calls.append(url) or MagicMock(),
    )
    mdns.start(
        runtime_id="witty-gizmo", port=8998,
        zc_factory=lambda: fake_zc,
        browser_factory=_fake_browser_factory(cb_holder),
    )

    # Synthesize an Added event with no id prop
    import socket
    info = MagicMock()
    info.properties = {b"version": b"1.0.0"}     # missing 'id'
    info.addresses = [socket.inet_aton("10.0.0.5")]
    info.port = 8998
    fake_zc.get_service_info.return_value = info
    mdns._on_service_change(
        fake_zc, mdns._SERVICE_TYPE,
        "unknown._robotlabx._tcp.local.",
        _FakeStateChange.Added,
    )
    assert connect_calls == []


def test_discovery_ignores_removed_events(monkeypatch):
    """Removed events shouldn't trigger connect — we don't auto-
    disconnect on mDNS removal because a peer's mDNS record can
    flap (Wi-Fi flicker) while the WS connection stays healthy."""
    cb_holder: List = []
    fake_zc = _fake_zc_factory()
    connect_calls: List[str] = []
    monkeypatch.setattr(
        "robotlab_x.runtime.peer_manager.connect",
        lambda url: connect_calls.append(url) or MagicMock(),
    )
    mdns.start(
        runtime_id="witty-gizmo", port=8998,
        zc_factory=lambda: fake_zc,
        browser_factory=_fake_browser_factory(cb_holder),
    )
    mdns._on_service_change(
        fake_zc, mdns._SERVICE_TYPE,
        "silly-droid._robotlabx._tcp.local.",
        _FakeStateChange.Removed,
    )
    assert connect_calls == []
