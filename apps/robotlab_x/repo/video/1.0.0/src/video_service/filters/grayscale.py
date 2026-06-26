"""Grayscale — convert BGR → gray and back to BGR.

Loses chrominance information but keeps the 3-channel BGR contract so
the rest of the pipeline doesn't need to special-case it.
"""
from __future__ import annotations

import cv2
import numpy as np

from .base import Filter


class GrayscaleFilter(Filter):
    type_name = "grayscale"
    title = "Grayscale"
    description = "Convert to luminance. Useful as a pre-stage for analysis filters or as a visual effect."
    param_schema = []

    def process(self, frame: np.ndarray) -> np.ndarray:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
