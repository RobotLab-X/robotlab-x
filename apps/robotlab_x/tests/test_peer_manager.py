# unmanaged
"""Step 2c tests — peer_manager bridging.

Verifies the round trip:
  * connect() opens a PeerConnection
  * local subscribe to ``/foo@<remote_id>`` → peer subscribes to ``/foo`` upstream
  * peer pushes ``/foo`` → local bus receives it as ``/foo@<remote_id>``
  * local publish to ``/foo@<remote_id>`` → peer receives ``/foo`` upstream
  * unsubscribe closes the upstream subscription
  * pending subscriptions (subscribed before peer identified) replay on
    CONNECTED state transition
"""
from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, List, Optional

import pytest
import pytest_asyncio
import websockets

from robotlab_x.runtime import peer_manager
from robotlab_x.runtime.bus import Bus
from robotlab_x.runtime import bus as bus_mod
from tests.test_peer_connection import FakePeerServer


@pytest_asyncio.fixture
async def fresh_bus(monkeypatch) -> Bus:
    """Replace the module-level bus singleton with a clean per-test
    instance. Set local_id so federation routing kicks in."""
    bus = Bus()
    bus.set_local_id("witty-gizmo")
    monkeypatch.setattr(bus_mod, "_default_bus", bus)
    yield bus


@pytest_asyncio.fixture
async def fake_peer():
    """A FakePeerServer that identifies as 'silly-droid'."""
    s = FakePeerServer(runtime_id="silly-droid")
    await s.start()
    yield s
    await s.stop()


@pytest_asyncio.fixture(autouse=True)
async def _reset_peer_manager(monkeypatch):
    """Wipe peer_manager state + stub out subprocess JWT so the test
    server's permissive handler accepts the connection."""
    peer_manager.reset_for_tests()
    monkeypatch.setattr(peer_manager, "_token_provider", lambda: "test-token")
    yield
    await peer_manager.stop_all()


# ─────────────────────────────────────────────────────────────────────
# connect / disconnect lifecycle
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_connect_returns_peer_connection(fresh_bus, fake_peer):
    pc = peer_manager.connect(f"ws://127.0.0.1:{fake_peer.port}")
    # Wait for identification
    for _ in range(40):
        if pc.remote_id is not None:
            break
        await asyncio.sleep(0.05)
    assert pc.remote_id == "silly-droid"
    snap = peer_manager.peers()
    assert "silly-droid" in snap
    assert snap["silly-droid"]["state"] == "connected"


@pytest.mark.asyncio
async def test_connect_is_idempotent(fresh_bus, fake_peer):
    """Two connect() calls with the same URL return the same PC."""
    url = f"ws://127.0.0.1:{fake_peer.port}"
    pc1 = peer_manager.connect(url)
    pc2 = peer_manager.connect(url)
    assert pc1 is pc2


# ─────────────────────────────────────────────────────────────────────
# Outbound: local publish → peer
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_local_publish_routes_to_peer(fresh_bus, fake_peer):
    pc = peer_manager.connect(f"ws://127.0.0.1:{fake_peer.port}")
    for _ in range(40):
        if pc.is_connected:
            break
        await asyncio.sleep(0.05)
    assert pc.is_connected

    # Publish via the bus — the suffix routes to peer_manager
    fresh_bus.publish_sync("/servo/servo-1/control@silly-droid", {"action": "stop"})
    await asyncio.sleep(0.1)

    # Server received it with the suffix stripped
    received = [p for p in fake_peer.received_publishes if p["topic"] == "/servo/servo-1/control"]
    assert received and received[0]["payload"] == {"action": "stop"}


# ─────────────────────────────────────────────────────────────────────
# Inbound: peer message → local /foo@<peer_id>
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_subscribe_on_peer_topic_bridges_upstream(fresh_bus, fake_peer):
    """A local subscriber on ``/clock/clock-1/tick@silly-droid`` should:
      1. trigger a peer.subscribe_upstream("/clock/clock-1/tick")
      2. receive messages the peer pushes on that base topic, delivered
         locally to the suffixed address."""
    pc = peer_manager.connect(f"ws://127.0.0.1:{fake_peer.port}")
    for _ in range(40):
        if pc.is_connected:
            break
        await asyncio.sleep(0.05)

    received: List[Any] = []
    async def consume():
        async for msg in fresh_bus.subscribe(
            "/clock/clock-1/tick@silly-droid", "test-listener",
        ):
            received.append(msg.payload)
            return

    listener_task = asyncio.create_task(consume())
    await asyncio.sleep(0.1)   # let the subscribe propagate upstream

    # Server should have received the upstream subscribe
    assert "/clock/clock-1/tick" in fake_peer.received_subscribes

    # Peer pushes a tick — should land locally on the suffixed topic
    await fake_peer.push_message("/clock/clock-1/tick", {"seq": 42})
    await asyncio.wait_for(listener_task, timeout=1.0)
    assert received == [{"seq": 42}]


@pytest.mark.asyncio
async def test_pending_subscription_replays_on_connect(fresh_bus, fake_peer):
    """Subscribe locally BEFORE the peer connects — peer_manager queues
    the subscription and replays it once the peer identifies."""
    # Queue the local subscription before any peer is connected.
    async def consume():
        async for _ in fresh_bus.subscribe("/queued@silly-droid", "preempt"):
            return

    listener_task = asyncio.create_task(consume())
    await asyncio.sleep(0.02)

    # Sub recorded as pending under the peer id
    pending = peer_manager.open_subscriptions()
    assert pending.get("silly-droid") == {"/queued"}

    # NOW connect the peer — replay should fire
    pc = peer_manager.connect(f"ws://127.0.0.1:{fake_peer.port}")
    for _ in range(40):
        if pc.is_connected:
            break
        await asyncio.sleep(0.05)
    await asyncio.sleep(0.1)   # let the replay reach the server

    assert "/queued" in fake_peer.received_subscribes

    listener_task.cancel()
    try:
        await listener_task
    except asyncio.CancelledError:
        pass


@pytest.mark.asyncio
async def test_unsubscribe_closes_upstream(fresh_bus, fake_peer):
    pc = peer_manager.connect(f"ws://127.0.0.1:{fake_peer.port}")
    for _ in range(40):
        if pc.is_connected:
            break
        await asyncio.sleep(0.05)

    async def consume():
        async for _ in fresh_bus.subscribe("/foo@silly-droid", "t"):
            return

    listener_task = asyncio.create_task(consume())
    await asyncio.sleep(0.1)
    assert "/foo" in fake_peer.received_subscribes

    listener_task.cancel()
    try:
        await listener_task
    except asyncio.CancelledError:
        pass
    await asyncio.sleep(0.1)   # let unsubscribe propagate upstream
    assert "/foo" in fake_peer.received_unsubscribes


# ─────────────────────────────────────────────────────────────────────
# /runtime/info is NOT bridged into the local bus
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_runtime_info_not_bridged(fresh_bus, fake_peer):
    """The peer's /runtime/info is consumed internally for identification
    but must NOT be republished as /runtime/info@<peer> — that would
    collide with the local runtime's own retained /runtime/info."""
    pc = peer_manager.connect(f"ws://127.0.0.1:{fake_peer.port}")
    for _ in range(40):
        if pc.is_connected:
            break
        await asyncio.sleep(0.05)

    # Nothing on /runtime/info@silly-droid
    assert not fresh_bus.has_retained("/runtime/info@silly-droid")


# ─────────────────────────────────────────────────────────────────────
# disconnect
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_disconnect_clears_peer_state(fresh_bus, fake_peer):
    pc = peer_manager.connect(f"ws://127.0.0.1:{fake_peer.port}")
    for _ in range(40):
        if pc.is_connected:
            break
        await asyncio.sleep(0.05)
    assert "silly-droid" in peer_manager.peers()

    await peer_manager.disconnect("silly-droid")
    assert "silly-droid" not in peer_manager.peers()
