"""Rotate by a multiple of 90 degrees.

cv2.rotate handles 90/180/270 in C without resorting to a general
affine warp, so it's effectively free at any resolution. Arbitrary
angles are deliberately out of scope here — they require a warpAffine
+ a crop/letterbox decision and don't fit a "set and forget" filter.
"""
from __future__ import annotations

import cv2
import numpy as np

from .base import Filter, make_param


class RotateFilter(Filter):
    type_name = "rotate"
    title = "Rotate"
    description = "Rotate the frame by 90/180/270 degrees. Useful when the camera is mounted sideways."
    param_schema = [
        make_param("angle", "enum", "90_cw",
                   choices=["90_cw", "180", "90_ccw"],
                   label="Angle",
                   help="90_cw / 180 / 90_ccw — counter-clockwise = 270 clockwise."),
    ]

    _ROT_MAP = {
        "90_cw": cv2.ROTATE_90_CLOCKWISE,
        "180": cv2.ROTATE_180,
        "90_ccw": cv2.ROTATE_90_COUNTERCLOCKWISE,
    }

    def process(self, frame: np.ndarray) -> np.ndarray:
        return cv2.rotate(frame, self._ROT_MAP.get(str(self.params["angle"]),
                                                   cv2.ROTATE_90_CLOCKWISE))
