# unmanaged
"""Tests for runtime/peer_connection.py — step 2b of federation.

Spins up a tiny in-process WebSocket server that mimics enough of the
real ``/v1/ws`` endpoint that PeerConnection can connect, identify,
publish, and subscribe. No real backend, no real bus — just enough to
verify the wire protocol + reconnect logic.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Awaitable, Callable, Dict, List, Optional

import pytest
import pytest_asyncio
import websockets

from robotlab_x.runtime.peer_connection import (
    PeerConnection,
    PeerState,
    _backoff,
    _normalise_peer_url,
)


logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────
# URL normalisation + backoff helpers
# ─────────────────────────────────────────────────────────────────────


def test_normalise_appends_v1_ws():
    assert _normalise_peer_url("ws://localhost:8998") == "ws://localhost:8998/v1/ws"


def test_normalise_keeps_full_path():
    assert _normalise_peer_url("ws://localhost:8998/v1/ws") == "ws://localhost:8998/v1/ws"


def test_normalise_strips_trailing_slash():
    assert _normalise_peer_url("ws://localhost:8998/") == "ws://localhost:8998/v1/ws"


def test_normalise_rewrites_http_to_ws():
    assert _normalise_peer_url("http://10.0.0.1:8998") == "ws://10.0.0.1:8998/v1/ws"
    assert _normalise_peer_url("https://peer.example") == "wss://peer.example/v1/ws"


def test_backoff_grows_and_caps():
    """First attempts stay small; later attempts cap at 30s. Each call
    returns a random value in [min, base] — full jitter."""
    # attempt 1: base = 0.25 * 2^0 = 0.25 (== floor)
    assert 0.25 <= _backoff(1) <= 0.25 + 0.01
    # attempt 5: base = 0.25 * 2^4 = 4.0
    for _ in range(10):
        v = _backoff(5)
        assert 0.25 <= v <= 4.0
    # attempt 20: capped at 30s
    for _ in range(10):
        v = _backoff(20)
        assert 0.25 <= v <= 30.0


# ─────────────────────────────────────────────────────────────────────
# Fake remote runtime WS server
# ─────────────────────────────────────────────────────────────────────


class FakePeerServer:
    """Minimal stand-in for the real /v1/ws endpoint.

    Speaks the four frame methods PeerConnection cares about:
      * inbound  subscribe → ack + replay retained for /runtime/info
      * inbound  unsubscribe → ack
      * inbound  publish → record + ack
      * outbound message frames pushed by ``push_message()``
    """

    def __init__(self, runtime_id: str = "silly-droid") -> None:
        self.runtime_id = runtime_id
        # Recorded frames the connecting peer sent us.
        self.received_subscribes: List[str] = []
        self.received_publishes: List[Dict[str, Any]] = []
        self.received_unsubscribes: List[str] = []
        # Connected client(s) so tests can push messages.
        self._clients: List[websockets.WebSocketServerProtocol] = []
        self.server: Optional[websockets.Server] = None
        self.port: int = 0
        self.connection_count = 0

    async def _handler(self, ws, path: str = "/v1/ws") -> None:
        self.connection_count += 1
        self._clients.append(ws)
        try:
            async for raw in ws:
                frame = json.loads(raw)
                method = frame.get("method")
                data = frame.get("data") or {}
                topic = data.get("topic")
                frame_id = frame.get("id")
                if method == "subscribe":
                    self.received_subscribes.append(topic)
                    await ws.send(json.dumps({
                        "method": "ack", "id": frame_id,
                        "topic": topic, "subscribed": True,
                    }))
                    # Replay our identity on /runtime/info
                    if topic == "/runtime/info":
                        await ws.send(json.dumps({
                            "method": "message", "topic": "/runtime/info",
                            "payload": {"id": self.runtime_id, "version": "test"},
                        }))
                elif method == "unsubscribe":
                    self.received_unsubscribes.append(topic)
                    await ws.send(json.dumps({
                        "method": "ack", "id": frame_id,
                        "topic": topic, "subscribed": False,
                    }))
                elif method == "publish":
                    self.received_publishes.append({
                        "topic": topic, "payload": data.get("payload"),
                        "retained": data.get("retained", False),
                    })
                    await ws.send(json.dumps({
                        "method": "ack", "id": frame_id,
                        "topic": topic, "delivered": 1,
                    }))
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            if ws in self._clients:
                self._clients.remove(ws)

    async def start(self) -> None:
        # Port 0 → OS picks a free one. We read it back via .sockets.
        self.server = await websockets.serve(
            self._handler, host="127.0.0.1", port=0,
        )
        self.port = self.server.sockets[0].getsockname()[1]

    async def stop(self) -> None:
        if self.server is not None:
            self.server.close()
            await self.server.wait_closed()
        # Close any lingering clients
        for c in list(self._clients):
            try:
                await c.close()
            except Exception:  # noqa: BLE001
                pass

    async def push_message(self, topic: str, payload: Any) -> None:
        """Push a /message frame to every connected client."""
        frame = json.dumps({"method": "message", "topic": topic, "payload": payload})
        dead = []
        for c in self._clients:
            try:
                await c.send(frame)
            except Exception:  # noqa: BLE001
                dead.append(c)
        for c in dead:
            self._clients.remove(c)

    async def drop_all(self) -> None:
        """Close every active client connection so we can test reconnect."""
        for c in list(self._clients):
            await c.close()


@pytest_asyncio.fixture
async def fake_server():
    s = FakePeerServer()
    await s.start()
    try:
        yield s
    finally:
        await s.stop()


# ─────────────────────────────────────────────────────────────────────
# Identify / connect lifecycle
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_connect_identifies_remote_id(fake_server):
    """On first connect, PeerConnection subscribes to /runtime/info and
    transitions to CONNECTED once the retained id arrives."""
    pc = PeerConnection(
        url=f"ws://127.0.0.1:{fake_server.port}",
        token_provider=lambda: "test-token",
    )
    pc.start()
    try:
        # Wait up to 2s for identification
        for _ in range(40):
            if pc.is_connected:
                break
            await asyncio.sleep(0.05)
        assert pc.is_connected
        assert pc.remote_id == "silly-droid"
        # Server received the identify subscribe
        assert "/runtime/info" in fake_server.received_subscribes
    finally:
        await pc.stop()


@pytest.mark.asyncio
async def test_state_transitions(fake_server):
    """State progresses INIT → CONNECTING → IDENTIFYING → CONNECTED.
    We capture the sequence via on_state_change."""
    transitions: List[PeerState] = []
    pc = PeerConnection(
        url=f"ws://127.0.0.1:{fake_server.port}",
        token_provider=lambda: "test-token",
        on_state_change=lambda p: transitions.append(p.state),
    )
    pc.start()
    try:
        for _ in range(40):
            if pc.is_connected:
                break
            await asyncio.sleep(0.05)
    finally:
        await pc.stop()
    assert PeerState.CONNECTING in transitions
    assert PeerState.IDENTIFYING in transitions
    assert PeerState.CONNECTED in transitions
    # STOPPED appears at the end after we called stop()
    assert transitions[-1] == PeerState.STOPPED


# ─────────────────────────────────────────────────────────────────────
# Publish + subscribe upstream
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_publish_upstream_sends_frame(fake_server):
    pc = PeerConnection(
        url=f"ws://127.0.0.1:{fake_server.port}",
        token_provider=lambda: "test-token",
    )
    pc.start()
    try:
        for _ in range(40):
            if pc.is_connected:
                break
            await asyncio.sleep(0.05)
        ok = await pc.publish_upstream("/foo/bar", {"v": 1}, retained=True)
        assert ok
        # Server received it
        await asyncio.sleep(0.05)
        assert fake_server.received_publishes
        rec = fake_server.received_publishes[0]
        assert rec["topic"] == "/foo/bar"
        assert rec["payload"] == {"v": 1}
        assert rec["retained"] is True
    finally:
        await pc.stop()


@pytest.mark.asyncio
async def test_publish_when_disconnected_returns_false(fake_server):
    """publish_upstream before identification completes (or after a
    drop) must report failure rather than silently dropping."""
    pc = PeerConnection(
        url=f"ws://127.0.0.1:{fake_server.port}",
        token_provider=lambda: "test-token",
    )
    # Don't start() — pc is in INIT
    ok = await pc.publish_upstream("/foo", {"v": 1})
    assert ok is False


@pytest.mark.asyncio
async def test_subscribe_upstream_is_idempotent(fake_server):
    pc = PeerConnection(
        url=f"ws://127.0.0.1:{fake_server.port}",
        token_provider=lambda: "test-token",
    )
    pc.start()
    try:
        for _ in range(40):
            if pc.is_connected:
                break
            await asyncio.sleep(0.05)
        await pc.subscribe_upstream("/topic-a")
        await pc.subscribe_upstream("/topic-a")    # second call: no-op
        await asyncio.sleep(0.05)
        # /runtime/info from identify + one /topic-a
        a_subs = [t for t in fake_server.received_subscribes if t == "/topic-a"]
        assert len(a_subs) == 1
    finally:
        await pc.stop()


@pytest.mark.asyncio
async def test_unsubscribe_upstream_sends_frame_and_clears(fake_server):
    pc = PeerConnection(
        url=f"ws://127.0.0.1:{fake_server.port}",
        token_provider=lambda: "test-token",
    )
    pc.start()
    try:
        for _ in range(40):
            if pc.is_connected:
                break
            await asyncio.sleep(0.05)
        await pc.subscribe_upstream("/topic-x")
        await pc.unsubscribe_upstream("/topic-x")
        await asyncio.sleep(0.05)
        assert "/topic-x" in fake_server.received_unsubscribes
        # Re-subscribing should fire a new subscribe (cleared the cache)
        await pc.subscribe_upstream("/topic-x")
        await asyncio.sleep(0.05)
        x_subs = [t for t in fake_server.received_subscribes if t == "/topic-x"]
        assert len(x_subs) == 2
    finally:
        await pc.stop()


# ─────────────────────────────────────────────────────────────────────
# Inbound message dispatch
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_inbound_message_dispatches_to_callback(fake_server):
    received: List[tuple] = []
    pc = PeerConnection(
        url=f"ws://127.0.0.1:{fake_server.port}",
        token_provider=lambda: "test-token",
        on_message=lambda topic, payload, frame: received.append((topic, payload)),
    )
    pc.start()
    try:
        for _ in range(40):
            if pc.is_connected:
                break
            await asyncio.sleep(0.05)
        # Server pushes a normal /message frame
        await fake_server.push_message("/clock/clock-1/tick", {"seq": 7})
        # /runtime/info was also pushed during identify — wait for both
        for _ in range(20):
            if any(t == "/clock/clock-1/tick" for t, _ in received):
                break
            await asyncio.sleep(0.05)
    finally:
        await pc.stop()
    topics_seen = [t for t, _ in received]
    assert "/runtime/info" in topics_seen
    assert "/clock/clock-1/tick" in topics_seen


# ─────────────────────────────────────────────────────────────────────
# Reconnect
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_reconnects_after_remote_drop(fake_server, monkeypatch):
    """If the remote closes the connection, PeerConnection should
    reconnect + re-identify. We replay the upstream subscription set
    so the bridge survives drops."""
    # Tighten the backoff so this test doesn't take 30s
    monkeypatch.setattr(
        "robotlab_x.runtime.peer_connection._BACKOFF_MIN_S", 0.02,
    )
    monkeypatch.setattr(
        "robotlab_x.runtime.peer_connection._BACKOFF_MAX_S", 0.1,
    )

    pc = PeerConnection(
        url=f"ws://127.0.0.1:{fake_server.port}",
        token_provider=lambda: "test-token",
    )
    pc.start()
    try:
        for _ in range(40):
            if pc.is_connected:
                break
            await asyncio.sleep(0.05)
        assert pc.is_connected
        await pc.subscribe_upstream("/will-survive")
        await asyncio.sleep(0.05)
        first_subs = list(fake_server.received_subscribes)
        first_conn_count = fake_server.connection_count

        await fake_server.drop_all()
        # Wait for reconnect
        for _ in range(50):
            if pc.is_connected and fake_server.connection_count > first_conn_count:
                break
            await asyncio.sleep(0.05)
        assert fake_server.connection_count >= first_conn_count + 1
        assert pc.is_connected
        # Server should have seen another /will-survive subscribe in
        # the re-identify pass.
        new_subs = fake_server.received_subscribes[len(first_subs):]
        assert "/will-survive" in new_subs
    finally:
        await pc.stop()
