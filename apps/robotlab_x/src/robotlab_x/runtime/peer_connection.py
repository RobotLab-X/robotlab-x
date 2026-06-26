# unmanaged
"""Outbound WebSocket connection to another robotlab_x runtime.

Step 2b — federation primitive. ``PeerConnection`` owns a single
long-lived WS to a remote runtime's ``/v1/ws`` endpoint:

  1. Open the socket with a subprocess JWT (Option A authentication —
     both runtimes must share ``JWT_SECRET_KEY``; documented as a
     LAN-dev constraint).
  2. Subscribe to remote ``/runtime/info`` and parse out the remote
     runtime id. Until that arrives we hold ``remote_id = None``.
  3. Expose ``publish_upstream`` / ``subscribe_upstream`` so the peer
     manager (step 2c) can route bus traffic across.
  4. On disconnect, reconnect with exponential backoff (250ms → 30s,
     full jitter) so a peer reboot doesn't require manual reconnect.

This file knows nothing about the local bus. It speaks the WS wire
protocol and dispatches inbound frames to registered callbacks. The
peer_manager (next step) is what glues PeerConnection to the bus.
"""
from __future__ import annotations

import asyncio
import json
import logging
import random
import uuid
from enum import Enum
from typing import Any, Awaitable, Callable, Dict, Optional, Set

import websockets
from websockets.exceptions import WebSocketException


logger = logging.getLogger(__name__)


# Expected, transient peer-connection failures — peer down (OSError /
# DNS gaierror / refused), connect timeout, or any websockets protocol
# error (closed, 403 auth-reject, bad handshake). These are normal for a
# peer that isn't up; the reconnect loop handles them, so they log at INFO
# without a traceback rather than ERROR. Anything else is a real bug and
# still gets a full stack trace.
_EXPECTED_PEER_ERRORS = (
    OSError,
    asyncio.TimeoutError,
    TimeoutError,
    WebSocketException,
)


# Backoff bounds for reconnect. Caps at 30s so a transient remote
# restart still recovers quickly. Full jitter (random between 0 and
# the backoff) so two peers reconnecting after the same outage don't
# synchronise their attempts.
_BACKOFF_MIN_S = 0.25
_BACKOFF_MAX_S = 30.0


class PeerState(str, Enum):
    """Lifecycle states. Surfaced through ``PeerConnection.state`` so
    the Topology UI can show 'connecting…' / 'identifying…' / 'green'
    badges without doing its own probing."""
    INIT = "init"
    CONNECTING = "connecting"
    IDENTIFYING = "identifying"     # WS up, waiting for /runtime/info
    CONNECTED = "connected"          # remote_id known, ready to bridge
    DISCONNECTED = "disconnected"
    STOPPED = "stopped"              # explicit shutdown — no reconnect


class PeerConnection:
    """One outbound WS to a remote runtime.

    The hot loop is ``_run`` — an asyncio task that connects, handles
    inbound frames, and on EOF / error reconnects with backoff. State
    transitions are observable via ``state`` for the UI.

    Callbacks the caller can wire:
      * ``on_state_change(state)``       — every transition
      * ``on_message(topic, payload, frame)`` — every inbound /message
        frame the peer pushes us. The peer_manager will use this to
        bridge messages back onto the local bus.
    """

    def __init__(
        self,
        url: str,
        *,
        token_provider: Callable[[], str],
        on_state_change: Optional[Callable[["PeerConnection"], None]] = None,
        on_message: Optional[Callable[[str, Any, Dict[str, Any]], None]] = None,
        local_id_provider: Optional[Callable[[], str]] = None,
    ) -> None:
        # Normalise the URL — accept either ``ws://host:port`` or
        # ``ws://host:port/v1/ws``; the latter is what gets actually
        # opened either way.
        self.url = _normalise_peer_url(url)
        self._token_provider = token_provider
        self._on_state_change = on_state_change
        self._on_message = on_message
        # Lazy lookup of OUR runtime id so the collision check has a
        # value to compare against. Lazy because identity might still
        # be resolving when PeerConnection is constructed.
        self._local_id_provider = local_id_provider

        self._state = PeerState.INIT
        self.remote_id: Optional[str] = None
        # Set once a collision has been detected with a peer that
        # identifies as the same runtime id as us. STOPPED state +
        # this flag prevent the reconnect loop from chasing the same
        # collision forever. ``collision_detail`` is surfaced to the
        # peers API so the UI can show why the bridge is dead.
        self.collision_detected: bool = False
        self.collision_detail: Optional[str] = None
        # Locally-issued subscription ids → topic the caller asked
        # for. Used when an ack/message comes back so we can route it.
        self._upstream_subscriptions: Set[str] = set()
        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._task: Optional[asyncio.Task] = None
        self._stop_event = asyncio.Event()

    # ─── public API ───────────────────────────────────────────────────

    def start(self) -> None:
        """Spawn the connect+run task on the current loop.

        Idempotent — calling start() twice is a no-op. Caller is
        responsible for awaiting ``stop()`` before discarding the
        object so the WS handshake cleanup runs.
        """
        if self._task is not None and not self._task.done():
            return
        self._stop_event = asyncio.Event()
        self._task = asyncio.create_task(
            self._run(), name=f"peer:{self.url}",
        )

    async def stop(self) -> None:
        """Signal shutdown + wait for the run task to wind down."""
        self._set_state(PeerState.STOPPED)
        self._stop_event.set()
        ws = self._ws
        if ws is not None:
            try:
                await ws.close()
            except Exception:  # noqa: BLE001
                pass
        if self._task is not None:
            try:
                await asyncio.wait_for(self._task, timeout=2.0)
            except asyncio.TimeoutError:
                self._task.cancel()
            self._task = None

    @property
    def state(self) -> PeerState:
        return self._state

    @property
    def is_connected(self) -> bool:
        return self._state == PeerState.CONNECTED

    async def publish_upstream(
        self,
        topic: str,
        payload: Any,
        *,
        retained: bool = False,
    ) -> bool:
        """Send a publish frame upstream. Returns True if the frame
        was put on the wire, False if disconnected (caller decides
        whether to buffer or drop). Doesn't wait for an ack."""
        return await self._send({
            "id": _new_frame_id(),
            "method": "publish",
            "data": {"topic": topic, "payload": payload, "retained": retained},
        })

    async def subscribe_upstream(self, topic: str) -> bool:
        """Open an upstream subscription. Idempotent — repeat calls
        for the same topic produce one upstream sub. The peer manager
        relies on this for the lazy-bridge in step 2c."""
        if topic in self._upstream_subscriptions:
            return True
        if not await self._send({
            "id": _new_frame_id(),
            "method": "subscribe",
            "data": {"topic": topic},
        }):
            return False
        self._upstream_subscriptions.add(topic)
        return True

    async def unsubscribe_upstream(self, topic: str) -> bool:
        if topic not in self._upstream_subscriptions:
            return True
        self._upstream_subscriptions.discard(topic)
        return await self._send({
            "id": _new_frame_id(),
            "method": "unsubscribe",
            "data": {"topic": topic},
        })

    # ─── internals ────────────────────────────────────────────────────

    def _set_state(self, new_state: PeerState) -> None:
        if self._state == new_state:
            return
        logger.info("peer %s: state %s → %s", self.url, self._state.value, new_state.value)
        self._state = new_state
        if self._on_state_change is not None:
            try:
                self._on_state_change(self)
            except Exception:  # noqa: BLE001
                logger.exception("peer %s: on_state_change raised", self.url)

    async def _send(self, frame: Dict[str, Any]) -> bool:
        ws = self._ws
        if ws is None or self._state in (PeerState.DISCONNECTED, PeerState.STOPPED, PeerState.INIT):
            return False
        try:
            await ws.send(json.dumps(frame))
            return True
        except Exception:  # noqa: BLE001
            logger.exception("peer %s: send failed", self.url)
            return False

    async def _run(self) -> None:
        """Connect/reconnect loop. Lives until stop() fires."""
        attempt = 0
        while not self._stop_event.is_set():
            try:
                attempt += 1
                await self._connect_and_serve()
                attempt = 0   # clean disconnect — reset backoff
            except asyncio.CancelledError:
                raise
            except _EXPECTED_PEER_ERRORS as exc:
                # Peer unreachable / closed / auth-rejected — an expected,
                # transient condition; the loop just retries on backoff.
                # Log compactly (no traceback, INFO) so an offline peer
                # doesn't spam ERROR + stack traces into the log.
                logger.info(
                    "peer %s: not connected (%s) — will retry",
                    self.url, type(exc).__name__,
                )
            except Exception:  # noqa: BLE001 — genuinely unexpected
                logger.exception("peer %s: serve loop raised", self.url)

            if self._stop_event.is_set():
                break

            self._set_state(PeerState.DISCONNECTED)
            delay = _backoff(attempt)
            logger.info("peer %s: reconnecting in %.2fs", self.url, delay)
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=delay)
                break   # stop_event fired during backoff
            except asyncio.TimeoutError:
                continue

    async def _connect_and_serve(self) -> None:
        """Single connect → identify → serve cycle. Returns on
        disconnect; the outer loop handles retry."""
        token = self._token_provider()
        url_with_token = f"{self.url}?token={token}"
        self._set_state(PeerState.CONNECTING)

        try:
            async with websockets.connect(url_with_token, ping_interval=20, ping_timeout=20) as ws:
                self._ws = ws
                self._set_state(PeerState.IDENTIFYING)

                # Identify: subscribe to /runtime/info; the retained
                # message arrives almost immediately and carries the
                # remote id. We DON'T flip CONNECTED until that lands —
                # the bridge needs the id to address messages.
                await ws.send(json.dumps({
                    "id": _new_frame_id(),
                    "method": "subscribe",
                    "data": {"topic": "/runtime/info"},
                }))

                # Replay upstream subscriptions the caller asked for
                # before a previous disconnect — peer_manager state
                # outlives the WS connection.
                for topic in list(self._upstream_subscriptions):
                    await ws.send(json.dumps({
                        "id": _new_frame_id(),
                        "method": "subscribe",
                        "data": {"topic": topic},
                    }))

                async for raw in ws:
                    if self._stop_event.is_set():
                        break
                    self._handle_inbound(raw)
        finally:
            self._ws = None
            if self._state not in (PeerState.STOPPED,):
                self._set_state(PeerState.DISCONNECTED)
            # Forget the remote id — a reconnect to a different process
            # might surface a different id, and we'd rather rediscover
            # than carry stale state.
            self.remote_id = None

    def _safe_local_id(self) -> Optional[str]:
        """Best-effort lookup of OUR runtime id for the collision check.
        Returns None if the provider raised or wasn't supplied — better
        to skip the check (and possibly bridge a collision we'd have
        caught) than crash the inbound dispatcher. The reconnect loop
        runs through here on every frame so any error path needs to
        stay quiet."""
        if self._local_id_provider is None:
            return None
        try:
            return self._local_id_provider()
        except Exception:  # noqa: BLE001
            return None

    def _handle_inbound(self, raw: str) -> None:
        try:
            frame = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("peer %s: dropped non-JSON frame", self.url)
            return
        method = frame.get("method")
        if method == "message":
            topic = frame.get("topic")
            payload = frame.get("payload")
            # /runtime/info from the remote completes identification.
            if topic == "/runtime/info" and isinstance(payload, dict):
                remote_id = payload.get("id")
                if isinstance(remote_id, str) and remote_id != self.remote_id:
                    # Collision guard — if a peer identifies with the
                    # same runtime id as us, refuse to bridge. Otherwise
                    # ``/foo@<peer>`` topics from BOTH sides would alias
                    # to the same string, the bus topology would loop
                    # bridged messages back on itself, and every UI
                    # routing decision would silently pick whichever
                    # peer happened to register first. The reconnect
                    # loop is also halted so we don't chase the same
                    # mistake forever — operator must fix the env
                    # config (``ROBOTLAB_X_RUNTIME_ID`` / runtime_id
                    # file) and restart.
                    local_id = self._safe_local_id()
                    if local_id is not None and remote_id == local_id:
                        self.collision_detected = True
                        self.collision_detail = (
                            f"peer at {self.url} identifies as {remote_id!r}, "
                            f"matching our own runtime id — refusing to bridge"
                        )
                        logger.error("peer %s: %s", self.url, self.collision_detail)
                        self._set_state(PeerState.STOPPED)
                        self._stop_event.set()
                        return
                    self.remote_id = remote_id
                    logger.info("peer %s: identified as %s", self.url, remote_id)
                    self._set_state(PeerState.CONNECTED)
            if self._on_message is not None and isinstance(topic, str):
                try:
                    self._on_message(topic, payload, frame)
                except Exception:  # noqa: BLE001
                    logger.exception("peer %s: on_message raised topic=%s", self.url, topic)
        elif method == "ack":
            # No-op for now — tracking acks is a step-2c concern.
            pass
        elif method == "error":
            logger.warning("peer %s: error frame %s", self.url, frame.get("error"))


# ─── helpers ──────────────────────────────────────────────────────────


def _normalise_peer_url(url: str) -> str:
    """Accept either ``ws://host:port`` or ``ws://host:port/v1/ws``.
    Returns the canonical full path. ``http://`` and ``https://`` are
    rewritten to their ws-equivalents for caller convenience."""
    if url.startswith("http://"):
        url = "ws://" + url[len("http://"):]
    elif url.startswith("https://"):
        url = "wss://" + url[len("https://"):]
    if "/v1/ws" not in url:
        url = url.rstrip("/") + "/v1/ws"
    return url


def _backoff(attempt: int) -> float:
    """Exponential backoff with full jitter. Doubles each attempt;
    capped at _BACKOFF_MAX_S; minimum is _BACKOFF_MIN_S so we never
    storm with sub-100ms retries."""
    base = min(_BACKOFF_MAX_S, _BACKOFF_MIN_S * (2 ** max(0, attempt - 1)))
    return max(_BACKOFF_MIN_S, random.uniform(_BACKOFF_MIN_S, base))


def _new_frame_id() -> str:
    return uuid.uuid4().hex[:10]
