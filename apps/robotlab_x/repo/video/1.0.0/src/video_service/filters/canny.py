"""Canny edge detection.

Operates on a grayscale view of the input; the output is the edge mask
rendered as a 3-channel BGR image so the pipeline stays composable.
"""
from __future__ import annotations

import cv2
import numpy as np

from .base import Filter, make_param


class CannyFilter(Filter):
    type_name = "canny"
    title = "Canny Edges"
    description = "Detect edges using the Canny algorithm. Output is a black/white edge mask."
    param_schema = [
        make_param("threshold1", "int", 50, min=0, max=500, step=1,
                   label="Lower threshold",
                   help="Edges with gradient magnitude below this are discarded."),
        make_param("threshold2", "int", 150, min=0, max=500, step=1,
                   label="Upper threshold",
                   help="Edges above this are kept; between thresholds are kept only if connected to strong edges."),
    ]

    def process(self, frame: np.ndarray) -> np.ndarray:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray, int(self.params["threshold1"]), int(self.params["threshold2"]))
        # Re-render as BGR so downstream filters can keep treating
        # frames as 3-channel without a special path for single-channel.
        return cv2.cvtColor(edges, cv2.COLOR_GRAY2BGR)
