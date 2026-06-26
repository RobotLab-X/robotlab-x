"""Binary / inverted / truncate threshold + Otsu auto-threshold.

Operates on a grayscale view and converts back to BGR so the next
stage gets the standard 3-channel input. ``otsu`` picks the threshold
automatically; the ``thresh`` slider is ignored for that mode but
remains visible (UI doesn't hide unused params).
"""
from __future__ import annotations

import cv2
import numpy as np

from .base import Filter, make_param


class ThresholdFilter(Filter):
    type_name = "threshold"
    title = "Threshold"
    description = "Binary-ize the frame at a luminance threshold. Useful for finding bright objects, paper, screens, etc."
    param_schema = [
        make_param("thresh", "int", 127, min=0, max=255, step=1,
                   label="Threshold",
                   help="Pixels above this become max-value; below become 0 (or vice versa for inv)."),
        make_param("max_val", "int", 255, min=0, max=255, step=1,
                   label="Max value",
                   help="Output value for pixels above the threshold."),
        make_param("type", "enum", "binary",
                   choices=["binary", "binary_inv", "trunc", "tozero", "tozero_inv", "otsu"],
                   label="Type",
                   help="otsu auto-computes the threshold; thresh slider is ignored."),
    ]

    _TYPE_MAP = {
        "binary": cv2.THRESH_BINARY,
        "binary_inv": cv2.THRESH_BINARY_INV,
        "trunc": cv2.THRESH_TRUNC,
        "tozero": cv2.THRESH_TOZERO,
        "tozero_inv": cv2.THRESH_TOZERO_INV,
    }

    def process(self, frame: np.ndarray) -> np.ndarray:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        type_name = str(self.params["type"])
        if type_name == "otsu":
            flags = cv2.THRESH_BINARY + cv2.THRESH_OTSU
            _, out = cv2.threshold(gray, 0, int(self.params["max_val"]), flags)
        else:
            flags = self._TYPE_MAP.get(type_name, cv2.THRESH_BINARY)
            _, out = cv2.threshold(gray, int(self.params["thresh"]),
                                   int(self.params["max_val"]), flags)
        return cv2.cvtColor(out, cv2.COLOR_GRAY2BGR)
