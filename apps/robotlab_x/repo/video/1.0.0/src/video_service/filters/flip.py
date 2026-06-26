"""Mirror the frame horizontally / vertically / both."""
from __future__ import annotations

import cv2
import numpy as np

from .base import Filter, make_param


class FlipFilter(Filter):
    type_name = "flip"
    title = "Flip"
    description = "Mirror the frame. ``horizontal`` is the most common — undoes the camera's selfie-mirror so motion-tracked coordinates match the real world."
    param_schema = [
        make_param("axis", "enum", "horizontal",
                   choices=["horizontal", "vertical", "both"],
                   label="Axis",
                   help="horizontal = left/right flip; vertical = upside down; both = 180° rotation."),
    ]

    _CODE_MAP = {"vertical": 0, "horizontal": 1, "both": -1}

    def process(self, frame: np.ndarray) -> np.ndarray:
        code = self._CODE_MAP.get(str(self.params["axis"]), 1)
        return cv2.flip(frame, code)
