"""YOLOv8 / YOLO11 object detection filter.

Wraps the ``ultralytics`` package. Model file (e.g. ``yolov8n.pt``)
auto-downloads from the Ultralytics model hub on first use and is
cached under ``~/.config/Ultralytics/`` or the current working dir —
no manual placement.

Performance — YOLO inference is ~100× more expensive than every other
filter in this library. To stay realtime on CPU:

  * ``stride`` (default 3) controls inference cadence. Every Nth
    frame runs the network; non-inference frames reuse the previous
    detection list (redrawn at the last bbox positions, no
    re-publish).
  * ``max_detections`` caps Ultralytics' NMS output.
  * The nano variants (``yolov8n.pt``, ``yolo11n.pt``, ~6 MB) clear
    30 fps on a recent desktop CPU; small needs GPU or stride ≥ 5;
    medium/large/xl need a GPU.

Swappable model selection: change the ``model`` enum (or set
``custom_model_path`` to a path) at runtime via the UI's filter
card. Weight loading runs on a BACKGROUND THREAD so the capture
loop never blocks waiting for a first-time download — during the
load the filter publishes ``status: "loading"`` and keeps using
the previous model's detections (or draws a "loading…" overlay if
this is the first model load). When the load finishes the next
inference uses the new model and ``status`` flips back to
``"ready"``.

Telemetry on /video/<vid>/filter/<id> republishes on:

  * detection count change, OR
  * class composition change, OR
  * any bbox centroid moved more than 16 px, OR
  * model swap status changed (loading / ready / error).
"""
from __future__ import annotations

import logging
import os
import threading
from typing import Any, ClassVar, Dict, List, Optional, Tuple

import cv2
import numpy as np
from pydantic import BaseModel, Field

from .base import Filter, make_param


logger = logging.getLogger(__name__)


class YoloDetection(BaseModel):
    """One bounding-box detection in the YOLO telemetry payload."""
    class_id: int = Field(description="COCO class id (0..79 for the default yolov8 weights).")
    class_name: str = Field(description="Human-readable class label (e.g. 'person', 'car').")
    confidence: float = Field(description="Detector confidence in [0, 1] after NMS.")
    bbox: List[int] = Field(description="Bounding box as [x, y, w, h] in image-pixel space.")


class YoloTelemetry(BaseModel):
    """Payload shape published on /video/<vid>/filter/<id> while yolo
    is in the pipeline."""
    count: int = Field(description="Number of detections in the last inference frame.")
    classes: List[str] = Field(description="Sorted unique list of detected class names.")
    detections: List[YoloDetection] = Field(description="One entry per detection — class + confidence + bbox.")
    model: str = Field(description="Weights file currently loaded (e.g. 'yolov8n.pt') OR the custom path.")
    stride: int = Field(description="Inference stride: 1 means every frame, N means every Nth frame.")
    status: str = Field(description="ready | loading | error — see ``status_message`` for the loading target or error text.")
    status_message: str = Field(default="", description="Free-text status detail. Empty when status='ready'.")


# Movement threshold in PIXELS — centroids that shift by less than
# this between inference frames don't trigger a republish. ``16`` is
# generous (matches FaceDetect's 8 but scaled for the larger boxes
# YOLO tends to produce on indoor scenes).
_MOVEMENT_THRESHOLD_PX = 16

# Cache loaded YOLO models so multiple filter instances of the same
# model share weights. The ultralytics loader is slow + the model
# tensors are 6–80 MB; one copy is plenty. Keyed by the resolved
# model identifier (enum value or custom path).
_MODEL_CACHE: Dict[str, Any] = {}
_MODEL_CACHE_LOCK = threading.Lock()


# Built-in model presets. Keys are the values stored in the ``model``
# param; the dropdown displays the keys verbatim. The Ultralytics hub
# resolves these strings as model names — paths with a "/" are
# treated as filesystem paths instead.
_BUILTIN_MODELS = [
    "yolov8n.pt",   # nano  — ~6 MB, ~30 fps CPU
    "yolov8s.pt",   # small — ~22 MB, ~15 fps CPU
    "yolov8m.pt",   # medium — needs GPU for realtime
    "yolov8l.pt",   # large — GPU
    "yolov8x.pt",   # xlarge — GPU
    "yolo11n.pt",   # YOLO11 nano (newer architecture, similar speed)
    "yolo11s.pt",   # YOLO11 small
    "yolo11m.pt",   # YOLO11 medium
    "yolo11l.pt",   # YOLO11 large
    "yolo11x.pt",   # YOLO11 xlarge
]


def _load_model_sync(weights: str) -> Any:
    """Blocking model load — used inside the background-thread
    worker. Raises a useful RuntimeError if ``ultralytics`` isn't
    installed."""
    with _MODEL_CACHE_LOCK:
        if weights in _MODEL_CACHE:
            return _MODEL_CACHE[weights]
    # Import outside the lock so a slow ultralytics import doesn't
    # serialise every other filter instance trying to load.
    try:
        from ultralytics import YOLO  # noqa: WPS433
    except ImportError as exc:
        raise RuntimeError(
            "ultralytics not installed — `pip install ultralytics` "
            "into the video service's venv "
            "(repo/video/1.0.0/.venv/bin/pip install ultralytics) "
            "then restart the video subprocess."
        ) from exc
    logger.info("yolo: loading %s (first-load downloads weights if missing)", weights)
    model = YOLO(weights)
    with _MODEL_CACHE_LOCK:
        _MODEL_CACHE[weights] = model
    return model


class YoloFilter(Filter):
    type_name: ClassVar[str] = "yolo"
    title: ClassVar[str] = "YOLO Object Detection"
    description: ClassVar[str] = (
        "Run YOLOv8 / YOLO11 inference on each Nth frame; publish "
        "class+bbox detections on the filter's telemetry topic. "
        "Models swap hot — change the dropdown (or set a custom "
        "path) and the next inference reloads."
    )
    publishes_telemetry: ClassVar[bool] = True
    telemetry_schema: ClassVar[Optional[Any]] = YoloTelemetry
    param_schema: ClassVar[List[Dict[str, Any]]] = [
        make_param(
            "model", "enum", "yolov8n.pt",
            choices=list(_BUILTIN_MODELS),
            label="Model",
            help=(
                "Built-in YOLO variants. Nano (~6 MB) ≈ 30 fps CPU; "
                "small (~22 MB) needs a GPU or stride ≥ 5; medium and "
                "above need a GPU. Set ``Custom model path`` below to "
                "override with a fine-tuned .pt or .onnx file."
            ),
        ),
        make_param(
            "custom_model_path", "string", "",
            label="Custom model path",
            placeholder="/path/to/best.pt — leave empty to use Model above",
            help=(
                "Absolute path to a .pt (PyTorch) or .onnx (exported) "
                "model. When non-empty this OVERRIDES the Model "
                "dropdown — useful for fine-tuned weights or models "
                "not in the built-in list."
            ),
        ),
        make_param(
            "conf_threshold", "float", 0.25, min=0.05, max=0.95, step=0.05,
            label="Confidence threshold",
            help="Drop detections below this. Lower = more boxes, more false positives.",
        ),
        make_param(
            "iou_threshold", "float", 0.45, min=0.1, max=0.9, step=0.05,
            label="NMS IoU threshold",
            help="Non-max suppression overlap. Lower = more aggressive de-duplication.",
        ),
        make_param(
            "stride", "int", 3, min=1, max=30, step=1,
            label="Inference stride",
            help="Run YOLO every Nth frame; intermediate frames redraw the last detections (no republish).",
        ),
        make_param(
            "max_detections", "int", 20, min=1, max=100, step=1,
            label="Max detections",
            help="Hard cap on detections per frame after NMS.",
        ),
        make_param(
            "classes_filter", "string", "",
            label="Class filter",
            placeholder="person,car  (empty = all 80 COCO classes)",
            help=(
                "Comma-separated class names to keep in telemetry "
                "(case-insensitive). Applied at telemetry time, so "
                "you can change it live without re-running inference. "
                "The visible overlay always shows all detections."
            ),
        ),
        make_param("draw_overlay", "bool", True, label="Draw overlay"),
    ]

    def __init__(self, id: str, params: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(id, params)
        # ``_model`` is the *currently inference-ready* YOLO object.
        # ``_loaded_for`` is the resolved model id (path or hub name)
        # it was loaded for — operator-driven swaps compare against
        # this to decide whether a reload is needed.
        self._model: Optional[Any] = None
        self._loaded_for: Optional[str] = None
        # Tracks an in-flight background load. ``_loading_for`` is the
        # target model id; ``None`` means no load is running. Reads
        # from process() are racy but we only use it for status
        # display; the actual model swap reads ``_pending_model``
        # under ``_load_lock``.
        self._loading_for: Optional[str] = None
        self._load_error: Optional[str] = None
        self._pending_model: Optional[Any] = None
        self._load_lock = threading.Lock()
        self._frame_idx: int = 0
        self._last_detections: List[Dict[str, Any]] = []
        self._last_published: Optional[Dict[str, Any]] = None

    # ─── model resolution + background loading ────────────────────────

    def _resolved_model_id(self) -> str:
        """Custom path takes precedence when non-empty; otherwise the
        enum value. Trimmed so trailing whitespace doesn't create a
        phantom new model id."""
        custom = str(self.params.get("custom_model_path") or "").strip()
        if custom:
            return custom
        return str(self.params.get("model") or "yolov8n.pt")

    def _ensure_model(self) -> Optional[Any]:
        """Promote ``_pending_model`` to ``_model`` when ready;
        otherwise kick off a background load. Returns the
        inference-ready model or ``None`` while a load is in flight."""
        wanted = self._resolved_model_id()

        # Already loaded for the requested model — fast path.
        if self._model is not None and self._loaded_for == wanted:
            return self._model

        # Background load completed since the last process() — promote.
        with self._load_lock:
            if self._pending_model is not None and self._loading_for == wanted:
                self._model = self._pending_model
                self._loaded_for = wanted
                self._pending_model = None
                self._loading_for = None
                self._load_error = None
                logger.info("yolo: hot-swapped to %s", wanted)
                return self._model
            if self._loading_for is not None and self._loading_for != wanted:
                # Operator changed the target mid-load. Cancel the
                # tracking state; the worker thread will finish, write
                # into ``_pending_model``, but next ``_ensure_model``
                # will see the mismatch and discard the pending model
                # (it'll still sit in the module cache for next time).
                logger.info("yolo: load target changed %s → %s", self._loading_for, wanted)
                self._loading_for = None
                self._pending_model = None

            # No load in flight + model not loaded → spawn a worker.
            if self._loading_for is None:
                self._loading_for = wanted
                self._load_error = None
                threading.Thread(
                    target=self._background_load,
                    args=(wanted,),
                    name=f"yolo-load-{self.id}",
                    daemon=True,
                ).start()

        return self._model  # may be None on the very first load

    def _background_load(self, target: str) -> None:
        """Worker thread: blocking ``_load_model_sync`` then publishes
        the result into ``_pending_model``. Errors are caught + the
        message surfaced via ``_load_error`` for the overlay + the
        telemetry status field."""
        try:
            model = _load_model_sync(target)
        except Exception as exc:  # noqa: BLE001
            logger.exception("yolo: background load failed for %s", target)
            with self._load_lock:
                # Only record if this is still the target the operator
                # cares about — a stale failure on an abandoned model
                # would otherwise smear across to the new target.
                if self._loading_for == target:
                    self._load_error = str(exc)
                    self._loading_for = None
                    self._pending_model = None
            return
        with self._load_lock:
            if self._loading_for == target:
                self._pending_model = model

    # ─── inference path ───────────────────────────────────────────────

    def _classes_filter_set(self) -> Optional[set]:
        raw = str(self.params.get("classes_filter") or "").strip()
        if not raw:
            return None
        return {p.strip().lower() for p in raw.split(",") if p.strip()}

    def process(self, frame: np.ndarray) -> np.ndarray:
        self._frame_idx += 1
        model = self._ensure_model()
        stride = max(1, int(self.params.get("stride") or 1))
        should_infer = (
            model is not None
            and ((self._frame_idx % stride) == 0 or not self._last_detections)
        )

        if should_infer:
            try:
                results = model.predict(
                    frame,
                    conf=float(self.params.get("conf_threshold") or 0.25),
                    iou=float(self.params.get("iou_threshold") or 0.45),
                    max_det=int(self.params.get("max_detections") or 20),
                    verbose=False,
                )
            except Exception:  # noqa: BLE001
                logger.exception("yolo: inference failed")
                return frame
            self._last_detections = self._unpack_results(results, model)

        # Visual status overlay — only shown while a load is in flight
        # (model is None) OR a load just failed. Once ``_model`` is
        # populated normal detection overlays take over.
        if model is None:
            self._draw_status_overlay(frame)
        elif self.params.get("draw_overlay"):
            self._draw_detections(frame, self._last_detections)
        return frame

    @staticmethod
    def _unpack_results(results: Any, model: Any) -> List[Dict[str, Any]]:
        if not results:
            return []
        r = results[0]
        boxes = getattr(r, "boxes", None)
        if boxes is None or len(boxes) == 0:
            return []
        names = getattr(model, "names", {}) or {}
        out: List[Dict[str, Any]] = []
        xyxy = boxes.xyxy.cpu().numpy() if hasattr(boxes.xyxy, "cpu") else np.asarray(boxes.xyxy)
        conf = boxes.conf.cpu().numpy() if hasattr(boxes.conf, "cpu") else np.asarray(boxes.conf)
        cls = boxes.cls.cpu().numpy() if hasattr(boxes.cls, "cpu") else np.asarray(boxes.cls)
        for i in range(len(boxes)):
            x1, y1, x2, y2 = (int(v) for v in xyxy[i])
            class_id = int(cls[i])
            out.append({
                "class_id": class_id,
                "class_name": str(names.get(class_id, str(class_id))),
                "confidence": float(conf[i]),
                "bbox": [x1, y1, max(0, x2 - x1), max(0, y2 - y1)],
            })
        return out

    def _draw_status_overlay(self, frame: np.ndarray) -> None:
        """Paint a brief loading/error line at the top of the frame.
        Only triggers while ``_model`` is None — i.e. on the very
        first load. Hot-swaps reuse the previous model's detections
        until the new one is ready, so the overlay stays clean."""
        if self._load_error:
            msg = f"YOLO error: {self._load_error[:80]}"
            colour = (0, 0, 255)
        elif self._loading_for:
            msg = f"YOLO loading {os.path.basename(self._loading_for)}…"
            colour = (0, 220, 220)
        else:
            return
        cv2.putText(
            frame, msg, (8, 24), cv2.FONT_HERSHEY_SIMPLEX,
            0.55, colour, 1, cv2.LINE_AA,
        )

    @staticmethod
    def _draw_detections(frame: np.ndarray, dets: List[Dict[str, Any]]) -> None:
        for d in dets:
            x, y, w, h = d["bbox"]
            cv2.rectangle(frame, (x, y), (x + w, y + h), (60, 220, 100), 2)
            label = f"{d['class_name']} {d['confidence']:.2f}"
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            cv2.rectangle(
                frame, (x, max(0, y - th - 4)), (x + tw + 4, y),
                (60, 220, 100), -1,
            )
            cv2.putText(
                frame, label, (x + 2, max(th, y - 2)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1, cv2.LINE_AA,
            )

    # ─── telemetry ────────────────────────────────────────────────────

    def _current_status(self) -> Tuple[str, str]:
        """Return (status, message) tuple. ``ready`` is the steady
        state; ``loading`` whenever a swap is in flight; ``error``
        when the most recent load failed."""
        wanted = self._resolved_model_id()
        with self._load_lock:
            if self._load_error and self._loaded_for != wanted:
                return ("error", self._load_error)
            if self._loading_for is not None:
                return ("loading", self._loading_for)
        if self._model is None:
            # Initial state before the first ensure_model call has even
            # kicked off a load — shouldn't last more than one frame
            # in practice but report it honestly.
            return ("loading", wanted)
        return ("ready", "")

    def telemetry(self) -> Optional[Dict[str, Any]]:
        keep = self._classes_filter_set()
        if keep is not None:
            filtered = [d for d in self._last_detections if d["class_name"].lower() in keep]
        else:
            filtered = self._last_detections

        status, status_message = self._current_status()
        current = {
            "count": len(filtered),
            "classes": sorted({d["class_name"] for d in filtered}),
            "detections": list(filtered),
            "model": self._loaded_for or self._resolved_model_id(),
            "stride": int(self.params.get("stride") or 1),
            "status": status,
            "status_message": status_message,
        }

        last = self._last_published
        if last is None:
            self._last_published = _snapshot(current)
            return current

        # Status transitions are always events — the UI relies on
        # this to flip the filter card's loading/ready badge.
        if current["status"] != last.get("status") or current["model"] != last.get("model"):
            self._last_published = _snapshot(current)
            return current

        if current["count"] != last["count"]:
            self._last_published = _snapshot(current)
            return current
        if current["classes"] != last["classes"]:
            self._last_published = _snapshot(current)
            return current
        if current["count"] == 0:
            return None

        cur_centroids = _centroids_sorted(current["detections"])
        last_centroids = _centroids_sorted(last["detections"])
        moved = False
        for (cx, cy), (lx, ly) in zip(cur_centroids, last_centroids):
            dx, dy = cx - lx, cy - ly
            if dx * dx + dy * dy > _MOVEMENT_THRESHOLD_PX * _MOVEMENT_THRESHOLD_PX:
                moved = True
                break
        if moved:
            self._last_published = _snapshot(current)
            return current
        return None


def _snapshot(t: Dict[str, Any]) -> Dict[str, Any]:
    """Defensive deep-ish copy so the cached ``_last_published`` is
    invariant to mutations on the next inference round."""
    return {
        "count": t["count"],
        "classes": list(t["classes"]),
        "detections": [dict(d) for d in t["detections"]],
        "model": t["model"],
        "stride": t["stride"],
        "status": t["status"],
        "status_message": t["status_message"],
    }


def _centroids_sorted(detections: List[Dict[str, Any]]) -> List[Tuple[int, int]]:
    cs: List[Tuple[int, int]] = []
    for d in detections:
        x, y, w, h = d["bbox"]
        cs.append((x + w // 2, y + h // 2))
    cs.sort()
    return cs
