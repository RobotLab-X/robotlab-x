# unmanaged
"""Peer manager — federation bridge between local bus and remote runtimes.

This is the active glue between the bus suffix parser (step 2a) and
PeerConnection (step 2b). Lifecycle:

  * ``connect(url)`` — start a PeerConnection. Initially the peer's id
    is unknown; once the connection's identify phase completes, the
    peer is keyed by its remote runtime id and any pending local
    subscriptions on ``@<id>`` topics are replayed upstream.
  * ``disconnect(peer_id)`` — stop a connection.
  * ``publish_remote / on_local_subscribe / on_local_unsubscribe`` —
    callbacks the bus invokes via runtime.bus when it sees suffixed
    topics. These dispatch to the right PeerConnection or queue if
    the peer isn't connected yet.

Bridge direction: inbound. When the upstream peer pushes ``/foo`` (in
response to our subscribe_upstream call), the PeerConnection's
``on_message`` fires, and we republish ``/foo@<peer_id>`` LOCAL-only
via ``bus.publish_local_only`` — local subscribers on the suffixed
topic receive it without triggering another remote routing pass.

Bridge direction: outbound. Local code publishes to ``/foo@<peer_id>``;
bus's ``publish_sync`` recognises the non-self suffix, strips it, and
hands ``(peer_id, "/foo", payload, …)`` to ``publish_remote``. We
forward via the PeerConnection's ``publish_upstream``.

Loop affinity note: the manager runs on the FastAPI / main loop where
``event_handlers.on_startup`` resolves it. Local consumers may sit on
different per-service loops; ``Bus.publish_local_only`` uses the same
loop-safe delivery path the rest of the bus does (``_Subscriber.deliver``
hops via ``call_soon_threadsafe`` when needed). No extra plumbing.
"""
from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any, Dict, Optional, Set

from robotlab_x.runtime.bus import get_bus
from robotlab_x.runtime.peer_connection import PeerConnection, PeerState


logger = logging.getLogger(__name__)


# Module-level singleton — like Bus, there's exactly one peer manager
# per runtime process. State guarded by ``_lock`` because callers come
# from any loop: bus-side hooks run on the publisher's loop, manager
# control API runs on whatever loop the caller is on.
_peers_by_id: Dict[str, PeerConnection] = {}
_peers_by_url: Dict[str, PeerConnection] = {}
# Subscriptions the bus told us about before the peer was connected.
# Replayed when the peer transitions to CONNECTED.
_pending_subs: Dict[str, Set[str]] = {}     # peer_id (or url-key) → set of base topics
_lock = threading.Lock()


def _token_provider() -> str:
    """Subprocess JWT — Option A authentication. Both runtimes must
    share JWT_SECRET_KEY for this to validate on the remote side."""
    from robotlab_x.runtime.subprocess_auth import get_subprocess_token
    return get_subprocess_token()


def connect(url: str) -> PeerConnection:
    """Open (or look up) a PeerConnection to ``url``. Idempotent —
    repeat calls with the same URL return the existing connection.

    The remote id is unknown at this point. Once the peer's identify
    phase completes (``on_state_change`` fires with state=CONNECTED),
    we slot the connection into ``_peers_by_id`` and replay any
    subscriptions queued under either the url-key or the id-key.
    """
    from robotlab_x.runtime.peer_connection import _normalise_peer_url
    url = _normalise_peer_url(url)
    with _lock:
        existing = _peers_by_url.get(url)
        if existing is not None:
            return existing
    # Build the PeerConnection with a per-peer message closure so the
    # inbound dispatch knows which peer the frame came from without
    # changing PeerConnection's callback signature (it stays generic
    # for any future caller that doesn't care).
    pc_holder: list[Optional[PeerConnection]] = [None]
    def _msg_callback(topic: str, payload: Any, frame: Dict[str, Any]) -> None:
        pc = pc_holder[0]
        if pc is not None:
            _bridge_inbound(pc, topic, payload, frame)
    # Local-id provider — lazy so identity has time to resolve. Used
    # by the PeerConnection to detect the case where a remote peer
    # announces itself with our own runtime id (a misconfig that
    # otherwise silently breaks the @peer addressing scheme).
    from robotlab_x.runtime.identity import get_runtime_id

    def _local_id() -> str:
        return get_runtime_id()

    pc = PeerConnection(
        url=url,
        token_provider=_token_provider,
        on_state_change=_on_peer_state_change,
        on_message=_msg_callback,
        local_id_provider=_local_id,
    )
    pc_holder[0] = pc
    with _lock:
        _peers_by_url[url] = pc
    pc.start()
    logger.info("peer_manager: connecting to %s", url)
    return pc


async def disconnect(peer_id_or_url: str) -> None:
    """Stop a connection identified by either remote id or original URL."""
    with _lock:
        pc = _peers_by_id.get(peer_id_or_url) or _peers_by_url.get(peer_id_or_url)
        if pc is None:
            return
        # Remove from both indexes so a re-connect can replace cleanly.
        _peers_by_id.pop(pc.remote_id or "", None)
        for u, p in list(_peers_by_url.items()):
            if p is pc:
                _peers_by_url.pop(u, None)
    await pc.stop()
    logger.info("peer_manager: disconnected %s", peer_id_or_url)


def peers() -> Dict[str, Dict[str, Any]]:
    """Snapshot of all known peers. Used by the topology API to render
    a peers panel. Returns {peer_id_or_url: {state, url, remote_id,
    upstream_subs, collision}}."""
    out: Dict[str, Dict[str, Any]] = {}
    with _lock:
        for url, pc in _peers_by_url.items():
            key = pc.remote_id or f"@{url}"
            entry: Dict[str, Any] = {
                "url": pc.url,
                "remote_id": pc.remote_id,
                "state": pc.state.value,
                "upstream_subs": sorted(pc._upstream_subscriptions),
            }
            if pc.collision_detected:
                entry["collision"] = pc.collision_detail or "runtime id collision with self"
            out[key] = entry
    return out


# ─── bus callbacks ────────────────────────────────────────────────────


def publish_remote(
    peer_id: str,
    topic: str,
    payload: Any,
    *,
    method: Optional[str] = None,
    reply_to: Optional[str] = None,
    sender_id: Optional[str] = None,
    retained: bool = False,
) -> int:
    """Outbound publish bus → peer. Returns 1 if queued onto the wire,
    0 if no peer connected (caller treats this as 'delivered to nobody')."""
    pc = _resolve_peer(peer_id)
    if pc is None or not pc.is_connected:
        logger.debug(
            "peer_manager.publish_remote: no connected peer for %s (topic=%s) — dropped",
            peer_id, topic,
        )
        return 0
    # publish_upstream is async. We're called from sync bus.publish_sync
    # which may be on any loop. Schedule the send on the peer's loop
    # via call_soon_threadsafe so we don't block, and don't care about
    # the return — the bus contract is best-effort.
    _schedule_send(pc.publish_upstream(topic, payload, retained=retained))
    return 1


def on_local_subscribe(peer_id: str, base_topic: str, local_topic: str) -> None:
    """Fire-and-forget: open the upstream subscription if we have a
    connected peer; otherwise queue + replay on next CONNECTED."""
    pc = _resolve_peer(peer_id)
    if pc is not None and pc.is_connected:
        _schedule_send(pc.subscribe_upstream(base_topic))
    else:
        with _lock:
            _pending_subs.setdefault(peer_id, set()).add(base_topic)
        logger.debug(
            "peer_manager.on_local_subscribe: queued %s for peer %s",
            base_topic, peer_id,
        )


def on_local_unsubscribe(peer_id: str, base_topic: str, local_topic: str) -> None:
    """Close the upstream subscription; also drop from the pending
    queue in case the local sub was added and removed before the peer
    connected."""
    pc = _resolve_peer(peer_id)
    with _lock:
        s = _pending_subs.get(peer_id)
        if s is not None:
            s.discard(base_topic)
            if not s:
                _pending_subs.pop(peer_id, None)
    if pc is not None and pc.is_connected:
        _schedule_send(pc.unsubscribe_upstream(base_topic))


# ─── PeerConnection callbacks ─────────────────────────────────────────


def _on_peer_state_change(pc: PeerConnection) -> None:
    """Index by remote id once identification completes; replay any
    queued subscriptions so the lazy bridge catches up after connect.

    Dedup guard: a single runtime can show up under multiple mDNS
    hostnames (machine hostname AND ``<runtime_id>.local``). Both
    discoveries spin up PeerConnections that eventually identify with
    the same ``remote_id``. We keep the FIRST one and stop+forget the
    duplicate so the UI sees one pill per runtime rather than two.
    """
    if pc.state == PeerState.CONNECTED and pc.remote_id is not None:
        dup_to_stop: Optional[PeerConnection] = None
        with _lock:
            existing = _peers_by_id.get(pc.remote_id)
            if existing is not None and existing is not pc:
                # Same runtime discovered twice. Keep the older one
                # (already bridging subs); ditch this one.
                dup_to_stop = pc
                # Drop the dup from the url index too — we're about to
                # stop it, no point holding a reference.
                for u, p in list(_peers_by_url.items()):
                    if p is pc:
                        _peers_by_url.pop(u, None)
            else:
                _peers_by_id[pc.remote_id] = pc
            # Replay any subs queued by id, and any queued by url (if a
            # caller subscribed before connect produced an id).
            replays: Set[str] = set()
            if dup_to_stop is None:
                replays.update(_pending_subs.pop(pc.remote_id, set()))
                replays.update(_pending_subs.pop(pc.url, set()))
        if dup_to_stop is not None:
            logger.info(
                "peer_manager: discarding duplicate peer %s — already connected as %s",
                dup_to_stop.url, dup_to_stop.remote_id,
            )
            _schedule_send(dup_to_stop.stop())
            return
        for topic in replays:
            _schedule_send(pc.subscribe_upstream(topic))
        if replays:
            logger.info(
                "peer_manager: replayed %d subs on peer %s connect",
                len(replays), pc.remote_id,
            )


def _bridge_inbound(
    pc: PeerConnection, topic: str, payload: Any, frame: Dict[str, Any],
) -> None:
    """Inbound peer → local bridge. Republish to the local bus under
    the ``@<remote_id>`` suffix so local subscribers on the suffixed
    address see it. Routed through ``publish_local_only`` to skip the
    federation router (otherwise the suffixed topic would bounce
    right back out to the peer — infinite loop)."""
    if pc.remote_id is None:
        return
    # /runtime/info is the identification channel; republishing it
    # locally as /runtime/info@<peer> would collide with the local
    # /runtime/info retained value the peer card depends on. Consumers
    # that want to know about peer identities query peer_manager.peers().
    if topic == "/runtime/info":
        return
    local_topic = f"{topic}@{pc.remote_id}"
    retained = bool(frame.get("retained", False))
    get_bus().publish_local_only(
        local_topic, payload,
        method=frame.get("method"),
        reply_to=frame.get("reply_to"),
        sender_id=frame.get("sender_id"),
        retained=retained,
    )


# ─── plumbing ─────────────────────────────────────────────────────────


def _resolve_peer(peer_id_or_url: str) -> Optional[PeerConnection]:
    with _lock:
        return _peers_by_id.get(peer_id_or_url) or _peers_by_url.get(peer_id_or_url)


def _schedule_send(coro: "asyncio.Future | asyncio.coroutines.Coroutine") -> None:
    """Run a coroutine on whatever loop is running. If there's no
    running loop (rare — bus.publish_sync can be called from a sync
    FastAPI worker), spawn a temporary loop on a thread. The send
    itself is fire-and-forget; we don't await."""
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(coro)        # type: ignore[arg-type]
    except RuntimeError:
        # No running loop in this thread — punt to the manager's loop
        # if one is registered.
        target = _manager_loop
        if target is None:
            logger.warning("peer_manager._schedule_send: no loop available — dropping")
            return
        asyncio.run_coroutine_threadsafe(coro, target)   # type: ignore[arg-type]


# Loop the manager registers itself on at boot. Used by _schedule_send
# when callbacks fire from threads that don't have a running loop.
_manager_loop: Optional[asyncio.AbstractEventLoop] = None


def bind_loop(loop: asyncio.AbstractEventLoop) -> None:
    """Called from event_handlers.on_startup so cross-thread bus
    publishes can find a loop to send peer frames on."""
    global _manager_loop
    _manager_loop = loop


# ─── shutdown for tests ───────────────────────────────────────────────


async def stop_all() -> None:
    """Disconnect every peer. Used in tests + on backend shutdown."""
    pcs: list[PeerConnection] = []
    with _lock:
        pcs = list(_peers_by_url.values())
        _peers_by_url.clear()
        _peers_by_id.clear()
        _pending_subs.clear()
    for pc in pcs:
        try:
            await pc.stop()
        except Exception:  # noqa: BLE001
            pass


def reset_for_tests() -> None:
    """Synchronous flush of all state. Used by tests that don't have
    a running loop. Existing connections leak by design — tests should
    use ``stop_all`` when running in an async context."""
    with _lock:
        _peers_by_url.clear()
        _peers_by_id.clear()
        _pending_subs.clear()


# ─── test affordances kept for step 2a's stub-era unit tests ──────────
# These functions are still imported by tests/test_bus_federation.py
# from when peer_manager was a pure stub. They no longer record real
# state (the real bridge has real state); the test affordances now
# return empty snapshots, which is the right answer once the manager
# is in "real" mode with no peers connected.


def pending_publishes() -> list:
    return []


def open_subscriptions() -> Dict[str, Set[str]]:
    """Subscriptions we've forwarded upstream, grouped by peer id."""
    out: Dict[str, Set[str]] = {}
    with _lock:
        for pid, pc in _peers_by_id.items():
            out[pid] = set(pc._upstream_subscriptions)
        # Plus pending (peer not connected yet)
        for pid, topics in _pending_subs.items():
            out.setdefault(pid, set()).update(topics)
    return out
