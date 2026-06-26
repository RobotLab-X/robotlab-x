"""Filter abstract base + the param-schema wire shape consumers use.

Every filter:
  * has a stable ``type_name`` (the catalog key — "canny", "motion", …)
  * accepts BGR uint8 ndarray in ``process()`` and returns BGR uint8
    same H×W. Single-channel internal ops (canny mask, motion mask) are
    converted back to BGR before returning so the next filter doesn't
    have to care about dtype/channel coercion.
  * declares its config schema via ``param_schema`` — the UI walks this
    to render appropriate inputs (slider, toggle, select).
  * may publish telemetry by setting ``publishes_telemetry = True`` and
    returning a JSON-able dict from ``telemetry()`` after each ``process()``
    call. The service publishes that on /video/<id>/filter/<filter_id>
    (retained) so consumers can react without inspecting the video stream.

Wire format for one entry in the live pipeline (the ``filters`` field
on VideoConfig + control payloads):

    {"id": "uuid", "type": "canny", "enabled": true,
     "params": {"threshold1": 50, "threshold2": 150}}

The id is generated client-side (uuid) so the UI can reference
specific filters for update/remove without race conditions between
sequence numbers and reorders.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, ClassVar, Dict, List, Optional

import numpy as np


# JSON-able description of one configurable parameter. The UI builds
# inputs from this — int/float → slider+number, bool → toggle, enum →
# select. ``label`` is the user-facing name; ``help`` is the tooltip /
# subtitle.
PARAM_TYPES = ("int", "float", "bool", "enum",
               # Free-form string — rendered as a single-line text
               # input in the UI. Use ``placeholder`` (optional) to
               # hint at the expected value. Empty strings are a
               # valid value; the filter implementation decides what
               # "empty" means (skip, use default, etc).
               "string",
               # Spatial types — represented as JSON lists in the
               # params dict but rendered with image-overlay pickers
               # in the UI. Coordinates are in image pixel space
               # (matches the camera's current frame dimensions).
               "point",    # [x, y]
               "rect",     # [x, y, w, h]
               "points")   # [[x, y], ...]


def make_param(
    name: str,
    type: str,
    default: Any,
    *,
    min: Optional[float] = None,
    max: Optional[float] = None,
    step: Optional[float] = None,
    choices: Optional[List[str]] = None,
    label: Optional[str] = None,
    help: Optional[str] = None,
    placeholder: Optional[str] = None,
) -> Dict[str, Any]:
    """Build one param-schema dict. Kept as a function (not a dataclass)
    so the result is trivially JSON-serialisable for the filter catalog
    bus message."""
    if type not in PARAM_TYPES:
        raise ValueError(f"unknown param type {type!r} (allowed: {PARAM_TYPES})")
    out: Dict[str, Any] = {"name": name, "type": type, "default": default}
    if min is not None: out["min"] = min
    if max is not None: out["max"] = max
    if step is not None: out["step"] = step
    if choices is not None: out["choices"] = list(choices)
    if label is not None: out["label"] = label
    if help is not None: out["help"] = help
    if placeholder is not None: out["placeholder"] = placeholder
    return out


class Filter(ABC):
    """One stage in the video pipeline.

    Subclass + override ``type_name``, ``title``, ``param_schema``,
    ``process``, and (optionally) ``telemetry``. Instantiation receives
    the persisted params dict + the filter's id — defaults from the
    schema fill in any missing keys.
    """

    # ─── class-level (catalog) ─────────────────────────────────────────
    type_name: ClassVar[str] = ""
    title: ClassVar[str] = ""
    description: ClassVar[str] = ""
    publishes_telemetry: ClassVar[bool] = False
    param_schema: ClassVar[List[Dict[str, Any]]] = []
    # Optional Pydantic model describing the telemetry payload shape.
    # Required only for filters where ``publishes_telemetry = True`` —
    # the catalog publishes its JSON Schema so consumers know what to
    # expect from ``/video/<vid>/filter/<filter_id>`` without
    # subscribing first. Filters that don't declare one publish a
    # ``telemetry_schema: null`` entry; consumers must inspect a live
    # message or treat the topic as opaque JSON.
    telemetry_schema: ClassVar[Optional[Any]] = None

    # ─── instance ──────────────────────────────────────────────────────
    def __init__(self, id: str, params: Optional[Dict[str, Any]] = None) -> None:
        self.id = id
        # Merge defaults under user params so missing keys fall back +
        # so process() can read self.params[name] without KeyError.
        merged: Dict[str, Any] = {p["name"]: p["default"] for p in self.param_schema}
        if params:
            for k, v in params.items():
                if k in merged:
                    merged[k] = v
        self.params: Dict[str, Any] = merged

    @abstractmethod
    def process(self, frame: np.ndarray) -> np.ndarray:
        """Run the filter on one frame. Must return BGR uint8 of the
        same H×W. Raising propagates to the capture loop, which logs +
        skips the rest of the pipeline for this frame."""

    def telemetry(self) -> Optional[Dict[str, Any]]:
        """Return the most recent analysis output, or None if the filter
        is purely an effect. Called once per frame AFTER process().

        Default implementation returns None — override only when
        ``publishes_telemetry = True``. Returned dict must be JSON-able
        (numpy scalars need .item(); arrays need .tolist())."""
        return None

    # ─── catalog metadata ──────────────────────────────────────────────
    @classmethod
    def catalog_entry(cls) -> Dict[str, Any]:
        """Catalog-message shape for one type. Published by the service
        on /video/<id>/filter_catalog so the UI can populate its
        Add-filter dropdown + render param inputs.

        The ``telemetry_schema`` field carries the JSON Schema of the
        filter's telemetry payload — populated automatically from a
        Pydantic ``BaseModel`` declared on the class — so consumers
        know what to expect from ``/video/<vid>/filter/<id>`` without
        subscribing. Effect filters (no telemetry) ship ``null`` here.
        """
        entry: Dict[str, Any] = {
            "type": cls.type_name,
            "title": cls.title,
            "description": cls.description,
            "publishes_telemetry": cls.publishes_telemetry,
            "param_schema": list(cls.param_schema),
            "telemetry_schema": None,
        }
        schema_cls = cls.telemetry_schema
        if schema_cls is not None:
            # Local import — pydantic is already a transitive dep via
            # rlx_bus.ServiceConfig, but the base Filter module shouldn't
            # pay an import cost for it on the cheap path.
            try:
                from pydantic import BaseModel
                if isinstance(schema_cls, type) and issubclass(schema_cls, BaseModel):
                    entry["telemetry_schema"] = schema_cls.model_json_schema()
                elif isinstance(schema_cls, dict):
                    entry["telemetry_schema"] = schema_cls
            except Exception:  # noqa: BLE001
                pass
        return entry
