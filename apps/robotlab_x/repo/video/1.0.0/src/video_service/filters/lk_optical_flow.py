"""Lucas-Kanade optical flow — track user-specified points.

The first robotlab_x filter that takes spatial input from the UI. The
user designates points on the video preview by clicking; those become
the seed_points param. Each subsequent frame this filter runs
``cv2.calcOpticalFlowPyrLK`` to find where each point moved. Points
that LK can't track (occluded, fast motion, out-of-frame) are dropped.

The seed parameter (``seed_points``) is the user's input. The live
state (``tracked_points``) is published via telemetry so consumers can
react — e.g. an arm-control service subscribing to the tracked point
of a target.

Wire shape::

    params: {
      "seed_points": [[x, y], [x, y], ...],  // user-picked
      "max_points": 20,
      "win_size": 21,
      "draw_overlay": true
    }

    telemetry: {
      "tracking": int,                 // currently tracked count
      "seeded": int,                   // originally seeded count
      "points": [[x, y], ...],         // current positions of tracked points
      "lost": int                      // dropped since seeding
    }

Tracking resets when seed_points changes — re-clicking on the preview
re-seeds the tracker without restarting the service.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import cv2
import numpy as np
from pydantic import BaseModel, Field

from .base import Filter, make_param


class LKOpticalFlowTelemetry(BaseModel):
    """Payload shape published on /video/<vid>/filter/<id> while
    lk_optical_flow is in the pipeline."""
    tracking: int = Field(description="Number of points the tracker currently has a lock on.")
    seeded: int = Field(description="Number of points originally seeded by the user.")
    points: List[List[int]] = Field(description="Current [x, y] positions of every tracked point.")
    lost: int = Field(description="Points dropped since the last reseed (occlusion, fast motion, out-of-frame).")


class LKOpticalFlowFilter(Filter):
    type_name = "lk_optical_flow"
    title = "Track Points (LK)"
    description = "Lucas-Kanade pyramidal optical flow. Click points on the preview to designate targets; the filter tracks each one frame-to-frame."
    publishes_telemetry = True
    telemetry_schema = LKOpticalFlowTelemetry
    param_schema = [
        make_param("seed_points", "points", [],
                   label="Tracked points",
                   help="Click on the preview to add points to track."),
        make_param("max_points", "int", 20, min=1, max=100, step=1,
                   label="Max points",
                   help="Cap on simultaneous tracked points."),
        make_param("win_size", "int", 21, min=5, max=51, step=2,
                   label="Window size",
                   help="Search window. Larger = more robust to fast motion, slower."),
        make_param("max_level", "int", 3, min=0, max=5, step=1,
                   label="Pyramid levels",
                   help="More levels = better coarse-to-fine search, slower."),
        make_param("draw_overlay", "bool", True,
                   label="Draw overlay",
                   help="Render markers + traces on the output frame."),
    ]

    # Match the motion filter's dedupe pattern — only publish telemetry
    # when something materially changed. For point tracking that means
    # count change OR an average point movement above this threshold.
    _PT_PX_THRESHOLD = 3

    def __init__(self, id: str, params: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(id, params)
        # Tracker state.
        self._prev_gray: Optional[np.ndarray] = None
        # Currently tracked positions (Nx1x2 float32 — LK's wire shape).
        # None until seeded.
        self._tracking: Optional[np.ndarray] = None
        # How many points the user originally seeded — useful for the
        # consumer to compute a "still tracking" ratio.
        self._seeded_count: int = 0
        # Dropped count since last seeding.
        self._lost: int = 0
        # Last-applied seed signature so a re-seed reinitialises only on
        # actual change (re-clicking the same set is idempotent).
        self._seed_signature: tuple = ()
        # Telemetry dedupe.
        self._last_telemetry: Dict[str, Any] = {
            "tracking": 0, "seeded": 0, "points": [], "lost": 0,
        }
        self._last_published: Optional[Dict[str, Any]] = None

    def _seed_from_params(self) -> None:
        """Re-initialise the tracker from the current ``seed_points``
        param. Idempotent on the same input set."""
        raw = self.params.get("seed_points") or []
        # Validate + clamp to max_points.
        max_pts = int(self.params.get("max_points") or 20)
        pts: List[List[float]] = []
        for p in raw[:max_pts]:
            if not isinstance(p, (list, tuple)) or len(p) < 2:
                continue
            try:
                pts.append([float(p[0]), float(p[1])])
            except (TypeError, ValueError):
                continue
        sig = tuple((round(x, 1), round(y, 1)) for x, y in pts)
        if sig == self._seed_signature:
            return
        self._seed_signature = sig
        if not pts:
            self._tracking = None
            self._seeded_count = 0
            self._lost = 0
            return
        self._tracking = np.array(pts, dtype=np.float32).reshape(-1, 1, 2)
        self._seeded_count = len(pts)
        self._lost = 0
        # Force the prev-frame baseline to reset so the next process()
        # call starts a fresh tracker rather than transitioning from
        # whatever was tracked before.
        self._prev_gray = None

    def process(self, frame: np.ndarray) -> np.ndarray:
        # Re-seed if the user updated seed_points since last frame.
        self._seed_from_params()
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        if self._tracking is None or len(self._tracking) == 0:
            self._prev_gray = gray
            self._last_telemetry = {
                "tracking": 0,
                "seeded": self._seeded_count,
                "points": [],
                "lost": self._lost,
            }
            return frame

        if self._prev_gray is None:
            # First frame after seeding — nothing to flow from yet.
            self._prev_gray = gray
            pts_out: List[List[int]] = [
                [int(round(x)), int(round(y))]
                for x, y in self._tracking.reshape(-1, 2).tolist()
            ]
            self._last_telemetry = {
                "tracking": len(pts_out),
                "seeded": self._seeded_count,
                "points": pts_out,
                "lost": self._lost,
            }
            if self.params.get("draw_overlay"):
                self._draw(frame, self._tracking)
            return frame

        win = int(self.params.get("win_size") or 21)
        if win < 5: win = 5
        if win % 2 == 0: win += 1
        max_level = int(self.params.get("max_level") or 3)

        next_pts, status, _err = cv2.calcOpticalFlowPyrLK(
            self._prev_gray, gray, self._tracking, None,
            winSize=(win, win),
            maxLevel=max_level,
            criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01),
        )
        if next_pts is None or status is None:
            # Total tracker failure — clear state, log lost count, the
            # user can re-seed.
            self._lost += len(self._tracking)
            self._tracking = None
            self._prev_gray = gray
            self._last_telemetry = {
                "tracking": 0,
                "seeded": self._seeded_count,
                "points": [],
                "lost": self._lost,
            }
            return frame

        keep_mask = status.reshape(-1).astype(bool)
        dropped = int((~keep_mask).sum())
        if dropped:
            self._lost += dropped
        self._tracking = next_pts[keep_mask].reshape(-1, 1, 2)
        self._prev_gray = gray

        pts_out2: List[List[int]] = [
            [int(round(x)), int(round(y))]
            for x, y in self._tracking.reshape(-1, 2).tolist()
        ]
        self._last_telemetry = {
            "tracking": len(pts_out2),
            "seeded": self._seeded_count,
            "points": pts_out2,
            "lost": self._lost,
        }
        if self.params.get("draw_overlay"):
            self._draw(frame, self._tracking)
        return frame

    def _draw(self, frame: np.ndarray, pts: np.ndarray) -> None:
        """Draw markers on the output frame so the user can see what's
        being tracked without subscribing to telemetry."""
        for x, y in pts.reshape(-1, 2):
            cx, cy = int(round(x)), int(round(y))
            cv2.circle(frame, (cx, cy), 6, (255, 200, 0), 2)
            cv2.line(frame, (cx - 9, cy), (cx + 9, cy), (255, 200, 0), 1)
            cv2.line(frame, (cx, cy - 9), (cx, cy + 9), (255, 200, 0), 1)

    def telemetry(self) -> Optional[Dict[str, Any]]:
        current = self._last_telemetry
        last = self._last_published
        if last is None:
            self._last_published = _shallow_copy_tel(current)
            return dict(current)
        # Always publish on count change — that's a real event (point
        # lost, re-seeded, etc.).
        if current["tracking"] != last["tracking"] or current["seeded"] != last["seeded"]:
            self._last_published = _shallow_copy_tel(current)
            return dict(current)
        if current["tracking"] == 0:
            return None
        # Same count — publish only if the average centroid moved
        # appreciably. Beats per-point dist comparison which gets noisy
        # for the 30fps idle case.
        cur_pts = current["points"]
        last_pts = last["points"]
        if len(cur_pts) != len(last_pts):
            self._last_published = _shallow_copy_tel(current)
            return dict(current)
        total_sq = 0
        for (cx, cy), (lx, ly) in zip(cur_pts, last_pts):
            dx, dy = cx - lx, cy - ly
            total_sq += dx * dx + dy * dy
        avg_sq = total_sq / max(1, len(cur_pts))
        if avg_sq > self._PT_PX_THRESHOLD * self._PT_PX_THRESHOLD:
            self._last_published = _shallow_copy_tel(current)
            return dict(current)
        return None


def _shallow_copy_tel(t: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "tracking": t["tracking"],
        "seeded": t["seeded"],
        "points": list(t["points"]),
        "lost": t["lost"],
    }
