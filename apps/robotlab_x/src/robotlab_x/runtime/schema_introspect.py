# unmanaged
"""Pydantic-driven JSON Schema introspection for service classes.

Builds the schema halves of the type descriptor consumed by the runtime
types-index publisher (``runtime/types_index.py``):

  * ``config_class_schema`` — JSON Schema of the service's ``ServiceConfig``
    subclass. Pydantic v2 emits this for free via ``model_json_schema()``.
  * ``method_args_schema`` — JSON Schema for the arguments of a single
    ``@service_method``-decorated callable. Uses ``inspect.signature`` +
    ``pydantic.TypeAdapter`` per parameter so untyped, primitive, and
    Pydantic-typed args all surface a consistent schema.
  * ``class_state_schema`` — JSON Schema of an optional ``state_schema``
    Pydantic model declared on the Service class. Services that haven't
    yet declared one return ``None``; the runtime descriptor just omits
    the field for them.

The repeated ``TypeAdapter`` calls are cheap (Pydantic caches the schema)
but we cache here too because the types index is built lazily per
service-type on first publish + republished only on hot-reload.
"""
from __future__ import annotations

import functools
import inspect
import logging
from typing import Any, Dict, List, Optional, Tuple, Type

from pydantic import BaseModel, TypeAdapter


logger = logging.getLogger(__name__)


# ─── config ──────────────────────────────────────────────────────────


def config_class_schema(config_class: Optional[Type[BaseModel]]) -> Optional[Dict[str, Any]]:
    """Return ``config_class.model_json_schema()`` or None on failure /
    when the input is the bare ``ServiceConfig`` base (which has no
    user-relevant fields).

    Pydantic v2 always emits a JSON-Schema-2020-12-compatible object;
    we pass it through unchanged so consumers can use any standard
    validator (ajv, jsonschema, etc.).
    """
    if config_class is None:
        return None
    try:
        schema = config_class.model_json_schema()
    except Exception:  # noqa: BLE001
        logger.exception("config_class_schema: %s.model_json_schema failed",
                         config_class.__name__)
        return None
    return schema


# ─── methods ─────────────────────────────────────────────────────────


# Parameters never relevant to wire callers — they're dispatcher
# internals (the bound instance) or framework conveniences.
_SKIP_PARAMS = frozenset({"self", "cls"})


def method_args_schema(fn: Any) -> Dict[str, Any]:
    """Build a JSON Schema object describing the arguments accepted by
    ``fn`` (a ``@service_method``-decorated callable).

    Returns a JSON Schema of shape::

        {"type": "object",
         "properties": {arg_name: <schema>, ...},
         "required": [...required arg names...],
         "additionalProperties": false}

    For each parameter:
      * If it has a type annotation, Pydantic's ``TypeAdapter`` builds
        the schema for that type (handles ``Optional``, ``List[int]``,
        ``BaseModel`` subclasses, etc. uniformly).
      * If untyped, the schema is ``{}`` — accepts anything.
      * If a default value is present, the parameter is non-required and
        ``default`` is set in the schema.

    ``*args``/``**kwargs``/``VAR_POSITIONAL``/``VAR_KEYWORD`` are
    skipped — wire dispatch goes through a dict so positional/varargs
    don't appear in payloads.
    """
    try:
        sig = inspect.signature(fn)
    except (TypeError, ValueError):
        return {"type": "object", "properties": {}, "additionalProperties": True}

    properties: Dict[str, Any] = {}
    required: List[str] = []

    for name, param in sig.parameters.items():
        if name in _SKIP_PARAMS:
            continue
        if param.kind in (inspect.Parameter.VAR_POSITIONAL,
                          inspect.Parameter.VAR_KEYWORD):
            continue
        properties[name] = _param_schema(param)
        if param.default is inspect.Parameter.empty:
            required.append(name)

    out: Dict[str, Any] = {
        "type": "object",
        "properties": properties,
        "additionalProperties": False,
    }
    if required:
        out["required"] = required
    return out


def _param_schema(param: inspect.Parameter) -> Dict[str, Any]:
    """JSON Schema for one parameter. Falls back to a permissive {}
    schema when the annotation can't be analysed (e.g. a forward-ref
    that didn't get resolved at import time)."""
    ann = param.annotation
    schema: Dict[str, Any]
    if ann is inspect.Parameter.empty:
        schema = {}
    else:
        try:
            schema = _adapt_schema(ann)
        except Exception:  # noqa: BLE001 — TypeAdapter can raise for exotic types
            logger.debug("method_args_schema: TypeAdapter failed for %r", ann)
            schema = {}
    if param.default is not inspect.Parameter.empty:
        # Pydantic adapter doesn't know about the function's default;
        # surface it directly so client tooling can pre-fill forms.
        try:
            # JSON-serialise sanity check (drops if non-serialisable).
            import json as _json
            _json.dumps(param.default)
            schema["default"] = param.default
        except (TypeError, ValueError):
            pass
    return schema


@functools.lru_cache(maxsize=512)
def _adapt_schema(ann: Any) -> Dict[str, Any]:
    """Cached ``TypeAdapter(ann).json_schema()`` so the same annotation
    used across many methods doesn't re-run Pydantic's schema builder."""
    adapter = TypeAdapter(ann)
    return adapter.json_schema()


# ─── state schema ────────────────────────────────────────────────────


def class_state_schema(cls: Type) -> Optional[Dict[str, Any]]:
    """Return JSON Schema for ``cls.state_schema`` if the service
    declares one, else None.

    Convention: a Service subclass declares::

        class StateSchema(BaseModel):
            status: Literal["running", "starting", "error", "stopped"]
            ...
        state_schema = StateSchema

    Phase F (a future migration) wires the schema as the single source
    of truth for the /state payload; for now this just adds the
    self-describing JSON Schema to the type descriptor when present.
    """
    schema_cls = getattr(cls, "state_schema", None)
    if schema_cls is None:
        return None
    if not isinstance(schema_cls, type) or not issubclass(schema_cls, BaseModel):
        return None
    try:
        return schema_cls.model_json_schema()
    except Exception:  # noqa: BLE001
        logger.exception("class_state_schema: %s.model_json_schema failed",
                         schema_cls.__name__)
        return None


# ─── topic schemas ───────────────────────────────────────────────────


def class_topic_schemas(cls: Type) -> Dict[str, Dict[str, Any]]:
    """Return a ``{topic_role: JSON Schema}`` map built from
    ``cls.topic_schemas`` if declared.

    Convention::

        class VideoService(SubprocessService):
            topic_schemas = {
                "snapshot": SnapshotPayload,        # Pydantic model
                "latest_snapshot": SnapshotPayload, # same
            }

    Each value is a Pydantic BaseModel subclass (preferred) — or a
    pre-built JSON Schema dict (passes through unchanged). Anything
    else is dropped + logged.
    """
    raw = getattr(cls, "topic_schemas", None) or {}
    if not isinstance(raw, dict):
        return {}
    out: Dict[str, Dict[str, Any]] = {}
    for k, v in raw.items():
        if isinstance(v, dict):
            out[k] = v
            continue
        if isinstance(v, type) and issubclass(v, BaseModel):
            try:
                out[k] = v.model_json_schema()
            except Exception:  # noqa: BLE001
                logger.exception("class_topic_schemas: %s.model_json_schema failed",
                                 v.__name__)
            continue
        logger.debug("class_topic_schemas: ignored unsupported entry %r=%r", k, v)
    return out


# ─── method-list builder ─────────────────────────────────────────────


def introspect_methods(cls: Type) -> List[Dict[str, Any]]:
    """Walk the class (NOT an instance — classes also expose the
    decorator tag via ``dir`` + ``getattr``) and return a list of
    method descriptors enriched with arg schemas.

    Output shape per method::

        {"name": "add_filter",
         "doc": "Append (or insert) a filter into the pipeline.",
         "args_schema": <JSON Schema>,
         "publishes": ["filters", "filter/<id>"],
         "publish_return": null | "last" | "event"}

    Sorted by wire name for deterministic descriptors (so diffs in the
    UI's type viewer line up across reboots).
    """
    from rlx_bus.methods import MethodInfo  # local: avoid bus import on schema-only paths

    found: List[Tuple[str, Dict[str, Any]]] = []
    seen: set = set()
    for attr in dir(cls):
        if attr.startswith("_"):
            continue
        try:
            value = getattr(cls, attr)
        except Exception:  # noqa: BLE001
            continue
        info: Optional[MethodInfo] = getattr(value, "_rlx_service_method", None)
        if info is None or info.name in seen:
            continue
        seen.add(info.name)
        args_schema = method_args_schema(value)
        found.append((info.name, {
            "name": info.name,
            "doc": (info.doc or "").strip() or None,
            "args_schema": args_schema,
            "publishes": list(info.publishes or []),
            "publish_return": info.publish_return,
        }))
    found.sort(key=lambda kv: kv[0])
    return [d for _, d in found]
