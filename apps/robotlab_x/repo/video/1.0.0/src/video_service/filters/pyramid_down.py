"""Pyramid downsample (then upsample) — fast band-limited blur.

``cv2.pyrDown`` halves the resolution with a built-in 5×5 Gaussian
prefilter; ``cv2.pyrUp`` doubles it back. Repeating N times gives a
"detail killer" — useful as a fast preprocessor before motion or
canny when the input is noisy and a regular Gaussian kernel is too
expensive at full resolution.

Filters must preserve H×W per the pipeline contract, so we pyrUp the
same number of times we pyrDown'd. The result is the original size
with progressively coarser detail.
"""
from __future__ import annotations

import cv2
import numpy as np

from .base import Filter, make_param


class PyramidDownFilter(Filter):
    type_name = "pyramid_down"
    title = "Pyramid Downsample"
    description = "Fast multi-octave blur via the image pyramid. Cheap preprocessor for motion/canny on noisy input."
    param_schema = [
        make_param("levels", "int", 1, min=1, max=4, step=1,
                   label="Levels",
                   help="Each level halves the resolution before upsampling back. 1 = subtle, 4 = heavy."),
    ]

    def process(self, frame: np.ndarray) -> np.ndarray:
        n = max(1, min(4, int(self.params["levels"])))
        out = frame
        for _ in range(n):
            out = cv2.pyrDown(out)
        for _ in range(n):
            out = cv2.pyrUp(out)
        # pyrUp can overshoot/undershoot by 1 pixel due to odd input
        # dimensions; resize back to be safe so downstream filters
        # don't trip on a shape mismatch.
        if out.shape[:2] != frame.shape[:2]:
            out = cv2.resize(out, (frame.shape[1], frame.shape[0]))
        return out
