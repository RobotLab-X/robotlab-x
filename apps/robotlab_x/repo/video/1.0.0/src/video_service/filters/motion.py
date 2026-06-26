"""Motion detection via background subtraction (MOG2).

Maintains an internal background model + emits both a visual overlay
on the output frame AND a telemetry dict consumers can react to:

    {"detected": bool,
     "area": int,             # pixels in the largest contour
     "centroid": [x, y],      # of the largest contour
     "bbox": [x, y, w, h]}    # axis-aligned bbox

Other services (alarm, recorder, notifier) can subscribe to this
filter's telemetry topic and trigger on ``detected: true`` without
needing to touch frame data themselves.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import cv2
import numpy as np
from pydantic import BaseModel, Field

from .base import Filter, make_param


class MotionTelemetry(BaseModel):
    """Telemetry payload shape published on /video/<vid>/filter/<id>
    when this filter is in the pipeline. Consumers read this schema
    from /video/<vid>/filter_catalog so they don't have to subscribe
    blind."""
    detected: bool = Field(description="True when at least one contour exceeds min_area.")
    area: int = Field(description="Pixel area of the largest detected contour.")
    centroid: Optional[List[int]] = Field(default=None, description="[x, y] centroid of the largest contour (null when not detected).")
    bbox: Optional[List[int]] = Field(default=None, description="[x, y, w, h] axis-aligned bounding box (null when not detected).")


class MotionFilter(Filter):
    type_name = "motion"
    title = "Motion Detection"
    description = "Detect movement using MOG2 background subtraction. Publishes detected/centroid/area on its telemetry topic."
    publishes_telemetry = True
    telemetry_schema = MotionTelemetry
    param_schema = [
        make_param("history", "int", 200, min=10, max=2000, step=10,
                   label="History (frames)",
                   help="How many recent frames the background model averages over. Higher = slower adaptation."),
        make_param("var_threshold", "int", 16, min=4, max=200, step=1,
                   label="Variance threshold",
                   help="Lower = more sensitive to small changes."),
        make_param("min_area", "int", 500, min=10, max=50000, step=10,
                   label="Min area (px)",
                   help="Ignore contours smaller than this — kills sensor noise + leaves."),
        make_param("draw_overlay", "bool", True,
                   label="Draw overlay",
                   help="Render the bbox + centroid onto the output frame."),
    ]

    # Telemetry dedupe thresholds. Below these, two frames are
    # considered "essentially identical" and the filter skips
    # publishing — keeps the bus quiet during steady-state motion as
    # well as steady-state idle. Tunable, but the defaults match human
    # perception: 4 pixels is barely visible, 10% area change is
    # subtle. Larger thresholds = fewer publishes but coarser tracking.
    _CENTROID_PX_THRESHOLD = 4
    _AREA_REL_THRESHOLD = 0.10  # 10%
    _AREA_ABS_THRESHOLD = 50    # always-publish floor for tiny objects

    def __init__(self, id: str, params: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(id, params)
        # Background subtractor holds state (the running background
        # model); MUST live across process() calls. Re-built only on
        # param change — see _maybe_rebuild_subtractor.
        self._mog: Optional[cv2.BackgroundSubtractorMOG2] = None
        self._last_telemetry: Dict[str, Any] = {
            "detected": False,
            "area": 0,
            "centroid": None,
            "bbox": None,
        }
        # Last telemetry that was actually PUBLISHED (vs. last computed).
        # None means "never published" — first call always publishes so
        # the retained topic gets seeded. Distinct from _last_telemetry
        # because dedupe is about what consumers have SEEN, not what we
        # computed for the frame.
        self._last_published: Optional[Dict[str, Any]] = None
        # Used to detect a param change that requires rebuilding the
        # subtractor (history + var_threshold are constructor args, not
        # mutable on the existing instance).
        self._subtractor_signature: tuple = ()

    def _maybe_rebuild_subtractor(self) -> None:
        sig = (int(self.params["history"]), int(self.params["var_threshold"]))
        if self._mog is not None and sig == self._subtractor_signature:
            return
        self._mog = cv2.createBackgroundSubtractorMOG2(
            history=sig[0],
            varThreshold=sig[1],
            detectShadows=False,  # shadow output is gray; we want a clean binary mask.
        )
        self._subtractor_signature = sig

    def process(self, frame: np.ndarray) -> np.ndarray:
        self._maybe_rebuild_subtractor()
        assert self._mog is not None
        mask = self._mog.apply(frame)
        # Clean up speckle noise + connect blobs so contours don't
        # fragment one moving object into ten separate detections.
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN,
                                cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        min_area = int(self.params["min_area"])
        # Pick the largest contour that exceeds the threshold.
        biggest = None
        biggest_area = 0
        for c in contours:
            a = int(cv2.contourArea(c))
            if a < min_area: continue
            if a > biggest_area:
                biggest_area = a
                biggest = c
        if biggest is not None:
            M = cv2.moments(biggest)
            cx = int(M["m10"] / M["m00"]) if M["m00"] else 0
            cy = int(M["m01"] / M["m00"]) if M["m00"] else 0
            x, y, w, h = cv2.boundingRect(biggest)
            self._last_telemetry = {
                "detected": True,
                "area": biggest_area,
                "centroid": [cx, cy],
                "bbox": [int(x), int(y), int(w), int(h)],
            }
            if self.params.get("draw_overlay"):
                cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)
                cv2.circle(frame, (cx, cy), 5, (0, 255, 255), -1)
        else:
            self._last_telemetry = {
                "detected": False,
                "area": 0,
                "centroid": None,
                "bbox": None,
            }
        return frame

    def telemetry(self) -> Optional[Dict[str, Any]]:
        """Return the current telemetry — but ONLY when it materially
        differs from what we last published.

        The framework's publish path treats ``None`` as "skip" so this
        keeps the bus quiet during both:
          * steady idle (every frame returns the same not-detected
            payload — only the first becomes a publish)
          * steady detection of a stationary object (centroid + area
            within tolerance — no republish)

        Always publishes on a ``detected`` transition (idle → motion
        or motion → idle), or on the first call after instantiation so
        the retained topic gets a real value rather than waiting for
        the first detection.
        """
        current = self._last_telemetry
        last = self._last_published

        # First publish after instantiation/restart — seed the retained
        # topic so a fresh subscriber doesn't see an empty payload.
        if last is None:
            self._last_published = dict(current)
            return dict(current)

        # detected transition is always a publish — that's the event
        # downstream consumers (recorder, alarm) care about most.
        if current["detected"] != last["detected"]:
            self._last_published = dict(current)
            return dict(current)

        # Same detected state. If both False, nothing's worth saying.
        if not current["detected"]:
            return None

        # Both True — publish only when the values moved enough to
        # matter. Centroid distance (Euclidean) + area change (relative
        # or absolute floor) decide.
        cx, cy = current["centroid"]
        lx, ly = last["centroid"]
        dx, dy = cx - lx, cy - ly
        centroid_dist_sq = dx * dx + dy * dy
        if centroid_dist_sq > self._CENTROID_PX_THRESHOLD * self._CENTROID_PX_THRESHOLD:
            self._last_published = dict(current)
            return dict(current)

        last_area = last["area"] or 1
        area_change = abs(current["area"] - last["area"])
        if (area_change >= self._AREA_ABS_THRESHOLD
                and area_change / last_area >= self._AREA_REL_THRESHOLD):
            self._last_published = dict(current)
            return dict(current)

        # Below all thresholds — skip the publish.
        return None
