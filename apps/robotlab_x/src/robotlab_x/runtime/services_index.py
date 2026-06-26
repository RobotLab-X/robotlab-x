# unmanaged
"""Runtime-level service index — aggregates every service's meta payload
into a single retained topic at /runtime/runtime/services.

The runtime singleton owns this index. Each service publishes its own
self-description to ``/<type>/<proxy_id>/meta`` (retained) when it
starts and clears it (publishes ``None`` retained) when it stops; this
publisher subscribes to the wildcard ``/+/+/meta``, maintains an in-
memory dict keyed by proxy_id, and re-publishes a compact digest to
``/runtime/runtime/services`` (retained, debounced) on every change.

Topic shape::

    /runtime/runtime/services    (retained)
    {
      "ts": 1735508400.12,
      "runtime_id": "default" | "funny-droid" | …,
      "services": [
        {"proxy_id": "video-1", "type": "video", "version": "1.0.0",
         "transport": "subprocess", "status": "running",
         "topics_root": "/video/video-1",
         "meta_topic": "/video/video-1/meta",
         "runtime_id": "default", "pid": 12345},
        …
      ]
    }

This is the "top of the hierarchy" — a consumer that knows nothing
about which services exist can subscribe here and walk down: pick a
service → subscribe to its meta_topic → follow the topics it advertises
→ subscribe to per-service state/telemetry.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Dict, Optional

from robotlab_x.runtime.bus import get_bus
from robotlab_x.runtime.identity import get_runtime_id


logger = logging.getLogger(__name__)


_META_WILDCARD = "/+/+/meta"
_OUTPUT_TOPIC = "/runtime/runtime/services"


class ServicesIndexPublisher:
    """Subscribe to every service's meta topic, republish a flat digest.

    Lifetime mirrors SystemStatePublisher: ``start()`` schedules the
    subscriber task on the current loop; ``stop()`` cancels it and
    clears the retained index.

    The debounce window (default 250ms) coalesces the bursts of meta
    updates that happen when several services start in quick succession
    (e.g. on backend boot or after a reconcile pass). Without it we'd
    republish the index N times instead of once.
    """

    def __init__(self, debounce_s: float = 0.25) -> None:
        self.debounce_s = debounce_s
        self._meta_by_proxy: Dict[str, Dict[str, Any]] = {}
        self._task: Optional[asyncio.Task[None]] = None
        self._republish_task: Optional[asyncio.Task[None]] = None
        self._republish_pending = asyncio.Event()
        self._stop_event = asyncio.Event()

    def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._run(), name="runtime.services_index")
        self._republish_task = asyncio.create_task(
            self._republish_loop(), name="runtime.services_index.republish"
        )
        # Publish an initial empty snapshot RIGHT NOW so the retained
        # topic has a value even when no services have published meta
        # yet (e.g. a freshly-booted federated peer with zero proxies).
        # Without this the republish loop waits on _republish_pending
        # forever; subscribers see no payload + can't even read the
        # runtime's federation id from the bus. The first real meta
        # delivery later will overwrite this snapshot.
        try:
            self._publish_snapshot()
        except Exception:  # noqa: BLE001
            logger.exception("runtime.services_index: initial publish failed")
        logger.info("runtime.services_index: started (topic=%s)", _OUTPUT_TOPIC)

    async def stop(self) -> None:
        if self._task is None:
            return
        self._stop_event.set()
        # Wake the republish loop so it sees the stop event.
        self._republish_pending.set()
        for t in (self._task, self._republish_task):
            if t is None:
                continue
            try:
                await asyncio.wait_for(t, timeout=2.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                t.cancel()
        self._task = None
        self._republish_task = None
        # Best-effort: clear the retained index so a fresh subscriber
        # doesn't see stale data after a restart.
        try:
            get_bus().publish_sync(_OUTPUT_TOPIC, None, retained=True)
        except Exception:  # noqa: BLE001
            logger.debug("services_index: clear on stop failed (bus may be down)")
        logger.info("runtime.services_index: stopped")

    async def _run(self) -> None:
        """Subscribe to every service's meta topic + maintain the index."""
        bus = get_bus()
        async for msg in bus.subscribe(_META_WILDCARD, "runtime.services_index"):
            if self._stop_event.is_set():
                return
            # The concrete topic is /<type>/<proxy_id>/meta. Pull the
            # proxy_id so we can dedupe + clear on null payload.
            parts = (msg.topic or "").strip("/").split("/")
            if len(parts) < 3 or parts[-1] != "meta":
                continue
            proxy_id = parts[-2]
            payload = msg.payload
            if payload is None:
                # Service published a clear — drop it from the index.
                if self._meta_by_proxy.pop(proxy_id, None) is not None:
                    self._republish_pending.set()
                continue
            if not isinstance(payload, dict):
                continue
            self._meta_by_proxy[proxy_id] = payload
            self._republish_pending.set()

    async def _republish_loop(self) -> None:
        """Wait on the pending event, then republish the index after a
        short debounce window so bursty updates coalesce into one wire
        message."""
        while not self._stop_event.is_set():
            await self._republish_pending.wait()
            self._republish_pending.clear()
            # Debounce — give the burst a moment to settle. New meta
            # updates during this window re-set the event but we just
            # drained it, so they'll be picked up in the snapshot we
            # publish right after.
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=self.debounce_s)
                return  # stop fired
            except asyncio.TimeoutError:
                pass
            # Drain any updates that arrived during the debounce window
            # so we don't immediately loop again for them.
            self._republish_pending.clear()
            try:
                self._publish_snapshot()
            except Exception:  # noqa: BLE001
                logger.exception("services_index: publish failed")

    # ─── module-level singleton + start/stop helpers ─────────────────
    # Defined at module scope below; this method ends the class.

    def _publish_snapshot(self) -> None:
        runtime_id = get_runtime_id() or None
        services = []
        for proxy_id, meta in sorted(self._meta_by_proxy.items()):
            type_name = meta.get("type") or "?"
            services.append({
                "proxy_id": proxy_id,
                "type": type_name,
                "version": meta.get("version"),
                "transport": meta.get("transport"),
                "status": "running",
                "topics_root": meta.get("topics_root") or f"/{type_name}/{proxy_id}",
                "meta_topic": (meta.get("topics") or {}).get("meta")
                              or f"/{type_name}/{proxy_id}/meta",
                "runtime_id": meta.get("runtime_id") or runtime_id,
                "pid": meta.get("pid"),
            })
        payload = {
            "ts": time.time(),
            "runtime_id": runtime_id,
            "services": services,
        }
        get_bus().publish_sync(_OUTPUT_TOPIC, payload, retained=True)


# Module-level singleton — one runtime per process, one index publisher.
_publisher: Optional[ServicesIndexPublisher] = None


def start_publisher(debounce_s: float = 0.25) -> None:
    """Idempotent — calling twice is a no-op."""
    global _publisher
    if _publisher is None:
        _publisher = ServicesIndexPublisher(debounce_s=debounce_s)
    _publisher.start()


async def stop_publisher() -> None:
    """Best-effort shutdown for tests + clean exits."""
    global _publisher
    if _publisher is not None:
        await _publisher.stop()
        _publisher = None
