"""Filter registry + factory.

To add a new filter type:
  1. Create ``filters/<name>.py`` subclassing ``Filter``
  2. Add it to ``_REGISTRY`` below

The catalog message published on /video/<id>/filter_catalog is built
from ``catalog()`` so the UI's Add-filter dropdown stays in sync
without any extra wiring.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Type

from .base import Filter
from .box_tracker import BoxTrackerFilter
from .canny import CannyFilter
from .face_detect import FaceDetectFilter
from .flip import FlipFilter
from .gaussian_blur import GaussianBlurFilter
from .grayscale import GrayscaleFilter
from .lk_optical_flow import LKOpticalFlowFilter
from .motion import MotionFilter
from .pyramid_down import PyramidDownFilter
from .rotate import RotateFilter
from .threshold import ThresholdFilter
from .yolo import YoloFilter


# Ordered for deterministic catalog output — the UI dropdown reflects
# this order. Grouped by purpose: pre-stage filters first (noise
# reduction, framing), then effects/analysis, then detectors that
# publish telemetry at the bottom.
_REGISTRY: List[Type[Filter]] = [
    # Pre-stage / framing
    GaussianBlurFilter,
    PyramidDownFilter,
    FlipFilter,
    RotateFilter,
    # Effects + analysis
    GrayscaleFilter,
    ThresholdFilter,
    CannyFilter,
    # Detectors / trackers (publish telemetry)
    MotionFilter,
    FaceDetectFilter,
    LKOpticalFlowFilter,
    BoxTrackerFilter,
    YoloFilter,
]

_BY_TYPE: Dict[str, Type[Filter]] = {cls.type_name: cls for cls in _REGISTRY}


def catalog() -> List[Dict[str, Any]]:
    """Catalog of every registered filter type. Published once on
    startup as a retained bus message so the UI gets it on first
    subscribe + on every reconnect."""
    return [cls.catalog_entry() for cls in _REGISTRY]


def build_filter(spec: Dict[str, Any]) -> Optional[Filter]:
    """Instantiate a Filter from a persisted spec.

    Spec shape::

        {"id": "uuid", "type": "canny", "enabled": true,
         "params": {"threshold1": 50, "threshold2": 150}}

    Returns None for unknown types or malformed specs — the caller
    skips it so a typo in saved config can't crash the whole pipeline.
    The id is required (the UI uses it to address the filter for
    update/remove); auto-generated if missing.
    """
    if not isinstance(spec, dict):
        return None
    type_name = spec.get("type")
    if not type_name or type_name not in _BY_TYPE:
        return None
    cls = _BY_TYPE[type_name]
    filter_id = spec.get("id") or f"{type_name}-{id(spec):x}"
    params = spec.get("params") or {}
    if not isinstance(params, dict):
        params = {}
    return cls(id=filter_id, params=params)


__all__ = ["Filter", "catalog", "build_filter"]
