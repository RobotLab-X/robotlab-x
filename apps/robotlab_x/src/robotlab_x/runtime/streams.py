# unmanaged
"""Stream registry — the media plane.

The bus carries control + state + low-rate samples. Streams carry raw
frames. This module owns the runtime-side state for every active stream:
the latest frame, fps counter, consumer count, producer liveness.

Wire model:

  Producer (subprocess service)              Runtime                       Consumer (browser <img>)
  ─────────────────────────────              ───────                       ────────────────────────
  WS /v1/stream/<id>/upload  ──── binary ──▶ StreamState.set_frame   ──▶  GET /v1/stream/<id>/mjpeg
  (JPEG bytes)                              (latest + per-consumer        ──▶ multipart frames
                                             condvar wakeup)

  Producer also publishes:
    - retained /stream/index/<id>  (discovery — JSON metadata)
    - retained /<type>/<id>/state  (the service's own state topic)
    - low-rate /<type>/<id>/frame_sample  (base64 thumbnail @ ~2Hz)

  Consumer learns about the stream by subscribing to /stream/index/*
  and reading the endpoint URLs out of the announcement.

Why subprocess → runtime instead of subprocess-direct-HTTP: one auth gate
at the runtime (vs. per-subprocess), no per-service port allocation, and
consumer URLs stay stable across subprocess restarts. The price is one
hop and a JPEG decode/re-encode is NOT needed — runtime stores opaque
bytes and re-serves them verbatim.

Backpressure: ``set_frame`` is non-blocking. If a consumer can't keep up
its condvar wakeup races and it just sees the next frame instead of
falling behind. Slow consumers don't slow the producer.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


logger = logging.getLogger(__name__)


@dataclass
class StreamMetadata:
    """Producer-supplied descriptor of a stream. Mirrors the wire shape
    consumers see on ``/stream/index/<id>``. Optional fields default to
    None so older producers don't have to fill everything in."""
    stream_id: str
    producer_id: Optional[str] = None        # service proxy id that owns it
    kinds: List[str] = field(default_factory=lambda: ["mjpeg"])
    format: Optional[str] = None              # "jpeg" most common
    resolution: Optional[List[int]] = None    # [w, h]
    fps: Optional[float] = None


class StreamState:
    """Per-stream runtime-side state.

    Holds the latest opaque frame bytes + a list of asyncio.Conditions
    used to wake waiting consumers. Each MJPEG consumer holds its own
    condition + a "have I seen this frame yet" sequence number; the
    producer bumps the sequence on each frame so consumers can poll +
    block efficiently.
    """

    __slots__ = (
        "stream_id", "metadata",
        "_frame", "_frame_seq", "_frame_at",
        "_condition", "_consumers",
        "_fps_window", "_last_producer_at",
    )

    # Drop the producer's last_seen-at after this many seconds with no
    # frames — consumers see the stream as dead after that and can fall
    # back to a placeholder.
    _STALE_AFTER_S = 10.0

    def __init__(self, stream_id: str, metadata: StreamMetadata) -> None:
        self.stream_id = stream_id
        self.metadata = metadata
        self._frame: Optional[bytes] = None
        self._frame_seq = 0
        self._frame_at: float = 0.0
        # Shared condvar — every consumer waits on this; producer's
        # set_frame fires notify_all so each consumer wakes and pulls
        # the latest. Cheaper than per-consumer queues since consumers
        # only need the LATEST frame, not every intermediate one.
        self._condition = asyncio.Condition()
        self._consumers: int = 0
        # Rolling window of recent frame timestamps for fps display.
        # Bounded — keep last 30 entries (1s @ 30fps).
        self._fps_window: List[float] = []
        self._last_producer_at: float = 0.0

    # ─── producer side ─────────────────────────────────────────────────

    async def set_frame(self, frame: bytes) -> None:
        """Producer call: store the frame + wake every consumer waiting
        for a new sequence. Lock-protected so consumers see consistent
        (frame, seq) pairs."""
        async with self._condition:
            self._frame = frame
            self._frame_seq += 1
            now = time.monotonic()
            self._frame_at = now
            self._last_producer_at = now
            # Slide the fps window so fps reflects only the last second.
            self._fps_window.append(now)
            if len(self._fps_window) > 30:
                self._fps_window.pop(0)
            self._condition.notify_all()

    def mark_producer_alive(self) -> None:
        """Producer's heartbeat (called on connect + every push). Used
        for the stale-stream detector."""
        self._last_producer_at = time.monotonic()

    # ─── consumer side ─────────────────────────────────────────────────

    async def wait_for_frame(self, last_seen_seq: int, timeout_s: float = 5.0) -> Optional[tuple[bytes, int]]:
        """Consumer call: wait until a frame newer than ``last_seen_seq``
        is available, then return ``(bytes, new_seq)``. Returns None on
        timeout — consumer's caller decides whether to send a keep-alive
        boundary or close.
        """
        async with self._condition:
            try:
                await asyncio.wait_for(
                    self._condition.wait_for(lambda: self._frame_seq > last_seen_seq and self._frame is not None),
                    timeout=timeout_s,
                )
            except asyncio.TimeoutError:
                return None
            return (self._frame, self._frame_seq) if self._frame is not None else None

    def latest_frame(self) -> Optional[tuple[bytes, int]]:
        """Non-waiting snapshot. Used by consumers that want to send the
        most recent frame immediately on connect rather than waiting for
        the next one."""
        if self._frame is None:
            return None
        return (self._frame, self._frame_seq)

    def add_consumer(self) -> None:
        self._consumers += 1

    def remove_consumer(self) -> None:
        if self._consumers > 0:
            self._consumers -= 1

    # ─── introspection ─────────────────────────────────────────────────

    def fps(self) -> float:
        """Frames per second over the last sliding window."""
        if len(self._fps_window) < 2:
            return 0.0
        span = self._fps_window[-1] - self._fps_window[0]
        if span <= 0:
            return 0.0
        return (len(self._fps_window) - 1) / span

    def is_stale(self) -> bool:
        return (time.monotonic() - self._last_producer_at) > self._STALE_AFTER_S

    def snapshot(self) -> Dict[str, Any]:
        """Public state used by GET /v1/stream and admin tooling."""
        return {
            "stream_id": self.stream_id,
            "producer_id": self.metadata.producer_id,
            "kinds": list(self.metadata.kinds),
            "format": self.metadata.format,
            "resolution": list(self.metadata.resolution) if self.metadata.resolution else None,
            "declared_fps": self.metadata.fps,
            "observed_fps": round(self.fps(), 2),
            "consumers": self._consumers,
            "last_frame_at": self._frame_at,
            "stale": self.is_stale(),
        }


class StreamRegistry:
    """Process-wide map: stream_id → StreamState.

    Producers register on connect, unregister on disconnect. Consumers
    look up by id when an MJPEG GET arrives. Idempotent: re-registering
    the same stream_id updates metadata but keeps the existing condvar +
    consumer count so consumers don't get bounced on producer restart.
    """

    def __init__(self) -> None:
        self._streams: Dict[str, StreamState] = {}
        # Coarse-grained — only register/unregister contend, not push.
        self._lock = asyncio.Lock()

    async def register(self, metadata: StreamMetadata) -> StreamState:
        async with self._lock:
            existing = self._streams.get(metadata.stream_id)
            if existing is not None:
                existing.metadata = metadata
                existing.mark_producer_alive()
                logger.info("stream.register (re-bind) id=%s producer=%s",
                            metadata.stream_id, metadata.producer_id)
                return existing
            state = StreamState(metadata.stream_id, metadata)
            state.mark_producer_alive()
            self._streams[metadata.stream_id] = state
            logger.info("stream.register id=%s producer=%s kinds=%s",
                        metadata.stream_id, metadata.producer_id, metadata.kinds)
            return state

    async def unregister(self, stream_id: str) -> None:
        async with self._lock:
            if stream_id in self._streams:
                del self._streams[stream_id]
                logger.info("stream.unregister id=%s", stream_id)

    def get(self, stream_id: str) -> Optional[StreamState]:
        return self._streams.get(stream_id)

    def list_all(self) -> List[Dict[str, Any]]:
        return [s.snapshot() for s in self._streams.values()]


# Module-level singleton — there's one stream registry per runtime
# process. Mirrors the get_bus() pattern.
_registry: Optional[StreamRegistry] = None


def get_registry() -> StreamRegistry:
    global _registry
    if _registry is None:
        _registry = StreamRegistry()
    return _registry
