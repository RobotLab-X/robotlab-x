"""VideoService — OpenCV-backed video capture + streaming.

Lifecycle:
  * on_start opens cv2.VideoCapture for ``config.source`` (camera index,
    file path, RTSP URL — anything cv2 accepts).
  * register_stream announces the stream on the bus + opens the upload
    WS to the runtime.
  * capture loop reads frames in a worker thread (cv2 blocks), encodes
    to JPEG, pushes through the Stream object. Async-thread bridge keeps
    asyncio happy without polluting the hot path.
  * /state retained: connected, resolution, observed_fps, dropped frames.
  * /control accepts connect/disconnect/snapshot/set_resolution.

Subprocess service so cv2's background threads + the V4L2 device handle
stay isolated from the backend.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import os
import time
import uuid
from typing import Any, Dict, List, Optional

import cv2
import numpy as np
from rlx_bus import ServiceConfig, Stream, SubprocessService, service_method

from .filters import Filter, build_filter, catalog as filter_catalog


logger = logging.getLogger(__name__)


class VideoConfig(ServiceConfig):
    """Strongly-typed config for VideoService.

    Fields:
      * source       — anything cv2.VideoCapture accepts. Integer (camera
                       index e.g. 0), file path, or URL (rtsp://, http://).
                       Strings that parse as integers are treated as device
                       indices automatically.
      * width/height — target resolution. Camera/codec may snap to nearest
                       supported. Null leaves cv2 default.
      * fps          — target capture fps. Null leaves cv2 default.
      * jpeg_quality — JPEG encode quality (0-100). 75 is a good balance.
    """
    source: str = "0"
    width: Optional[int] = None
    height: Optional[int] = None
    fps: Optional[float] = None
    jpeg_quality: int = 75
    # Ordered list of filter specs. Each: {id, type, enabled, params}.
    # Persists across restarts via the standard config flow. Empty list
    # = no pipeline; capture loop sends raw camera frames.
    filters: List[Dict[str, Any]] = []


def _coerce_source(raw: str) -> Any:
    """``"0"`` → ``0`` (device index). Everything else passes through."""
    if raw is None:
        return 0
    try:
        return int(raw)
    except (TypeError, ValueError):
        return raw


class VideoService(SubprocessService):
    type_name = "video"
    config_class = VideoConfig
    heartbeat_interval_s = 5.0

    def __init__(self, proxy_id: str, bus) -> None:
        super().__init__(proxy_id, bus)
        self._cap: Optional[cv2.VideoCapture] = None
        self._stream: Optional[Stream] = None
        self._capture_task: Optional[asyncio.Task[None]] = None
        # The most recent successfully-read frame, kept around for the
        # snapshot action so it doesn't have to do its own cv2.read
        # (which would race with the capture loop). At most one frame
        # in RAM (~1MB at 480p) — negligible. Cleared on disconnect so
        # snapshots after a disconnect report "no frame available"
        # instead of returning a stale image.
        self._latest_frame: Optional[np.ndarray] = None
        self._latest_frame_ts: float = 0.0
        # Live filter instances, built from self.config.filters. Rebuilt
        # on every config_state change so the capture loop only ever
        # sees instances matching the persisted spec.
        self._filters: List[Filter] = []
        # Signature = the input spec list; the capture loop compares
        # config.filters to this on every iteration so a config change
        # mid-frame triggers a rebuild without the user having to
        # restart anything.
        self._filters_signature: tuple = ()
        # Tracks which filter ids currently have a /filter/index/<id>
        # retained entry — used by _reconcile_filter_index to clear stale
        # entries when a filter is removed or stops publishing telemetry.
        self._filter_index_ids: set = set()
        # Last published state, kept around so /state updates are
        # diff-friendly and so we don't republish unchanged values.
        self._state: dict = {
            "connected": False,
            "source": None,
            "resolution": None,
            "declared_fps": None,
            "observed_fps": 0.0,
            "dropped": 0,
            "error": None,
        }

    # ─── lifecycle ────────────────────────────────────────────────────

    async def on_start(self) -> None:
        # Register the static filter catalog as a bus *announcement*
        # so it's re-broadcast on every (re)connect to the runtime.
        # The plain ``publish(..., retained=True)`` we used before
        # only populates the runtime's in-memory retained store ONCE
        # at subprocess startup; when the main runtime restarts, that
        # store is wiped, the subprocess's WS reconnects, but nothing
        # re-publishes the catalog — leaving the UI's Add-filter
        # dropdown stuck on "no catalog yet". Announcements close
        # that gap: BusClient._run_announcements fires every
        # registered announcement on each connect.
        catalog_topic = self.resolve_topic(self.topic("filter_catalog"))
        self.bus.announce(
            catalog_topic,
            lambda: {"filters": filter_catalog()},
            retained=True,
        )
        # Initial publish for the already-connected case — ``announce``
        # only fires on (re)connect, and we're past the initial connect
        # by the time on_start runs.
        await self.publish("filter_catalog", {"filters": filter_catalog()}, retained=True)

        # Same pattern for the live filter pipeline — survives runtime
        # restart so the UI's FilterPipeline section gets it back on
        # first subscribe after reconnect. ``_publish_filters`` handles
        # the in-process diff-and-publish for live add/remove updates;
        # the announcement is just the reconnect-safety net that mirrors
        # whatever the in-process state is at reconnect time.
        filters_topic = self.resolve_topic(self.topic("filters"))
        self.bus.announce(
            filters_topic,
            lambda: {"filters": self._filters_announcement()},
            retained=True,
        )

        # Build the initial filter pipeline from persisted config. The
        # SubprocessService base class already applied retained
        # config_state to self.config before on_start; we just hydrate
        # the instances.
        self._rebuild_filters(getattr(self.config, "filters", []) or [])
        # Mirror the persisted list onto /filters retained so the UI's
        # FilterPipeline section gets it on first subscribe.
        await self._publish_filters()

        # Register the stream BEFORE opening the camera so the discovery
        # message lands on the bus immediately — UI can show the card
        # even if the camera open is slow or fails.
        stream_id = f"video/{self.proxy_id}"
        self._stream = await self.register_stream(
            stream_id=stream_id,
            kinds=["mjpeg"],
            format="jpeg",
            resolution=(self.config.width, self.config.height) if (self.config.width and self.config.height) else None,
            fps=self.config.fps,
        )
        if self._stream is None:
            logger.warning("%s: stream registration failed — no runtime env", self.proxy_id)

        # Try to open the configured source. Connect failures don't
        # abort startup — the service stays up + reports the error,
        # so the user can fix config without re-installing the service.
        try:
            await self._open_capture()
        except Exception as exc:  # noqa: BLE001
            logger.exception("%s: initial capture open failed", self.proxy_id)
            self._state["error"] = str(exc)
            await self._publish_state()

    async def on_stop(self) -> None:
        if self._capture_task is not None:
            self._capture_task.cancel()
            try:
                await self._capture_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            self._capture_task = None
        if self._cap is not None:
            await asyncio.to_thread(self._cap.release)
            self._cap = None
        if self._stream is not None:
            await self._stream.close()
            self._stream = None

    # ─── capture pipeline ─────────────────────────────────────────────

    async def _open_capture(self) -> None:
        """Open cv2.VideoCapture for the configured source + spawn the
        capture loop. Replaces any previous capture/task."""
        # Tear down the previous capture cleanly first.
        if self._capture_task is not None:
            self._capture_task.cancel()
            try:
                await self._capture_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            self._capture_task = None
        if self._cap is not None:
            await asyncio.to_thread(self._cap.release)
            self._cap = None
            # Settling time — V4L2 needs a moment to fully release the
            # device before another open() succeeds, otherwise the new
            # cap reports isOpened=True but read() yields nothing. Same
            # wedge that triggered the auto-recovery path; prevent it
            # here on every manual reconnect too.
            await asyncio.sleep(0.5)

        source = _coerce_source(self.config.source)
        logger.info("%s: opening capture source=%r", self.proxy_id, source)
        cap = await asyncio.to_thread(cv2.VideoCapture, source)
        if not cap.isOpened():
            self._cap = None
            self._state.update({
                "connected": False,
                "source": str(source),
                "error": f"cv2.VideoCapture({source!r}) failed to open",
            })
            await self._publish_state()
            return

        # Best-effort apply width/height/fps. The camera/codec snaps to
        # the nearest supported value; we read it back below for state.
        if self.config.width and self.config.height:
            await asyncio.to_thread(cap.set, cv2.CAP_PROP_FRAME_WIDTH, self.config.width)
            await asyncio.to_thread(cap.set, cv2.CAP_PROP_FRAME_HEIGHT, self.config.height)
        if self.config.fps:
            await asyncio.to_thread(cap.set, cv2.CAP_PROP_FPS, self.config.fps)

        actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        actual_fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)

        self._cap = cap
        self._state.update({
            "connected": True,
            "source": str(source),
            "resolution": [actual_w, actual_h],
            "declared_fps": actual_fps,
            "error": None,
        })
        await self._publish_state()

        # Update the stream's metadata so consumers' index entry is
        # accurate once the camera reports its real resolution.
        if self._stream is not None:
            self._stream.update_metadata(
                resolution=(actual_w, actual_h),
                fps=actual_fps,
            )

        self._capture_task = asyncio.create_task(
            self._capture_loop(), name=f"video.capture:{self.proxy_id}"
        )

    # When cap.read() returns False this many times in a row we treat
    # the device as wedged + try to re-open it. At 5Hz polling (0.2s
    # sleep on failure) that's ~3 seconds of no frames. Long enough to
    # ride out a brief device hiccup, short enough that a real failure
    # doesn't leave the UI staring at a frozen image.
    _MAX_CONSECUTIVE_READ_FAILS = 15
    # Hard ceiling on auto-reopens in a single capture loop. Prevents a
    # truly dead camera from spinning the loop forever — after this we
    # give up + publish state.error so the user has to manually Connect.
    _MAX_REOPEN_ATTEMPTS = 5

    async def _capture_loop(self) -> None:
        """Read → encode → push. cv2.read blocks, so it runs in a worker
        thread; the encode + push happen on the main loop where the
        Stream lives. State updates fire every second so the UI's
        observed_fps stays current without flooding the bus.

        Auto-recovery: a run of ``_MAX_CONSECUTIVE_READ_FAILS`` failed
        reads triggers a re-open of the cv2 device — same path the
        ``connect`` action uses. Catches device wedges that don't raise
        but just stop producing frames (V4L2 buffer starvation after
        a fast release+reopen, USB disconnect, etc.). After
        ``_MAX_REOPEN_ATTEMPTS`` consecutive reopens fail to restore
        the stream we give up + leave state.error set so the UI flags
        it; the user can manually Connect to retry.
        """
        assert self._cap is not None
        encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), int(self.config.jpeg_quality)]
        last_state_publish = time.monotonic()
        frame_count = 0
        consecutive_fails = 0
        reopens = 0
        try:
            while not self.is_stopping():
                if self._cap is None:
                    # _reopen_inplace cleared us — bail out so on_stop /
                    # the next on_start cycle can take over.
                    return
                ok, frame = await asyncio.to_thread(self._cap.read)
                if not ok or frame is None:
                    consecutive_fails += 1
                    if consecutive_fails >= self._MAX_CONSECUTIVE_READ_FAILS:
                        reopens += 1
                        if reopens > self._MAX_REOPEN_ATTEMPTS:
                            logger.error(
                                "%s: %d reopens exhausted — giving up; user must reconnect",
                                self.proxy_id, self._MAX_REOPEN_ATTEMPTS,
                            )
                            self._state["error"] = (
                                f"camera stopped producing frames; gave up after "
                                f"{self._MAX_REOPEN_ATTEMPTS} auto-reopen attempts"
                            )
                            self._state["connected"] = False
                            await self._publish_state()
                            return
                        logger.warning(
                            "%s: %d consecutive read failures — reopening capture (attempt %d/%d)",
                            self.proxy_id, consecutive_fails, reopens, self._MAX_REOPEN_ATTEMPTS,
                        )
                        if not await self._reopen_inplace():
                            # reopen itself failed — sleep a bit + let
                            # the next iteration retry. Counters stay so
                            # we still hit the ceiling.
                            await asyncio.sleep(1.0)
                        consecutive_fails = 0
                        continue
                    await asyncio.sleep(0.2)
                    continue
                # Successful read — reset the failure counters.
                if consecutive_fails > 0:
                    consecutive_fails = 0
                    reopens = 0
                # Cache the BGR frame for the snapshot action. Single-
                # reference swap; numpy arrays from cv2.read are fresh
                # buffers so we don't have to copy to avoid aliasing.
                # Stored BEFORE the pipeline so snapshots are raw, not
                # post-filter — analysts usually want the original.
                self._latest_frame = frame
                self._latest_frame_ts = time.time()

                # Run the filter pipeline. Each filter takes BGR uint8
                # in and returns BGR uint8 of the same H×W; a raising
                # filter is logged + skipped so a buggy stage doesn't
                # kill the loop.
                for f in self._filters:
                    try:
                        frame = f.process(frame)
                    except Exception:  # noqa: BLE001
                        logger.exception(
                            "%s: filter %s/%s.process raised — skipping",
                            self.proxy_id, f.type_name, f.id,
                        )
                # Per-filter telemetry publish. Retained so a late
                # subscriber (e.g. a fresh UI tab) sees the latest value
                # without waiting for the next motion event.
                for f in self._filters:
                    if not f.publishes_telemetry:
                        continue
                    try:
                        tel = f.telemetry()
                    except Exception:  # noqa: BLE001
                        logger.exception(
                            "%s: filter %s/%s.telemetry raised", self.proxy_id, f.type_name, f.id,
                        )
                        continue
                    if tel is None:
                        continue
                    await self.publish(f"filter/{f.id}", tel, retained=True)
                # JPEG encode happens on the main loop. cv2.imencode is
                # CPU-bound; for high-res streams move to to_thread.
                ok2, buf = cv2.imencode(".jpg", frame, encode_param)
                if not ok2:
                    continue
                if self._stream is not None:
                    self._stream.push(buf.tobytes())
                frame_count += 1
                now = time.monotonic()
                if now - last_state_publish >= 1.0:
                    self._state["observed_fps"] = round(
                        frame_count / (now - last_state_publish), 2
                    )
                    if self._stream is not None:
                        self._state["dropped"] = self._stream.drop_count
                    await self._publish_state()
                    frame_count = 0
                    last_state_publish = now
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("%s: capture loop crashed", self.proxy_id)
            self._state["error"] = "capture loop crashed"
            await self._publish_state()

    async def _reopen_inplace(self) -> bool:
        """Release + reopen ``self._cap`` from inside the capture loop.

        Distinct from ``_open_capture`` because we don't want to cancel
        the capture task we're running in. Returns True when the new
        cap is open + readable, False otherwise. On False the caller
        keeps incrementing the reopen counter so we eventually give up.

        The small sleep between release + open gives V4L2 time to fully
        reclaim the device; without it the reopen sometimes returns a
        cap that reports isOpened=True but read() yields nothing — the
        exact wedge that motivated this whole path.
        """
        old_cap = self._cap
        self._cap = None
        if old_cap is not None:
            try:
                await asyncio.to_thread(old_cap.release)
            except Exception:  # noqa: BLE001
                logger.exception("%s: cap.release raised during reopen", self.proxy_id)
        # Brief settling time — long enough for V4L2 to finish releasing
        # the device, short enough to feel like a real recovery.
        await asyncio.sleep(0.5)

        source = _coerce_source(self.config.source)
        cap = await asyncio.to_thread(cv2.VideoCapture, source)
        if not cap.isOpened():
            return False
        # Verify with a probe read — isOpened lies on some V4L2 wedges.
        ok, _ = await asyncio.to_thread(cap.read)
        if not ok:
            await asyncio.to_thread(cap.release)
            return False
        # Re-apply the user's requested resolution/fps after the device
        # is back, otherwise the camera reverts to its default mode.
        if self.config.width and self.config.height:
            await asyncio.to_thread(cap.set, cv2.CAP_PROP_FRAME_WIDTH, self.config.width)
            await asyncio.to_thread(cap.set, cv2.CAP_PROP_FRAME_HEIGHT, self.config.height)
        if self.config.fps:
            await asyncio.to_thread(cap.set, cv2.CAP_PROP_FPS, self.config.fps)
        self._cap = cap
        logger.info("%s: capture reopened successfully", self.proxy_id)
        # Clear any prior error so the UI flips back to healthy.
        if self._state.get("error"):
            self._state["error"] = None
            await self._publish_state()
        return True

    # ─── state publish ────────────────────────────────────────────────

    async def _publish_state(self) -> None:
        await self.publish("state", dict(self._state), retained=True)

    # ─── control actions ──────────────────────────────────────────────
    @service_method("connect")
    async def m_connect(self, source: Optional[str] = None) -> None:
        """Open (or re-open) the capture. ``source`` overrides config."""
        if source is not None:
            await self.update_config({"source": source})
        await self._open_capture()

    @service_method("disconnect")
    async def m_disconnect(self) -> None:
        """Release the camera without exiting the service."""
        if self._capture_task is not None:
            self._capture_task.cancel()
            try:
                await self._capture_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            self._capture_task = None
        if self._cap is not None:
            await asyncio.to_thread(self._cap.release)
            self._cap = None
        # Drop the cached frame so a later snapshot doesn't return a
        # stale image from before the disconnect.
        self._latest_frame = None
        self._latest_frame_ts = 0.0
        self._state.update({"connected": False, "error": None})
        await self._publish_state()

    @service_method("set_resolution")
    async def m_set_resolution(self, width: int, height: int) -> None:
        await self.update_config({"width": int(width), "height": int(height)})
        if self._cap is not None:
            await self._open_capture()

    @service_method("snapshot")
    async def m_snapshot(self, request_id: Optional[str] = None) -> None:
        """Publish a single JPEG-encoded frame.

        Twin publish:
          * ``/video/<id>/snapshot``         — event, NOT retained. Each
                                               trigger fires a fresh frame
                                               for consumers waiting on it.
          * ``/video/<id>/latest_snapshot``  — RETAINED. A late subscriber
                                               (OCR service that starts
                                               after the snapshot was
                                               taken) immediately gets the
                                               most recent frame.

        Payload shape::

            {
              "request_id":  "uuid-or-null",
              "ts":          1346800.5,         # frame capture timestamp
              "resolution":  [640, 480],        # [width, height]
              "jpeg_b64":    "...",             # base64 of the JPEG bytes
              "error":       "..."              # only when capture is dead
            }

        ``request_id`` echoes back whatever the caller sent so a UI
        button or scripting client can correlate the response.

        Encode happens here (not the capture loop) so cv2.imencode runs
        on demand instead of every captured frame. For 1080p frames we
        could shunt it to a worker thread; at 480p it's fast enough.
        """
        frame = self._latest_frame
        if frame is None or not self._state.get("connected"):
            err_payload = {
                "request_id": request_id,
                "ts": time.time(),
                "error": "no frame available; capture not connected",
            }
            await self.publish("snapshot", err_payload)
            return

        ok, buf = await asyncio.to_thread(
            cv2.imencode, ".jpg", frame,
            [int(cv2.IMWRITE_JPEG_QUALITY), int(self.config.jpeg_quality)],
        )
        if not ok:
            err_payload = {
                "request_id": request_id,
                "ts": time.time(),
                "error": "cv2.imencode failed",
            }
            await self.publish("snapshot", err_payload)
            return

        payload = {
            "request_id": request_id,
            "ts": self._latest_frame_ts,
            "resolution": [int(frame.shape[1]), int(frame.shape[0])],
            "jpeg_b64": base64.b64encode(buf.tobytes()).decode("ascii"),
        }
        # Publish on both topics. The event topic is what triggered
        # callers wait on (matched by request_id). The retained topic is
        # the "latest snapshot" cache for services that come up later.
        await self.publish("snapshot", payload)
        await self.publish("latest_snapshot", payload, retained=True)

    # ─── filter pipeline ─────────────────────────────────────────────

    def _rebuild_filters(self, specs: List[Dict[str, Any]]) -> None:
        """Replace ``self._filters`` with fresh instances built from
        ``specs``. Called on startup + whenever the persisted
        ``config.filters`` changes. Unknown filter types are silently
        skipped (logged) so a typo in saved config can't crash the
        whole pipeline. ``enabled=False`` entries are still instantiated
        but skipped at process() time by checking the spec — actually
        we just don't include them in the runtime list; the persisted
        config retains them for the UI to re-enable later."""
        new_filters: List[Filter] = []
        for spec in specs or []:
            if not spec.get("enabled", True):
                continue
            f = build_filter(spec)
            if f is None:
                logger.warning("%s: unknown filter spec dropped: %r",
                               self.proxy_id, spec)
                continue
            new_filters.append(f)
        self._filters = new_filters
        # Signature mirrors the input spec list so a subsequent call
        # with identical specs is a no-op (process() sees the same
        # instance, including any subtractor state like motion's
        # background model).
        self._filters_signature = tuple(
            (s.get("id"), s.get("type"), bool(s.get("enabled", True)),
             tuple(sorted((s.get("params") or {}).items())))
            for s in specs or []
        )
        logger.info("%s: pipeline rebuilt — %d active filters: %s",
                    self.proxy_id, len(new_filters),
                    [f.type_name for f in new_filters])

    def _apply_config_state(self, raw: Any) -> None:
        """Hook the config_state replay so a change to ``filters``
        rebuilds the running pipeline without restarting the service."""
        super()._apply_config_state(raw)
        try:
            specs = list(getattr(self.config, "filters", []) or [])
        except Exception:  # noqa: BLE001
            specs = []
        sig = tuple(
            (s.get("id"), s.get("type"), bool(s.get("enabled", True)),
             tuple(sorted((s.get("params") or {}).items())))
            for s in specs
        )
        if sig != self._filters_signature:
            self._rebuild_filters(specs)
            # Republish the persisted filters topic so the UI's list
            # stays in sync with the live pipeline.
            asyncio.create_task(self._publish_filters())

    def _filters_announcement(self) -> List[Dict[str, Any]]:
        """Build the enriched filter list that gets published on
        ``/filters``. Pure function over ``self.config.filters`` + the
        static catalog — same shape used by ``_publish_filters`` for
        the live path AND by the on_start bus.announce factory for
        the reconnect path."""
        specs = list(getattr(self.config, "filters", []) or [])
        # Index the catalog once so per-spec enrichment is O(1).
        cat_by_type = {e["type"]: e for e in filter_catalog()}
        type_root = f"/{self._type_name}/{self.proxy_id}"
        enriched: List[Dict[str, Any]] = []
        for s in specs:
            entry = dict(s)
            cat = cat_by_type.get(s.get("type") or "")
            if cat:
                entry["title"] = cat.get("title")
                publishes = bool(cat.get("publishes_telemetry"))
                entry["publishes_telemetry"] = publishes
                if publishes and s.get("id"):
                    entry["telemetry_topic"] = f"{type_root}/filter/{s['id']}"
            enriched.append(entry)
        return enriched

    async def _publish_filters(self) -> None:
        """Publish the current persisted pipeline (retained). The UI
        treats this as the source of truth for the list shown in the
        FilterPipeline section.

        Each entry is enriched from the filter catalog with discovery
        fields so a downstream consumer doesn't have to cross-reference
        the catalog: ``title`` (human-readable name from the filter
        class), ``publishes_telemetry`` (whether telemetry is published
        on the per-filter retained topic), and ``telemetry_topic`` (the
        full bus path — only set when ``publishes_telemetry`` is true).

        Also maintains a flat global index at ``/filter/index/<id>`` so a
        consumer that doesn't know which video service to subscribe to
        can wildcard ``/filter/index/+`` and learn about every active
        filter across every video service in the federation.
        """
        enriched = self._filters_announcement()
        await self.publish("filters", {"filters": enriched}, retained=True)
        await self._reconcile_filter_index(enriched)

    async def _reconcile_filter_index(self, enriched: List[Dict[str, Any]]) -> None:
        """Diff the previous filter-index publish against ``enriched`` —
        publish a retained discovery entry per newly-present filter that
        emits telemetry, and clear the entry (null retained) for any
        filter that has gone away. Keeps the global ``/filter/index/<id>``
        topic in sync with the live pipeline without re-publishing
        unchanged entries on every reorder/update."""
        new_ids: set = set()
        for s in enriched:
            fid = s.get("id")
            if not fid or not s.get("publishes_telemetry"):
                continue
            new_ids.add(fid)
            await self.bus.publish(
                f"/filter/index/{fid}",
                {
                    "filter_id": fid,
                    "type": s.get("type"),
                    "title": s.get("title"),
                    "video_proxy_id": self.proxy_id,
                    "runtime_id": os.environ.get("ROBOTLAB_X_RUNTIME_ID"),
                    "telemetry_topic": s.get("telemetry_topic"),
                    "enabled": bool(s.get("enabled", True)),
                },
                retained=True,
            )
        # Clear entries for filters that are gone (removed, or no longer
        # publishing telemetry after a type/config change).
        gone = self._filter_index_ids - new_ids
        for fid in gone:
            await self.bus.publish(f"/filter/index/{fid}", None, retained=True)
        self._filter_index_ids = new_ids

    def meta_topics(self) -> Dict[str, str]:
        """Advertise the video-specific topics in the standard meta
        payload. Consumers reading /<type>/<id>/meta now learn the
        filter_catalog + filters topic names without grepping for
        ``filter_catalog`` strings in our source."""
        return {
            "filter_catalog": self.resolve_topic(self.topic("filter_catalog")),
            "filters": self.resolve_topic(self.topic("filters")),
            "snapshot": self.resolve_topic(self.topic("snapshot")),
            "latest_snapshot": self.resolve_topic(self.topic("latest_snapshot")),
        }

    async def _persist_filters(self, specs: List[Dict[str, Any]]) -> None:
        """Update the persisted ``filters`` config + rebuild the running
        pipeline + republish the /filters topic.

        Goes through ``update_config`` so the backend writes the change
        into the proxy row's service_config — every subscriber on
        config_state sees the same new value, and a restart restores
        the same pipeline.
        """
        await self.update_config({"filters": specs})
        self._rebuild_filters(specs)
        await self._publish_filters()

    @service_method("add_filter")
    async def m_add_filter(
        self,
        type: str,
        params: Optional[Dict[str, Any]] = None,
        id: Optional[str] = None,
        position: Optional[int] = None,
    ) -> None:
        """Append (or insert) a filter into the pipeline.

        ``id`` is optional — generated as a uuid4 when missing so the
        UI doesn't have to. ``position`` (0-based) inserts at that
        slot; default is append. Unknown types are rejected with a
        warning (caller can subscribe to /filters and see whether the
        list changed)."""
        if not isinstance(type, str) or not type:
            return
        spec: Dict[str, Any] = {
            "id": id or uuid.uuid4().hex,
            "type": type,
            "enabled": True,
            "params": params or {},
        }
        # Validate before persisting — catches typo'd type names.
        probe = build_filter(spec)
        if probe is None:
            logger.warning("%s: add_filter rejected unknown type=%r", self.proxy_id, type)
            return
        specs = list(getattr(self.config, "filters", []) or [])
        # Idempotent on id — duplicate add (whether from a UI double-
        # click, a network retry, or an underlying bus delivery quirk)
        # must NOT result in two identical filter rows. If the id is
        # already in the pipeline, no-op. Callers that want to patch
        # an existing filter should use update_filter.
        if any(s.get("id") == spec["id"] for s in specs):
            logger.info("%s: add_filter no-op — id=%r already present",
                        self.proxy_id, spec["id"])
            return
        if isinstance(position, int) and 0 <= position <= len(specs):
            specs.insert(position, spec)
        else:
            specs.append(spec)
        await self._persist_filters(specs)

    @service_method("remove_filter")
    async def m_remove_filter(self, id: str) -> None:
        """Drop the filter with this id. Idempotent — unknown id is a no-op."""
        specs = [s for s in (getattr(self.config, "filters", []) or []) if s.get("id") != id]
        # Clear the (now-orphaned) retained telemetry topic so a fresh
        # subscriber doesn't see stale data for a deleted filter.
        await self.publish(f"filter/{id}", None, retained=True)
        await self._persist_filters(specs)

    @service_method("update_filter")
    async def m_update_filter(
        self,
        id: str,
        params: Optional[Dict[str, Any]] = None,
        enabled: Optional[bool] = None,
    ) -> None:
        """Patch one filter's params and/or enabled flag. Other fields
        are immutable (type is the catalog key; id is the address)."""
        specs = list(getattr(self.config, "filters", []) or [])
        updated = False
        for s in specs:
            if s.get("id") != id:
                continue
            if params is not None:
                cur = dict(s.get("params") or {})
                cur.update(params)
                s["params"] = cur
            if enabled is not None:
                s["enabled"] = bool(enabled)
            updated = True
            break
        if updated:
            await self._persist_filters(specs)

    @service_method("reorder_filters")
    async def m_reorder_filters(self, ids: List[str]) -> None:
        """Reorder the pipeline by id. ``ids`` must list exactly the
        same set of filter ids currently in the pipeline; otherwise the
        call is ignored (avoids partial-apply when the UI is out of
        sync with the live state)."""
        current = list(getattr(self.config, "filters", []) or [])
        by_id = {s.get("id"): s for s in current}
        if set(ids) != set(by_id.keys()):
            logger.warning("%s: reorder_filters rejected — id set mismatch", self.proxy_id)
            return
        specs = [by_id[i] for i in ids]
        await self._persist_filters(specs)

    @service_method("set_filters")
    async def m_set_filters(self, filters: List[Dict[str, Any]]) -> None:
        """Replace the pipeline wholesale. Validates each entry —
        unknown types are dropped (the user/UI made an error, but we
        won't poison the persisted config with them). Missing ids are
        filled in."""
        cleaned: List[Dict[str, Any]] = []
        for s in filters or []:
            if not isinstance(s, dict): continue
            t = s.get("type")
            if not isinstance(t, str): continue
            spec = {
                "id": s.get("id") or uuid.uuid4().hex,
                "type": t,
                "enabled": bool(s.get("enabled", True)),
                "params": s.get("params") or {},
            }
            if build_filter(spec) is None:
                continue
            cleaned.append(spec)
        await self._persist_filters(cleaned)
