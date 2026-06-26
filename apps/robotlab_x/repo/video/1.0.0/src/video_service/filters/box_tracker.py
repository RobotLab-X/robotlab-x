"""Box tracker — selectable algorithm (CSRT/KCF/MIL/MOSSE/MedianFlow/TLD).

Second spatial-input filter (after LK optical flow). The user draws a
rectangle on the preview; the chosen tracker locks onto whatever's
inside it and follows it frame-to-frame, reporting the new bbox via
telemetry.

Algorithm trade-offs (rough): CSRT = best accuracy, slowest. KCF =
balanced. MIL = robust to partial occlusion. MOSSE = blazing fast, low
accuracy. MedianFlow = good when motion is smooth + predictable; fails
hard on fast motion. TLD = the "Predator" tracker — long-term tracking
with re-detection, but flaky/noisy in OpenCV's implementation.

CSRT/KCF/MIL live on cv2 directly; MOSSE/MedianFlow/TLD/Boosting are
under cv2.legacy. We hide that difference behind ``_make_tracker``.

Wire shape::

    params: {
      "roi": [x, y, w, h],     // user-drawn rectangle, image pixels
      "algorithm": "CSRT",
      "draw_overlay": true
    }

    telemetry: {
      "tracking": bool,        // true while the tracker is locked
      "algorithm": "CSRT",     // echo for consumer convenience
      "bbox": [x, y, w, h],    // latest bbox, or null when lost
      "lost_at": null          // reserved — frame counter when lost
    }

Re-init happens whenever roi *or* algorithm changes; sending the same
roi+algorithm again is a no-op.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
from pydantic import BaseModel, Field

from .base import Filter, make_param


class BoxTrackerTelemetry(BaseModel):
    """Payload shape published on /video/<vid>/filter/<id> while a
    box_tracker is in the pipeline. ``tracking=false`` + ``bbox=null``
    means the algorithm lost the target — re-draw an ROI on the
    preview to recover."""
    tracking: bool = Field(description="True while the algorithm has a lock on the target.")
    algorithm: str = Field(description="Echo of the algorithm in use (CSRT|KCF|MIL|MOSSE|MedianFlow|TLD).")
    bbox: Optional[List[int]] = Field(default=None, description="[x, y, w, h] current bbox in image pixels (null when lost).")
    lost_at: Optional[float] = Field(default=None, description="Reserved — frame timestamp when last lost.")


# Map of UI-facing algorithm name → (factory callable, "legacy" or "modern")
# Resolved lazily so an import-time missing-symbol on an older OpenCV
# doesn't crash the whole filter registry.
_ALGORITHMS: Tuple[str, ...] = (
    "CSRT", "KCF", "MIL", "MOSSE", "MedianFlow", "TLD",
)


def _make_tracker(algorithm: str):
    """Construct one tracker instance. Falls back to CSRT on any error
    so a typo or missing contrib module degrades gracefully rather than
    blowing up the capture loop."""
    legacy = getattr(cv2, "legacy", None)
    try:
        if algorithm == "CSRT":
            return cv2.TrackerCSRT_create()
        if algorithm == "KCF":
            return cv2.TrackerKCF_create()
        if algorithm == "MIL":
            return cv2.TrackerMIL_create()
        if algorithm == "MOSSE" and legacy is not None:
            return legacy.TrackerMOSSE_create()
        if algorithm == "MedianFlow" and legacy is not None:
            return legacy.TrackerMedianFlow_create()
        if algorithm == "TLD" and legacy is not None:
            return legacy.TrackerTLD_create()
    except Exception:
        pass
    return cv2.TrackerCSRT_create()


class BoxTrackerFilter(Filter):
    type_name = "box_tracker"
    title = "Box Tracker"
    description = (
        "Single-target box tracker. Drag a rectangle on the preview to lock onto "
        "an object; the chosen algorithm follows it frame-to-frame. "
        "CSRT=best accuracy, KCF=balanced, MOSSE=fast, TLD=long-term."
    )
    publishes_telemetry = True
    telemetry_schema = BoxTrackerTelemetry
    param_schema = [
        make_param("roi", "rect", [],
                   label="Tracked region",
                   help="Drag a rectangle on the preview to lock onto an object."),
        make_param("algorithm", "enum", "CSRT",
                   choices=list(_ALGORITHMS),
                   label="Algorithm",
                   help="CSRT=accurate/slow, KCF=balanced, MIL=occlusion-robust, "
                        "MOSSE=fast, MedianFlow=smooth motion, TLD=long-term."),
        make_param("draw_overlay", "bool", True,
                   label="Draw overlay",
                   help="Render the tracked bbox + status onto the output frame."),
    ]

    # Telemetry dedupe: don't republish identical bbox; tolerate small
    # jitter in the tracker's reported coords.
    _BBOX_PX_THRESHOLD = 3

    def __init__(self, id: str, params: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(id, params)
        self._tracker = None
        self._init_signature: tuple = ()
        self._current_bbox: Optional[Tuple[int, int, int, int]] = None
        self._is_tracking: bool = False
        self._last_published: Optional[Dict[str, Any]] = None

    def _parse_roi(self) -> Optional[Tuple[int, int, int, int]]:
        raw = self.params.get("roi") or []
        if not isinstance(raw, (list, tuple)) or len(raw) < 4:
            return None
        try:
            x, y, w, h = int(raw[0]), int(raw[1]), int(raw[2]), int(raw[3])
        except (TypeError, ValueError):
            return None
        if w <= 1 or h <= 1:
            return None
        return (x, y, w, h)

    def _maybe_reinit(self, frame: np.ndarray) -> None:
        """Re-create the tracker if roi or algorithm changed since last
        init. No-op if the user re-sent the same values."""
        roi = self._parse_roi()
        algo = str(self.params.get("algorithm") or "CSRT")
        if algo not in _ALGORITHMS:
            algo = "CSRT"
        sig = (algo, roi)
        if sig == self._init_signature:
            return
        self._init_signature = sig
        if roi is None:
            self._tracker = None
            self._is_tracking = False
            self._current_bbox = None
            return
        H, W = frame.shape[:2]
        x, y, w, h = roi
        # Clamp roi to frame bounds — out-of-bounds bbox is the
        # classic init() failure that returns a blank tracker.
        x = max(0, min(x, W - 2))
        y = max(0, min(y, H - 2))
        w = max(2, min(w, W - x))
        h = max(2, min(h, H - y))
        tracker = _make_tracker(algo)
        # Modern cv2.Tracker* init() returns None (raises on failure);
        # cv2.legacy.Tracker* returns bool. Treat anything other than an
        # explicit False (or a raised exception) as success.
        ok = True
        try:
            ret = tracker.init(frame, (x, y, w, h))
            if ret is False:
                ok = False
        except Exception:
            ok = False
        if ok:
            self._tracker = tracker
            self._is_tracking = True
            self._current_bbox = (x, y, w, h)
        else:
            self._tracker = None
            self._is_tracking = False
            self._current_bbox = None

    def process(self, frame: np.ndarray) -> np.ndarray:
        self._maybe_reinit(frame)
        if self._tracker is None:
            return frame
        try:
            ok, bbox = self._tracker.update(frame)
        except Exception:
            ok, bbox = False, None
        if ok and bbox is not None:
            x, y, w, h = bbox
            self._current_bbox = (int(round(x)), int(round(y)),
                                  int(round(w)), int(round(h)))
            self._is_tracking = True
            if self.params.get("draw_overlay"):
                cx, cy = self._current_bbox[0], self._current_bbox[1]
                cw, ch = self._current_bbox[2], self._current_bbox[3]
                cv2.rectangle(frame, (cx, cy), (cx + cw, cy + ch), (0, 200, 255), 2)
                cv2.putText(frame, str(self.params.get("algorithm") or "CSRT"),
                            (cx, max(15, cy - 6)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 200, 255), 1, cv2.LINE_AA)
        else:
            # Lost the lock — keep the tracker handle so the user can
            # see the failure in telemetry, but flag state as not tracking.
            # User has to re-draw an ROI to recover.
            self._is_tracking = False
            self._current_bbox = None
            if self.params.get("draw_overlay"):
                cv2.putText(frame, "TRACKER LOST",
                            (10, 25),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2, cv2.LINE_AA)
        return frame

    def telemetry(self) -> Optional[Dict[str, Any]]:
        algo = str(self.params.get("algorithm") or "CSRT")
        current: Dict[str, Any] = {
            "tracking": self._is_tracking,
            "algorithm": algo,
            "bbox": list(self._current_bbox) if self._current_bbox else None,
            "lost_at": None,
        }
        last = self._last_published
        if last is None:
            self._last_published = _shallow_copy(current)
            return dict(current)
        # State transition is always a publish (tracking <-> lost,
        # algorithm change).
        if (current["tracking"] != last["tracking"]
                or current["algorithm"] != last["algorithm"]):
            self._last_published = _shallow_copy(current)
            return dict(current)
        # Both not-tracking — nothing to say.
        if not current["tracking"]:
            return None
        # Both tracking — dedupe on bbox movement.
        cb = current["bbox"] or [0, 0, 0, 0]
        lb = last["bbox"] or [0, 0, 0, 0]
        if len(cb) != 4 or len(lb) != 4:
            self._last_published = _shallow_copy(current)
            return dict(current)
        moved_sq = sum((cb[i] - lb[i]) ** 2 for i in range(4))
        if moved_sq > self._BBOX_PX_THRESHOLD * self._BBOX_PX_THRESHOLD * 4:
            self._last_published = _shallow_copy(current)
            return dict(current)
        return None


def _shallow_copy(t: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "tracking": t["tracking"],
        "algorithm": t["algorithm"],
        "bbox": list(t["bbox"]) if t["bbox"] is not None else None,
        "lost_at": t["lost_at"],
    }
