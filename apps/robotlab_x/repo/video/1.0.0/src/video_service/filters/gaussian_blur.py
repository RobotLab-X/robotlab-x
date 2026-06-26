"""Gaussian blur — soften the frame with a Gaussian kernel.

Useful before edge detectors (canny) to suppress noise that would
otherwise produce spurious edges. Also a cheap aesthetic effect on
its own.
"""
from __future__ import annotations

import cv2
import numpy as np

from .base import Filter, make_param


class GaussianBlurFilter(Filter):
    type_name = "gaussian_blur"
    title = "Gaussian Blur"
    description = "Smooth the frame with a Gaussian kernel. Useful as a noise-reduction pre-stage for edge or motion filters."
    param_schema = [
        make_param("kernel_size", "int", 5, min=1, max=51, step=2,
                   label="Kernel size",
                   help="Odd value 1–51. Larger = more blur (and more CPU)."),
        make_param("sigma", "float", 0.0, min=0.0, max=20.0, step=0.1,
                   label="Sigma",
                   help="Standard deviation. 0 → derived from kernel size."),
    ]

    def process(self, frame: np.ndarray) -> np.ndarray:
        k = int(self.params["kernel_size"])
        if k < 1: k = 1
        if k % 2 == 0: k += 1  # cv2 requires odd
        sigma = float(self.params["sigma"])
        return cv2.GaussianBlur(frame, (k, k), sigma)
