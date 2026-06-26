"""Haar-cascade face detection.

Uses the frontal-face cascade shipped with opencv-python — no extra
download required. Performance is fine on a CPU at 640×480; for HD
input you'll want to feed this filter from a ``pyramid_down`` stage.

Publishes a telemetry dict consumers can react to::

    {"count": int,
     "faces": [[x, y, w, h], ...]}

Like the motion filter, this dedupes — re-publishes only on a count
change or on significant face movement.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
from pydantic import BaseModel, Field

from .base import Filter, make_param


class FaceDetectTelemetry(BaseModel):
    """Payload shape published on /video/<vid>/filter/<id> while
    face_detect is in the pipeline."""
    count: int = Field(description="Number of faces detected in the last processed frame.")
    faces: List[List[int]] = Field(description="List of [x, y, w, h] bounding boxes, one per face.")


class FaceDetectFilter(Filter):
    type_name = "face_detect"
    title = "Face Detection"
    description = "Detect frontal faces via Haar cascade. Publishes count + bounding boxes on its telemetry topic."
    publishes_telemetry = True
    telemetry_schema = FaceDetectTelemetry
    param_schema = [
        make_param("scale_factor", "float", 1.1, min=1.05, max=2.0, step=0.05,
                   label="Scale factor",
                   help="How much the image is scaled at each pyramid level. Higher = faster + coarser."),
        make_param("min_neighbors", "int", 5, min=1, max=10, step=1,
                   label="Min neighbors",
                   help="Higher = fewer false positives but misses some faces."),
        make_param("min_size", "int", 30, min=10, max=300, step=5,
                   label="Min face size (px)",
                   help="Ignore detections smaller than this."),
        make_param("draw_overlay", "bool", True,
                   label="Draw overlay"),
    ]

    # Pixel threshold for "did this face move enough to be worth a
    # republish?". Same idea as the motion filter's dedupe; centroid
    # of each face is what we compare.
    _FACE_PX_THRESHOLD = 8

    def __init__(self, id: str, params: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(id, params)
        # Cascade load is cheap (~30KB XML). One classifier per filter
        # instance; cv2 reuses internal state across detect calls so
        # this is the right shape.
        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        self._cascade = cv2.CascadeClassifier(cascade_path)
        if self._cascade.empty():
            # Path differs across opencv builds; fall back to letting
            # detectMultiScale raise loudly on the first frame. This
            # surfaces as an exception in the capture loop's logger.
            pass
        self._last_telemetry: Dict[str, Any] = {"count": 0, "faces": []}
        self._last_published: Optional[Dict[str, Any]] = None

    def process(self, frame: np.ndarray) -> np.ndarray:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        min_size = int(self.params["min_size"])
        faces = self._cascade.detectMultiScale(
            gray,
            scaleFactor=float(self.params["scale_factor"]),
            minNeighbors=int(self.params["min_neighbors"]),
            minSize=(min_size, min_size),
        )
        # detectMultiScale returns either an empty tuple or an ndarray.
        face_list: List[List[int]] = (
            [[int(x), int(y), int(w), int(h)] for (x, y, w, h) in faces]
            if len(faces) else []
        )
        self._last_telemetry = {"count": len(face_list), "faces": face_list}
        if self.params.get("draw_overlay"):
            for x, y, w, h in face_list:
                cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 220, 220), 2)
        return frame

    def telemetry(self) -> Optional[Dict[str, Any]]:
        current = self._last_telemetry
        last = self._last_published

        # Seed the retained topic on the first call.
        if last is None:
            self._last_published = {"count": current["count"], "faces": list(current["faces"])}
            return dict(current)

        # Count change is always an event (someone entered / left).
        if current["count"] != last["count"]:
            self._last_published = {"count": current["count"], "faces": list(current["faces"])}
            return dict(current)

        # No faces in either frame → nothing to say.
        if current["count"] == 0:
            return None

        # Same count — only publish when a face's centroid moved
        # appreciably. We pair faces by sorted-x order (cheap; for the
        # 95% case of 1–3 faces this is robust). For larger crowds a
        # Hungarian match would be better but isn't worth the cost.
        cur_centroids = _centroids_sorted(current["faces"])
        last_centroids = _centroids_sorted(last["faces"])
        moved = False
        for (cx, cy), (lx, ly) in zip(cur_centroids, last_centroids):
            dx, dy = cx - lx, cy - ly
            if dx * dx + dy * dy > self._FACE_PX_THRESHOLD * self._FACE_PX_THRESHOLD:
                moved = True
                break
        if moved:
            self._last_published = {"count": current["count"], "faces": list(current["faces"])}
            return dict(current)
        return None


def _centroids_sorted(faces: List[List[int]]) -> List[Tuple[int, int]]:
    cs = [(x + w // 2, y + h // 2) for (x, y, w, h) in faces]
    cs.sort()
    return cs
