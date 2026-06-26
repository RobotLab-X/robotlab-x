"""Stream — subprocess-side handle to the runtime's stream channel.

Phase 1 transports:
  * MJPEG (binary JPEG bytes pushed to ``/v1/stream/<id>/upload``)
  * Low-rate sample frames on the bus (``/<type>/<id>/frame_sample``)

Author API::

    stream = await self.register_stream(
        stream_id="cam-1",
        kinds=["mjpeg", "frames_low"],
        resolution=(1280, 720),
        fps=30,
    )

    # In the capture loop — sync OR async; push() is non-blocking.
    while not self.is_stopping():
        ok, frame = cap.read()
        if not ok: continue
        stream.push(encode_jpeg(frame))

Backpressure: ``push()`` is fire-and-forget into a bounded asyncio.Queue.
When the queue is full (sender can't keep up with the WS), oldest
frames drop — better fresh-stale than blocking the producer's loop.

Reconnect: the underlying WS auto-reconnects with exponential backoff.
Frames pushed while disconnected drop on the floor (live media — replay
is meaningless). Stream metadata + discovery state on the bus persist
across reconnects.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, List, Optional, Sequence, Tuple

import websockets


logger = logging.getLogger(__name__)


# How many frames the sender queue holds before dropping. 30fps ~= 1
# second of frames — long enough to ride out a brief send stall, short
# enough that consumers don't see stale frames if the sender unwedges.
_DEFAULT_QUEUE_DEPTH = 30
_RECONNECT_BASE_S = 1.0
_RECONNECT_MAX_S = 30.0


def _upload_ws_url(backend_url: str, stream_id: str, token: str) -> str:
    """Turn ``http://host:port`` + stream_id → ``ws(s)://host:port/v1/stream/<id>/upload?token=…``."""
    base = backend_url.rstrip("/").replace("http://", "ws://").replace("https://", "wss://")
    return f"{base}/v1/stream/{stream_id}/upload?token={token}"


class Stream:
    """Producer-side handle to one stream channel.

    Internally owns:
      * an asyncio task running ``_sender_loop`` — opens the upload WS,
        sends metadata, drains the frame queue
      * an asyncio.Queue[bytes] of pending JPEG frames

    Construction is cheap; the WS doesn't open until ``start()`` is
    called. ``SubprocessService.register_stream`` calls start() for the
    user so the typical author never sees this lifecycle.
    """

    def __init__(
        self,
        stream_id: str,
        backend_url: str,
        token: str,
        *,
        producer_id: Optional[str] = None,
        kinds: Optional[Sequence[str]] = None,
        format: Optional[str] = None,
        resolution: Optional[Tuple[int, int]] = None,
        fps: Optional[float] = None,
        queue_depth: int = _DEFAULT_QUEUE_DEPTH,
    ) -> None:
        self.stream_id = stream_id
        self._backend_url = backend_url
        self._token = token
        self._metadata = {
            "producer_id": producer_id,
            "kinds": list(kinds or ["mjpeg"]),
            "format": format or "jpeg",
            "resolution": list(resolution) if resolution else None,
            "fps": fps,
        }
        self._queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=queue_depth)
        self._sender_task: Optional[asyncio.Task[None]] = None
        self._stop = asyncio.Event()
        self._drop_count = 0

    # ─── lifecycle ─────────────────────────────────────────────────────

    def start(self) -> None:
        """Spawn the sender task. Idempotent — calling twice is a no-op."""
        if self._sender_task is not None and not self._sender_task.done():
            return
        self._stop.clear()
        self._sender_task = asyncio.create_task(
            self._sender_loop(), name=f"stream.sender:{self.stream_id}"
        )

    async def close(self) -> None:
        """Stop the sender task. Drops any in-flight frames in the queue."""
        self._stop.set()
        if self._sender_task is not None:
            self._sender_task.cancel()
            try:
                await self._sender_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            self._sender_task = None

    # ─── producer API ──────────────────────────────────────────────────

    def push(self, frame: bytes) -> None:
        """Enqueue a JPEG-encoded frame for upload. Non-blocking.

        When the queue is full (sender stalled or disconnected), the
        oldest frame is dropped to make room. Drop count is exposed via
        ``drop_count`` so the service can publish it on its /state.
        """
        if not isinstance(frame, (bytes, bytearray, memoryview)):
            raise TypeError("Stream.push expects bytes-like (JPEG-encoded)")
        try:
            self._queue.put_nowait(bytes(frame))
        except asyncio.QueueFull:
            # Drop oldest, push new — favours freshness over completeness.
            try:
                self._queue.get_nowait()
                self._drop_count += 1
            except asyncio.QueueEmpty:  # pragma: no cover
                pass
            try:
                self._queue.put_nowait(bytes(frame))
            except asyncio.QueueFull:  # pragma: no cover
                pass

    def update_metadata(
        self,
        *,
        resolution: Optional[Tuple[int, int]] = None,
        fps: Optional[float] = None,
        format: Optional[str] = None,
    ) -> None:
        """Patch the metadata mid-stream. The sender re-emits it on next
        send (or immediately if already connected). Useful for fps/res
        changes after camera reconfiguration."""
        if resolution is not None:
            self._metadata["resolution"] = list(resolution)
        if fps is not None:
            self._metadata["fps"] = fps
        if format is not None:
            self._metadata["format"] = format

    @property
    def drop_count(self) -> int:
        return self._drop_count

    @property
    def metadata(self) -> dict:
        return dict(self._metadata)

    # ─── internal — sender coroutine ───────────────────────────────────

    async def _sender_loop(self) -> None:
        """Main sender loop. Connects, sends metadata, drains the queue.

        On disconnect, backs off + retries. Frames queued during the
        outage drop (live media — old frames are useless after the gap).
        """
        delay = _RECONNECT_BASE_S
        while not self._stop.is_set():
            url = _upload_ws_url(self._backend_url, self.stream_id, self._token)
            try:
                async with websockets.connect(url, max_size=None) as ws:
                    delay = _RECONNECT_BASE_S
                    logger.info("stream.sender connected id=%s", self.stream_id)
                    # 1. Metadata first.
                    await ws.send(json.dumps(self._metadata))
                    # 2. Frame loop. Drain the queue, send each as binary.
                    while not self._stop.is_set():
                        try:
                            frame = await asyncio.wait_for(self._queue.get(), timeout=5.0)
                        except asyncio.TimeoutError:
                            # No frames in 5s — keep the connection warm
                            # by sending an empty metadata-only update so
                            # the runtime's stale detector resets.
                            await ws.send(json.dumps(self._metadata))
                            continue
                        await ws.send(frame)
            except asyncio.CancelledError:
                return
            except (websockets.WebSocketException, OSError) as exc:
                logger.info("stream.sender disconnect id=%s reason=%s",
                            self.stream_id, exc.__class__.__name__)
            except Exception:  # noqa: BLE001
                logger.exception("stream.sender unexpected error id=%s", self.stream_id)
            if self._stop.is_set():
                return
            # Backoff before reconnect attempt.
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=delay)
                return
            except asyncio.TimeoutError:
                pass
            delay = min(delay * 2, _RECONNECT_MAX_S)


# ─── helper: build a Stream from env ──────────────────────────────────


def from_env(
    stream_id: str,
    *,
    producer_id: Optional[str] = None,
    kinds: Optional[Sequence[str]] = None,
    format: Optional[str] = None,
    resolution: Optional[Tuple[int, int]] = None,
    fps: Optional[float] = None,
) -> Optional[Stream]:
    """Construct a Stream from ``ROBOTLAB_X_BACKEND_URL`` +
    ``ROBOTLAB_X_SUBPROCESS_TOKEN`` env vars — the same ones BusClient
    reads. Returns None when either isn't set (no runtime → no stream)."""
    backend_url = os.environ.get("ROBOTLAB_X_BACKEND_URL")
    token = os.environ.get("ROBOTLAB_X_SUBPROCESS_TOKEN")
    if not backend_url or not token:
        return None
    return Stream(
        stream_id=stream_id,
        backend_url=backend_url,
        token=token,
        producer_id=producer_id,
        kinds=kinds,
        format=format,
        resolution=resolution,
        fps=fps,
    )
