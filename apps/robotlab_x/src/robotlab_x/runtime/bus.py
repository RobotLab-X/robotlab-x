# unmanaged
"""In-process asyncio pub/sub bus for RobotLab-X.

The bus is the load-bearing primitive every later phase rides on: lifecycle
events, log streaming, telemetry, install progress, workspace activation.
Keeping it small, side-effect-free, and well-defined matters more than
features here. The WebSocket endpoint extends the bus to non-backend
processes (browser UIs, subprocess services via rlx_bus).

Frame routing: topic names are opaque strings. Convention (documented in
ROBOTLAB_X_IMP.md §4.1) prefixes namespaces with a slash, e.g.
``/service_proxy/{id}/lifecycle`` or ``/workspace/{id}/activate``. The
bus does not parse or validate topic strings.

Backpressure: every subscriber gets its own bounded ``asyncio.Queue``.
On a full queue we drop the *oldest* message (consumer fell behind, not
publisher), increment a counter, and emit one ``bus.slow_consumer`` log
line per subscriber per 1 second window. We never drop the publish call
itself.
"""

from __future__ import annotations

import asyncio
import logging
import re
import threading
import time
from dataclasses import dataclass
from typing import Any, AsyncIterator, Dict, List, Optional, Set


logger = logging.getLogger(__name__)

# Default per-subscriber queue depth. Tuned for telemetry-style payloads,
# not large images. Override via Bus(queue_depth=...).
_DEFAULT_QUEUE_DEPTH = 128

# Minimum seconds between repeated slow_consumer warnings for the same
# subscriber — prevents log spam when a consumer is sustained-slow.
_SLOW_LOG_THROTTLE_SECONDS = 1.0


@dataclass
class BusMessage:
    """One envelope on the bus.

    Mirrors the shape of the ``message`` model in robotlab_x.yml so that
    WebSocket frames, internal events, and persisted history all share a
    single structure.
    """

    topic: str
    payload: Any
    method: Optional[str] = None
    reply_to: Optional[str] = None
    sender_id: Optional[str] = None
    timestamp: float = 0.0


class _Subscriber:
    """Per-subscription bookkeeping. One queue, one slow-log throttle.

    Loop-affinity matters here: in-process services run on their own
    thread + asyncio loop (see ``InProcessAdapter._thread_main``). The
    queue is bound to the consumer's loop when ``subscribe()`` first
    enters its consume loop. ``deliver()`` may be called from ANY loop
    (the WS endpoint runs on the main loop; subscriber consumers on
    their own per-service loops). asyncio.Queue is not safe across
    loops/threads, so we route every delivery through
    ``loop.call_soon_threadsafe`` once the consumer loop has been
    captured. Before that capture, fall back to a direct put_nowait —
    only retained-message replay during subscribe-setup hits this
    path, and that happens on the consumer's own loop.
    """

    __slots__ = ("topic", "queue", "subscriber_id", "dropped",
                 "_last_slow_log", "_consumer_loop")

    def __init__(self, topic: str, subscriber_id: str, queue_depth: int):
        self.topic = topic
        self.subscriber_id = subscriber_id
        self.queue: asyncio.Queue[BusMessage] = asyncio.Queue(maxsize=queue_depth)
        # Public so introspection (Bus.dropped_count, list_topics) can read it.
        self.dropped = 0
        self._last_slow_log = 0.0
        # Bound by ``Bus.subscribe`` when the consumer enters its loop.
        self._consumer_loop: Optional[asyncio.AbstractEventLoop] = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Called once from the consumer's coroutine so cross-loop
        deliveries route through ``call_soon_threadsafe``."""
        self._consumer_loop = loop

    def _enqueue(self, message: BusMessage) -> None:
        """Actual put on the queue. MUST run on the consumer's loop."""
        if self.queue.full():
            try:
                self.queue.get_nowait()
            except asyncio.QueueEmpty:  # pragma: no cover — concurrent drain
                pass
            self.dropped += 1
            now = time.monotonic()
            if now - self._last_slow_log >= _SLOW_LOG_THROTTLE_SECONDS:
                logger.warning(
                    "bus.slow_consumer subscriber=%s topic=%s dropped=%d",
                    self.subscriber_id,
                    self.topic,
                    self.dropped,
                )
                self._last_slow_log = now
        try:
            self.queue.put_nowait(message)
        except asyncio.QueueFull:  # pragma: no cover — drained above
            pass

    def deliver(self, message: BusMessage) -> None:
        """Non-blocking deliver, loop-safe across services.

        Hot-path branch: if the consumer's loop has been bound AND we
        are NOT currently running on it, hop via ``call_soon_threadsafe``.
        Otherwise enqueue directly (same loop, or pre-bind retained
        replay path).

        ``_enqueue`` performs the put_nowait + overflow drop-oldest;
        do NOT add another put after it. An earlier revision had a
        trailing ``self.queue.put_nowait(message)`` here that
        duplicated every same-loop delivery (cross-loop went through
        call_soon_threadsafe and dodged it). That manifested as the
        chat panel rendering each operator turn twice — same WS
        endpoint loop pub + sub fell into the same-loop branch.
        """
        loop = self._consumer_loop
        if loop is not None:
            try:
                current = asyncio.get_running_loop()
            except RuntimeError:
                current = None
            if current is not loop:
                loop.call_soon_threadsafe(self._enqueue, message)
                return
        self._enqueue(message)


def is_wildcard_pattern(pattern: str) -> bool:
    """True if ``pattern`` contains MQTT-style wildcards.

    Pure exact-match topics take a fast path on subscribe; wildcards
    register into the slower _wildcard_subscribers bucket.
    """
    return "+" in pattern or pattern.endswith("#") or "/#/" in pattern


def topic_matches_pattern(topic: str, pattern: str) -> bool:
    """MQTT-style topic match.

    * ``+`` matches exactly one segment (no '/').
    * ``#`` matches zero or more trailing segments. Must be the LAST
      segment of the pattern; ``a/#/b`` is malformed and never matches.
    * Exact strings match themselves.

    Both ``topic`` and ``pattern`` are split on '/'. Empty leading
    segments (from leading slashes) participate — ``/a/b`` has segments
    ``['', 'a', 'b']``, which is fine as long as both sides agree.
    """
    if not is_wildcard_pattern(pattern):
        return topic == pattern
    p_segs = pattern.split("/")
    t_segs = topic.split("/")
    # '#' must be the last segment if present anywhere; if not last, no match.
    if any(s == "#" for s in p_segs[:-1]):
        return False
    for i, ps in enumerate(p_segs):
        if ps == "#":
            return True  # matches everything from here
        if i >= len(t_segs):
            return False
        if ps == "+":
            continue
        if ps != t_segs[i]:
            return False
    # Same length, all segments matched
    return len(p_segs) == len(t_segs)


# ─────────────────────────────────────────────────────────────────────
# Federation address parsing — ``/topic@<runtime-id>`` suffix grammar.
# ─────────────────────────────────────────────────────────────────────

# Same shape as runtime/identity.is_valid_id, duplicated here so the bus
# stays self-contained (avoids an import cycle between bus + identity).
_ID_SUFFIX = re.compile(r"^[a-z][a-z0-9-]{1,62}$")


def parse_id_suffix(topic: str) -> tuple[str, Optional[str]]:
    """Split a topic into ``(local_topic, peer_id_or_None)``.

    ``/foo/bar@silly-droid`` → ``('/foo/bar', 'silly-droid')``
    ``/foo/bar``             → ``('/foo/bar', None)``
    ``/foo@BAD ID``          → ``('/foo@BAD ID', None)`` (suffix rejected
                                                          — bad format)

    Uses ``rpartition`` so any embedded ``@`` left of the final suffix
    is untouched. The id format rule (``[a-z][a-z0-9-]{1,62}``) keeps
    the parser unambiguous — no normal topic chars can pass as an id.
    """
    if not isinstance(topic, str) or "@" not in topic:
        return topic, None
    base, sep, suffix = topic.rpartition("@")
    if not sep or not _ID_SUFFIX.match(suffix):
        return topic, None
    return base, suffix


# ─── peer_manager bridge — lazy imports avoid the bus⇄peer cycle ─────


def _route_remote_publish(
    peer_id: str,
    base_topic: str,
    payload: Any,
    *,
    method: Optional[str],
    reply_to: Optional[str],
    sender_id: Optional[str],
    retained: bool,
) -> int:
    """Bus → peer_manager glue for outbound publishes. Returns 0 when
    no peer is connected so callers see "delivered to nobody" instead
    of a silent black hole."""
    try:
        from robotlab_x.runtime import peer_manager
    except ImportError:
        return 0
    return peer_manager.publish_remote(
        peer_id, base_topic, payload,
        method=method, reply_to=reply_to,
        sender_id=sender_id, retained=retained,
    )


def _notify_remote_subscribe(peer_id: str, base_topic: str, local_topic: str) -> None:
    """First local subscriber on ``local_topic`` (suffix form) — ask
    the peer manager to open the upstream subscription so messages
    start flowing back."""
    try:
        from robotlab_x.runtime import peer_manager
    except ImportError:
        return
    try:
        peer_manager.on_local_subscribe(peer_id, base_topic, local_topic)
    except Exception:  # noqa: BLE001
        logger.exception("peer_manager.on_local_subscribe raised")


def _notify_remote_unsubscribe(peer_id: str, base_topic: str, local_topic: str) -> None:
    """Last local subscriber on ``local_topic`` gone — peer manager
    can drop the upstream subscription. Fire-and-forget; failures
    log but don't propagate."""
    try:
        from robotlab_x.runtime import peer_manager
    except ImportError:
        return
    try:
        peer_manager.on_local_unsubscribe(peer_id, base_topic, local_topic)
    except Exception:  # noqa: BLE001
        logger.exception("peer_manager.on_local_unsubscribe raised")


class Bus:
    """In-process pub/sub.

    Topics are strings. Subscribers are anonymous to the publisher; the bus
    holds them by ``subscriber_id`` only so we can unsubscribe and so
    slow-consumer logs are attributable.

    Retained messages: ``retained=True`` on publish stores the message as
    the topic's *retained* value. Any future subscriber to that topic
    receives the retained message immediately. Replaces any prior retained
    value for the same topic. ``clear_retained(topic)`` drops it.
    """

    def __init__(self, queue_depth: int = _DEFAULT_QUEUE_DEPTH):
        self._queue_depth = queue_depth
        # Exact-topic subscribers — fast O(1) lookup on publish.
        self._subscribers: Dict[str, Set[_Subscriber]] = {}
        # Wildcard pattern subscribers (containing '+' or terminal '#').
        # Publishers iterate these and run topic_matches_pattern() per pattern.
        # We never have many patterns at once — linear scan is fine until
        # subscriber counts get into the hundreds.
        self._wildcard_subscribers: Dict[str, Set[_Subscriber]] = {}
        self._retained: Dict[str, BusMessage] = {}
        # threading.Lock instead of asyncio.Lock so the bus is safely
        # callable from either coroutines or sync FastAPI handlers (which
        # run in a worker thread). Critical sections are microseconds —
        # no yielding required.
        self._lock = threading.Lock()
        # Federation — this runtime's id, set once at boot by
        # event_handlers.on_startup. ``None`` means "federation not yet
        # initialised" and publishes with ``@<id>`` suffixes won't be
        # routed — they just deliver to whatever local subscriber listens
        # on the literal suffixed string. Once set, the bus strips its
        # own id on publish/subscribe and routes non-self ids through
        # the peer_manager.
        self._local_id: Optional[str] = None
        # Per-topic cumulative publish counter. Read by the bus-stats
        # digest to derive a publish RATE over a window (the Composer's
        # live-flow overlay). Incremented on the single publish chokepoint
        # below; the GIL makes the ``+=`` on an int atomic enough that we
        # don't take the lock just to count.
        self._publish_counts: Dict[str, int] = {}

    def publish_counts(self) -> Dict[str, int]:
        """Snapshot of cumulative publish counts per topic. The digest
        diffs successive snapshots to compute a rate."""
        return dict(self._publish_counts)

    def set_local_id(self, runtime_id: str) -> None:
        """Inform the bus of this runtime's id. Called once at boot
        from on_startup. Subsequent ``@<runtime_id>`` suffixes on
        publish/subscribe are recognised as 'self' and stripped; other
        suffixes route through the peer manager."""
        self._local_id = runtime_id

    def publish_local_only(
        self,
        topic: str,
        payload: Any,
        *,
        method: Optional[str] = None,
        reply_to: Optional[str] = None,
        sender_id: Optional[str] = None,
        retained: bool = False,
    ) -> int:
        """Publish a message to LOCAL subscribers only, bypassing the
        federation router.

        Used exclusively by the peer manager when an inbound peer
        message must land on the local bus under its ``/foo@<peer_id>``
        address — the normal publish path would see the suffix and
        bounce it right back to the peer, causing an infinite ping-pong.
        Caller is responsible for passing a fully-qualified topic
        (suffix already attached when appropriate).
        """
        message = BusMessage(
            topic=topic, payload=payload, method=method,
            reply_to=reply_to, sender_id=sender_id,
            timestamp=time.time(),
        )
        if retained:
            self._retained[topic] = message
        with self._lock:
            subs = list(self._subscribers.get(topic, ()))
            for pattern, bucket in self._wildcard_subscribers.items():
                if topic_matches_pattern(topic, pattern):
                    subs.extend(bucket)
        for sub in subs:
            sub.deliver(message)
        return len(subs)

    # ─── publish ─────────────────────────────────────────────────────────

    def publish_sync(
        self,
        topic: str,
        payload: Any,
        *,
        method: Optional[str] = None,
        reply_to: Optional[str] = None,
        sender_id: Optional[str] = None,
        retained: bool = False,
    ) -> int:
        """Synchronous fan-out — callable from FastAPI sync routes.

        Equivalent to ``publish`` but doesn't require an event loop.
        ``_Subscriber.deliver`` is itself synchronous (just a non-blocking
        queue put + drop-oldest), so the whole publish path is free of
        awaitables.

        Federation: a ``@<runtime-id>`` suffix routes the publish:
          * matching this runtime's id → suffix stripped, delivered locally
          * matching a known peer       → handed to peer_manager.publish_remote
          * unknown/no peer manager     → returns 0 (no delivery)
        """
        # Federation routing — parse the suffix once before the
        # retained-write so retained payloads land on the canonical
        # (stripped) local topic.
        base, peer_id = parse_id_suffix(topic)
        if peer_id is not None:
            if peer_id == self._local_id:
                topic = base   # self-id: strip and treat as local
            else:
                # Route to peer manager. Returns the count it claims to
                # have delivered (typically 1 = "queued for forwarding")
                # or 0 if no peer is connected.
                return _route_remote_publish(
                    peer_id, base, payload,
                    method=method, reply_to=reply_to,
                    sender_id=sender_id, retained=retained,
                )

        message = BusMessage(
            topic=topic,
            payload=payload,
            method=method,
            reply_to=reply_to,
            sender_id=sender_id,
            timestamp=time.time(),
        )
        if retained:
            self._retained[topic] = message

        # Count the publish for the rate digest (post-federation-routing,
        # so only locally-delivered topics are counted).
        self._publish_counts[topic] = self._publish_counts.get(topic, 0) + 1

        with self._lock:
            subs = list(self._subscribers.get(topic, ()))
            # Wildcard fan-out — small N, linear scan is fine.
            for pattern, bucket in self._wildcard_subscribers.items():
                if topic_matches_pattern(topic, pattern):
                    subs.extend(bucket)

        for sub in subs:
            sub.deliver(message)
        return len(subs)

    async def publish(
        self,
        topic: str,
        payload: Any,
        *,
        method: Optional[str] = None,
        reply_to: Optional[str] = None,
        sender_id: Optional[str] = None,
        retained: bool = False,
    ) -> int:
        """Async-flavoured publish.

        Backward-compatible alias for ``publish_sync`` — kept ``async``
        because the WS endpoint awaits it. The work is identical.
        """
        return self.publish_sync(
            topic,
            payload,
            method=method,
            reply_to=reply_to,
            sender_id=sender_id,
            retained=retained,
        )

    def clear_retained(self, topic: str) -> None:
        self._retained.pop(topic, None)

    # ─── subscribe ───────────────────────────────────────────────────────

    async def subscribe(
        self, topic: str, subscriber_id: str
    ) -> AsyncIterator[BusMessage]:
        """Async iterator over messages on ``topic`` for ``subscriber_id``.

        ``topic`` may be a literal string OR an MQTT-style pattern using
        ``+`` (single segment) and trailing ``#`` (multi-segment). The
        retained message(s) matching the pattern are yielded first. The
        iterator terminates only when ``unsubscribe`` is called or the
        consuming task is cancelled.

        Federation: ``/foo@<peer-id>`` is the address of a remote
        topic. Self-id strips trivially. Peer-id keeps the suffixed
        form as the LOCAL subscription topic — the peer bridge
        forwards remote ``/foo`` messages here by re-publishing them
        to ``/foo@<peer-id>`` locally. We also notify the peer manager
        on subscribe so it can open the upstream subscription lazily.
        """
        base, peer_id = parse_id_suffix(topic)
        if peer_id is not None and peer_id == self._local_id:
            topic = base   # self-id: strip and subscribe locally
        # Note: when peer_id matches a remote runtime we KEEP the
        # suffixed topic so local consumers see remote messages on the
        # natural ``/foo@silly-droid`` address. The peer bridge handles
        # opening the upstream subscription + forwarding.
        sub = _Subscriber(topic, subscriber_id, self._queue_depth)
        # Capture the consumer's loop NOW — before registration, before
        # any deliver() call from another loop can race in. From this
        # point on, cross-loop delivers route via call_soon_threadsafe.
        sub.bind_loop(asyncio.get_running_loop())
        wildcard = is_wildcard_pattern(topic)
        with self._lock:
            registry = self._wildcard_subscribers if wildcard else self._subscribers
            existed_before = topic in registry and bool(registry[topic])
            registry.setdefault(topic, set()).add(sub)
        # Federation hook: if this is the first local subscriber on a
        # peer-suffixed topic, ask the peer manager to open the upstream
        # subscription. Fired OUTSIDE the lock so the manager's own
        # network I/O can't deadlock back into us.
        sub_peer_base, sub_peer_id = parse_id_suffix(topic)
        if sub_peer_id is not None and sub_peer_id != self._local_id and not existed_before:
            _notify_remote_subscribe(sub_peer_id, sub_peer_base, topic)

        # Retained replay. Exact topics get O(1); wildcard subs scan the
        # retained map. Replay only happens at subscribe time — small
        # cost relative to staying subscribed.
        if wildcard:
            for stored_topic, retained_msg in list(self._retained.items()):
                if topic_matches_pattern(stored_topic, topic):
                    sub.deliver(retained_msg)
        else:
            retained = self._retained.get(topic)
            if retained is not None:
                sub.deliver(retained)

        try:
            while True:
                message = await sub.queue.get()
                yield message
        finally:
            with self._lock:
                bucket = (self._wildcard_subscribers if wildcard else self._subscribers).get(topic)
                empty_after = False
                if bucket is not None:
                    bucket.discard(sub)
                    if not bucket:
                        (self._wildcard_subscribers if wildcard else self._subscribers).pop(topic, None)
                        empty_after = True
            # Federation hook: last local subscriber gone → close the
            # upstream subscription to stop the firehose. Same outside-
            # the-lock discipline as the open path.
            if (
                empty_after and sub_peer_id is not None
                and sub_peer_id != self._local_id
            ):
                _notify_remote_unsubscribe(sub_peer_id, sub_peer_base, topic)

    async def unsubscribe_all(self, subscriber_id: str) -> int:
        """Drop every subscription (exact + wildcard) owned by ``subscriber_id``.

        Used on WebSocket disconnect to garbage-collect a client that
        held many subscriptions.
        """
        removed = 0
        with self._lock:
            for registry in (self._subscribers, self._wildcard_subscribers):
                for topic, bucket in list(registry.items()):
                    stale = {s for s in bucket if s.subscriber_id == subscriber_id}
                    if not stale:
                        continue
                    for s in stale:
                        bucket.discard(s)
                        # Wake the awaiting consumer so its `finally` cleanup runs.
                        try:
                            s.queue.put_nowait(_TERMINATE)  # type: ignore[arg-type]
                        except asyncio.QueueFull:
                            pass
                        removed += 1
                    if not bucket:
                        registry.pop(topic, None)
        return removed

    # ─── introspection ───────────────────────────────────────────────────

    def topics(self) -> Set[str]:
        return set(self._subscribers.keys()) | set(self._retained.keys())

    def patterns(self) -> Set[str]:
        """Currently-registered wildcard patterns (separate from exact topics)."""
        return set(self._wildcard_subscribers.keys())

    def subscriber_count(self, topic: str) -> int:
        """Direct subscribers to an exact topic. Wildcard matches are
        counted under their pattern via ``pattern_subscriber_count``."""
        exact = len(self._subscribers.get(topic, ()))
        wildcard = sum(
            len(b) for p, b in self._wildcard_subscribers.items()
            if topic_matches_pattern(topic, p)
        )
        return exact + wildcard

    def dropped_count(self, topic: str) -> int:
        """Sum of dropped messages across every subscriber of ``topic`` —
        wildcard patterns that match ``topic`` are included so a slow
        consumer shows up under the topic it's eating."""
        total = 0
        for sub in self._subscribers.get(topic, ()):
            total += sub.dropped
        for pattern, bucket in self._wildcard_subscribers.items():
            if topic_matches_pattern(topic, pattern):
                for sub in bucket:
                    total += sub.dropped
        return total

    def has_retained(self, topic: str) -> bool:
        return topic in self._retained

    def subscribers(self, topic: str) -> List[Dict[str, Any]]:
        """Identity of every subscriber on ``topic``, including wildcard
        matches. Returns a list of ``{id, kind, ...}`` dicts where
        ``id`` is the raw ``subscriber_id`` and the remaining fields are
        derived by parsing it via ``parse_subscriber_id``.

        Used by Layer-3 introspection so the Traffic page (and any
        downstream tooling) can say *who* is listening, not just how
        many. Wildcard subscribers carry their pattern in
        ``matched_via`` so the UI can distinguish exact subscriptions
        from incidental fan-out.
        """
        out: List[Dict[str, Any]] = []
        seen: set[int] = set()  # de-dup by _Subscriber identity
        with self._lock:
            for sub in self._subscribers.get(topic, ()):
                if id(sub) in seen:
                    continue
                seen.add(id(sub))
                out.append({**parse_subscriber_id(sub.subscriber_id),
                            "id": sub.subscriber_id,
                            "matched_via": "exact"})
            for pattern, bucket in self._wildcard_subscribers.items():
                if not topic_matches_pattern(topic, pattern):
                    continue
                for sub in bucket:
                    if id(sub) in seen:
                        continue
                    seen.add(id(sub))
                    out.append({**parse_subscriber_id(sub.subscriber_id),
                                "id": sub.subscriber_id,
                                "matched_via": pattern})
        return out

    def list_topics_detail(self) -> List[Dict[str, Any]]:
        """One-shot introspection — every active topic with full
        subscriber identity. Single pass under the lock so the snapshot
        is internally consistent (subscriber counts agree with the list
        contents). Used by the WS list_topics handler and the new
        ``/v1/bus/topics`` REST endpoint."""
        names = sorted(self.topics())
        return [
            {
                "name": t,
                "subscriber_count": self.subscriber_count(t),
                "retained": self.has_retained(t),
                "dropped": self.dropped_count(t),
                "subscribers": self.subscribers(t),
            }
            for t in names
        ]


def parse_subscriber_id(sid: str) -> Dict[str, Any]:
    """Decode a subscriber_id into structured metadata.

    Three conventions exist today and a fourth (anonymous/unparseable)
    is the fallback. Keep this in sync with ``Service.subscribe_iter``
    (services), ``ws_endpoint`` (browser + subprocess WS sessions), and
    any direct ``bus.subscribe`` callers.

      * ``<type>-<proxy_id>-<suffix>``     — in-process / subprocess Service
        e.g. ``servo-servo-1-control`` → kind=service, type=servo,
        proxy_id=servo-1, suffix=control
      * ``<email>#<short_uuid>``           — browser WS session
        e.g. ``admin@cloudseeder.ai#cd14a3b6`` → kind=ui, user=...
      * ``subprocess#<short_uuid>``        — subprocess service WS session
        e.g. ``subprocess#959a598e`` → kind=subprocess

    The disambiguator between case 1 and case 2 is the ``#`` separator;
    the disambiguator between case 2 and case 3 is the literal token
    ``subprocess`` to the left of ``#``. Anything that fits no pattern
    is returned as ``kind=other``.
    """
    if not isinstance(sid, str) or not sid:
        return {"kind": "other"}
    if "#" in sid:
        left, _, short = sid.partition("#")
        if left == "subprocess":
            return {"kind": "subprocess", "session": short}
        return {"kind": "ui", "user": left, "session": short}
    # Service convention: <type>-<proxy_id>-<suffix>. The proxy_id can
    # itself contain hyphens (e.g. servo-1, arduino-7). The suffix is
    # always one of state|control|hello|config_state|… — a single token,
    # no hyphens. So split from the RIGHT once for suffix, then again
    # for type. Everything in the middle is the proxy_id.
    if "-" in sid:
        head, _, suffix = sid.rpartition("-")
        if "-" in head:
            type_name, _, proxy_id = head.partition("-")
            if type_name and proxy_id and suffix:
                return {
                    "kind": "service",
                    "type": type_name,
                    "proxy_id": proxy_id,
                    "suffix": suffix,
                }
    return {"kind": "other"}


# Sentinel pushed into subscriber queues to make ``unsubscribe_all`` wake the
# consumer task immediately. Consumers should treat it as end-of-stream.
_TERMINATE = BusMessage(topic="__terminate__", payload=None)


# ─── module-level singleton ──────────────────────────────────────────────
# Most call sites want one shared bus per process. Tests construct their
# own ``Bus()`` instance instead of touching the singleton.

_default_bus: Optional[Bus] = None


def get_bus() -> Bus:
    global _default_bus
    if _default_bus is None:
        _default_bus = Bus()
    return _default_bus
