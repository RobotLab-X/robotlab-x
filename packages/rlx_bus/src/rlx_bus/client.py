"""WebSocket bus client used by robotlab_x subprocess services.

Speaks the same wire grammar as the browser UI's wsClient:

    outbound: {id, method: 'subscribe' | 'publish' | 'unsubscribe', data}
    inbound:  {method: 'message' | 'ack' | 'error' | 'topics', topic, payload, ...}

The client maintains a bounded outbound queue so publishes made while
disconnected don't drop on the floor — they're flushed on reconnect.
Subscriptions are also remembered and re-sent after a reconnect.

Auth is the ``?token=`` query param. The backend mints a long-lived JWT
at boot and passes it via ROBOTLAB_X_SUBPROCESS_TOKEN. The /v1/ws
endpoint decodes it through the same path it uses for browser user
tokens, so no server-side auth changes are needed to add subprocess
clients.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from collections import deque
from typing import Any, Awaitable, Callable, Deque, Dict, List, Optional, Tuple, Union

import websockets


logger = logging.getLogger(__name__)


# Handler signature — sync or async, return value ignored. Async handlers
# are awaited so the consume loop is single-threaded from each handler's
# perspective.
Handler = Callable[[Any], Union[None, Awaitable[None]]]

# How many publishes to hold while disconnected. Larger than typical
# transient-outage burst but small enough to bound memory under a long
# outage. Override per-instance with ``outbound_queue_size``.
_DEFAULT_OUTBOUND_QUEUE = 256


def _to_ws_url(http_url: str, token: str) -> str:
    """Turn http(s)://host:port → ws(s)://host:port/v1/ws?token=…"""
    base = http_url.rstrip("/")
    base = base.replace("http://", "ws://").replace("https://", "wss://")
    return f"{base}/v1/ws?token={token}"


class BusClient:
    """Single-connection bus client with auto-reconnect."""

    def __init__(
        self,
        backend_url: str,
        token: str,
        *,
        outbound_queue_size: int = _DEFAULT_OUTBOUND_QUEUE,
    ) -> None:
        self._url = _to_ws_url(backend_url, token)
        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._handlers: Dict[str, Handler] = {}
        self._next_id = 1
        # ``consume_forever`` exits when this is set.
        self._closed = asyncio.Event()
        self._send_lock = asyncio.Lock()
        # Outbound buffer for publishes made while disconnected. Each
        # entry is the already-constructed frame dict ready for json.dumps.
        # We use deque(maxlen=...) so oldest publishes drop on overflow —
        # newer state usually matters more, especially for retained
        # messages where the latest value supersedes the rest.
        self._outbound: Deque[dict] = deque(maxlen=outbound_queue_size)
        # Announcements: payloads published on every successful (re)connect.
        # Used for "hello here I am" discovery — runtime listens for these
        # to find subprocess services that survived its restart.
        self._announcements: List[Tuple[str, Callable[[], Any], bool]] = []
        # Set whenever a fresh connection completes + finishes
        # re-subscribing. Cleared on disconnect. Callers can ``await``
        # ``ready.wait()`` if they want to delay first publish until
        # everything is wired up.
        self.ready = asyncio.Event()
        # Per-topic subscribe-ack futures. Created when ``subscribe``
        # sends a frame, resolved when the runtime echoes back an
        # ``ack`` with the matching frame id. Lets ``subscribe`` block
        # until the runtime has REGISTERED the subscriber, defending
        # against the race where a publish from another connection
        # races past the subscribe before the server has finished
        # adding us to the subscriber set. Non-retained topics drop
        # messages in that window — exactly the symptom BusBackedSerial
        # hit (board reply published before subscribe ack landed, so
        # delivery to zero subscribers).
        self._pending_subscribe_acks: Dict[str, asyncio.Future] = {}

    # ─── lifecycle ───────────────────────────────────────────────────
    async def connect(self) -> None:
        """Open the WebSocket. Raises on failure — the caller decides
        whether to retry. ``consume_forever`` handles retries for you."""
        logger.info("rlx_bus.connect %s", self._url.split("?", 1)[0])
        self._ws = await websockets.connect(self._url, ping_interval=20, ping_timeout=20)

    async def close(self) -> None:
        ws = self._ws
        self._ws = None
        self.ready.clear()
        if ws is not None:
            try:
                await ws.close()
            except Exception:  # noqa: BLE001
                pass
        self._closed.set()

    # ─── outbound ────────────────────────────────────────────────────
    def _frame_id(self) -> str:
        self._next_id += 1
        return f"sub-{self._next_id}"

    async def _send(self, frame: dict) -> bool:
        """Send the frame if connected, else queue it. Returns True if
        actually written to the socket."""
        if self._ws is None:
            self._outbound.append(frame)
            return False
        try:
            async with self._send_lock:
                await self._ws.send(json.dumps(frame))
            return True
        except Exception:  # noqa: BLE001
            # Connection just died under us — preserve the frame.
            self._outbound.append(frame)
            return False

    async def publish(self, topic: str, payload: Any, *, retained: bool = False) -> None:
        """Publish a message. If disconnected, the frame is queued and
        flushed on the next successful connect."""
        await self._send(
            {
                "id": self._frame_id(),
                "method": "publish",
                "data": {"topic": topic, "payload": payload, "retained": retained},
            }
        )

    async def subscribe(self, topic: str, handler: Handler, *, ack_timeout: float = 4.0) -> None:
        """Register a handler + tell the server we want this topic,
        then **wait for the server's subscribe ack** before returning.

        Without the wait, ``subscribe`` would return as soon as the
        frame was queued on the WebSocket — the server might not have
        finished registering us when a publish from a different
        connection arrives. The runtime fans out non-retained
        publishes only to subscribers known at publish time; missing
        the registration window drops bytes silently. We hit this
        with BusBackedSerial where a board reply was published before
        the subscribe ack came back and the bytes never reached us.

        ``topic`` may be an exact string or an MQTT-style wildcard
        pattern (``/clock/+/tick``, ``/arduino/#``). Multiple
        subscribe calls for the same topic replace the handler. On
        reconnect the client re-subscribes to everything it knows
        about.

        ``ack_timeout`` (seconds) bounds the wait — if the runtime
        never acks, we log + proceed rather than block the caller
        forever. The handler is still registered locally; any messages
        that arrive will be delivered, the race-window is just back to
        what it was before this defence existed.
        """
        self._handlers[topic] = handler
        if self._ws is None:
            return  # will be sent on next connect / _resubscribe_all
        frame_id = self._frame_id()
        loop = asyncio.get_running_loop()
        ack_future: asyncio.Future = loop.create_future()
        self._pending_subscribe_acks[frame_id] = ack_future
        try:
            await self._send(
                {
                    "id": frame_id,
                    "method": "subscribe",
                    "data": {"topic": topic},
                }
            )
            try:
                await asyncio.wait_for(ack_future, timeout=ack_timeout)
            except asyncio.TimeoutError:
                # Server didn't echo an ack in time. Log + continue;
                # the local handler is registered so we'll get any
                # messages that do arrive (we just no longer have the
                # registration-race guarantee for the very first
                # publish that races our subscribe).
                logger.warning(
                    "rlx_bus subscribe(%s): no ack within %.1fs, continuing",
                    topic, ack_timeout,
                )
        finally:
            # Always GC the pending entry — leaving it in self._pending_subscribe_acks
            # would leak across reconnects.
            self._pending_subscribe_acks.pop(frame_id, None)

    def announce(
        self,
        topic: str,
        payload_factory: Callable[[], Any],
        *,
        retained: bool = True,
    ) -> None:
        """Register a payload to publish on every (re)connect.

        ``payload_factory`` is a callable evaluated at connect time, so
        time-sensitive fields (timestamps, current pid) reflect the
        moment of the announcement rather than client construction.
        ``retained=True`` by default — the runtime's discovery listener
        sees the latest 'hello' even if it subscribed after we published.

        Adding the same topic twice replaces the previous factory.
        """
        self._announcements = [
            (t, f, r) for (t, f, r) in self._announcements if t != topic
        ]
        self._announcements.append((topic, payload_factory, retained))

    async def _run_announcements(self) -> None:
        for topic, factory, retained in list(self._announcements):
            try:
                payload = factory()
            except Exception:  # noqa: BLE001
                logger.exception("rlx_bus announce factory for %s raised", topic)
                continue
            try:
                async with self._send_lock:
                    assert self._ws is not None
                    await self._ws.send(json.dumps({
                        "id": self._frame_id(),
                        "method": "publish",
                        "data": {"topic": topic, "payload": payload, "retained": retained},
                    }))
            except Exception:  # noqa: BLE001
                logger.exception("rlx_bus announce %s send failed", topic)

    async def _resubscribe_all(self) -> None:
        for topic in list(self._handlers.keys()):
            try:
                async with self._send_lock:
                    assert self._ws is not None
                    await self._ws.send(json.dumps({
                        "id": self._frame_id(),
                        "method": "subscribe",
                        "data": {"topic": topic},
                    }))
            except Exception:  # noqa: BLE001
                logger.exception("rlx_bus resubscribe %s failed", topic)

    async def _flush_outbound(self) -> None:
        """Drain queued publishes after a reconnect. Each frame is
        re-stamped with a fresh id so server-side correlation isn't
        confused by stale numbers."""
        if not self._outbound:
            return
        drained = list(self._outbound)
        self._outbound.clear()
        for frame in drained:
            frame = dict(frame)
            frame["id"] = self._frame_id()
            try:
                async with self._send_lock:
                    assert self._ws is not None
                    await self._ws.send(json.dumps(frame))
            except Exception:  # noqa: BLE001
                # Socket died mid-flush — requeue the rest and let the
                # next reconnect try again.
                self._outbound.append(frame)
                logger.warning("rlx_bus flush interrupted; %d frame(s) requeued", len(self._outbound))
                return

    # ─── consume loop ────────────────────────────────────────────────
    async def consume_forever(self, *, reconnect_delay: float = 2.0) -> None:
        """Read frames forever, dispatching to handlers.

        On disconnect, sleeps ``reconnect_delay`` then re-opens,
        re-subscribes, and flushes the outbound queue. Returns only
        after ``close()`` is called.
        """
        while not self._closed.is_set():
            try:
                if self._ws is None:
                    await self.connect()
                    await self._resubscribe_all()
                    await self._flush_outbound()
                    await self._run_announcements()
                    self.ready.set()
                assert self._ws is not None
                async for raw in self._ws:
                    await self._on_frame(raw)
                # async for exits cleanly on remote close → reconnect.
            except websockets.exceptions.ConnectionClosed as exc:
                logger.info("rlx_bus connection closed: %s", exc)
            except Exception:  # noqa: BLE001
                logger.exception("rlx_bus error; will reconnect")
            finally:
                self.ready.clear()
                if self._ws is not None:
                    try:
                        await self._ws.close()
                    except Exception:  # noqa: BLE001
                        pass
                    self._ws = None
            if self._closed.is_set():
                break
            await asyncio.sleep(reconnect_delay)

    async def _on_frame(self, raw: Union[str, bytes]) -> None:
        try:
            frame = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("rlx_bus got non-JSON frame: %r", raw[:120])
            return
        method = frame.get("method")
        if method == "error":
            logger.warning("rlx_bus server error: %s", frame.get("error"))
            return
        if method == "ack":
            # Resolve any pending subscribe ack so awaiters in
            # ``subscribe()`` proceed. We key on frame id (server
            # echoes the client-supplied id). Publishes also produce
            # acks but no one waits on them yet.
            fid = frame.get("id")
            fut = self._pending_subscribe_acks.pop(fid, None) if fid is not None else None
            if fut is not None and not fut.done():
                fut.set_result(True)
            return
        if method != "message":
            return  # 'topics': nothing to dispatch
        topic = frame.get("topic")
        if topic is None:
            return
        handler = self._handlers.get(topic)
        # Wildcard subscribers receive 'message' frames with the CONCRETE
        # topic that matched their pattern. Walk our handler keys to find
        # a matching pattern if no exact handler exists.
        if handler is None:
            for pattern, h in self._handlers.items():
                if _topic_matches_pattern(topic, pattern):
                    handler = h
                    break
        if handler is None:
            return
        try:
            result = handler(frame.get("payload"))
            if asyncio.iscoroutine(result):
                # Spawn the coroutine handler as its own task — don't
                # ``await`` it inline. Awaiting would block this
                # consume loop until the handler finishes, preventing
                # every other inbound frame (including subscribe-acks
                # and the handler's OWN future-resolving messages)
                # from being processed. We hit this exact deadlock:
                # arduino's m_connect (an async @service_method
                # handler) awaits pymata4 internally and that path
                # tries to subscribe to /serial/<id>/rx — but the
                # subscribe-ack arrives over the same WS, queued
                # behind the still-running m_connect. With this fix
                # the handler runs concurrently and ack frames flow
                # in real time.
                asyncio.create_task(
                    _run_handler_safely(result, topic),
                    name=f"rlx_bus_handler:{topic}",
                )
        except Exception:  # noqa: BLE001
            logger.exception("rlx_bus handler for %s raised", topic)


async def _run_handler_safely(coro: Any, topic: str) -> None:
    """Run a coroutine handler in its own task. Catches + logs
    exceptions so the consume loop doesn't unwind on a buggy
    handler. Module-scope (not a method) so create_task's
    ``name=`` shows the topic without coupling to BusClient
    internals.
    """
    try:
        await coro
    except Exception:  # noqa: BLE001
        logger.exception("rlx_bus handler for %s raised", topic)


def _topic_matches_pattern(topic: str, pattern: str) -> bool:
    """MQTT-style topic match — mirrors runtime/bus.py's matcher so the
    client side can route incoming 'message' frames to wildcard handlers
    without a round-trip."""
    if "+" not in pattern and not pattern.endswith("#") and "/#/" not in pattern:
        return topic == pattern
    p_segs = pattern.split("/")
    t_segs = topic.split("/")
    if any(s == "#" for s in p_segs[:-1]):
        return False
    for i, ps in enumerate(p_segs):
        if ps == "#":
            return True
        if i >= len(t_segs):
            return False
        if ps == "+":
            continue
        if ps != t_segs[i]:
            return False
    return len(p_segs) == len(t_segs)


def from_env() -> Optional[BusClient]:
    """Construct a client from the env vars process_manager injects.

    Returns None when the env isn't present — typically because the
    subprocess wasn't launched by the backend (e.g. local dev runs).
    """
    token = os.environ.get("ROBOTLAB_X_SUBPROCESS_TOKEN")
    backend = os.environ.get("ROBOTLAB_X_BACKEND_URL")
    if not token or not backend:
        print(
            "[rlx_bus] missing ROBOTLAB_X_SUBPROCESS_TOKEN / ROBOTLAB_X_BACKEND_URL "
            "— subprocess has no bus access",
            file=sys.stderr,
        )
        return None
    return BusClient(backend, token)
