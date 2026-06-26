# unmanaged
"""Capability discovery endpoint.

GET /v1/service-proxy/{proxy_id}/methods
    -> [{"name": "start_clock", "doc": "Resume the tick loop. ..."}, ...]

Returns the @service_method-decorated callables on the live service
instance. Empty list if the proxy is registered but not running, or if
the adapter doesn't support introspection (e.g. subprocess services
that haven't published their method manifest yet).
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

from auth import create_auth_dependencies
from config import create_app_settings
from fastapi import APIRouter, Depends, HTTPException

from robotlab_x.framework import REGISTRY
from robotlab_x.models.config import Config

settings, config_provider = create_app_settings("robotlab_x", Config)
auth_deps = create_auth_dependencies(config_provider)
logger = logging.getLogger(__name__)

router = APIRouter()

_ROLES = ["Admin"]


@router.get(
    "/service-proxy/{proxy_id}/methods",
    response_model=List[Dict[str, Any]],
)
def list_proxy_methods(
    proxy_id: str,
    _: Any = Depends(auth_deps.require_role(_ROLES)),
) -> List[Dict[str, Any]]:
    handle = REGISTRY.get(proxy_id)
    adapter = REGISTRY.adapter_for(proxy_id)
    if handle is None or adapter is None:
        # Not running. Could also be a singleton runtime that doesn't
        # have an adapter — same answer (no methods to discover).
        return []
    try:
        infos = adapter.methods(handle)
    except Exception as exc:  # noqa: BLE001
        logger.exception("methods() failed for %s", proxy_id)
        raise HTTPException(status_code=500, detail=str(exc))
    return [
        {
            "name": m.name,
            "doc": m.doc,
            "publishes": list(m.publishes),
            "publish_return": m.publish_return,
        }
        for m in infos
    ]


@router.get(
    "/service-proxy/{proxy_id}/topology",
    response_model=Dict[str, Any],
)
def get_proxy_topology(
    proxy_id: str,
    _: Any = Depends(auth_deps.require_role(_ROLES)),
) -> Dict[str, Any]:
    """Per-service declared-topic view. Static — derives from the
    service class's decorators + ``publishes`` class attribute. Used by
    the Composer's "Topics" sub-dialog.

    Returns:
      * ``publishes``: list of ``{topic, source, method?}`` — topic is
        already substituted with the proxy_id ("state" → "/<type>/<id>/state").
      * ``methods``: shallow method list with publishes/publish_return.
      * ``transport``: in-process or subprocess (or null if not running).
    """
    handle = REGISTRY.get(proxy_id)
    adapter = REGISTRY.adapter_for(proxy_id)
    if handle is None or adapter is None:
        return {"publishes": [], "methods": [], "transport": None}
    try:
        infos = adapter.methods(handle)
    except Exception as exc:  # noqa: BLE001
        logger.exception("topology() failed for %s", proxy_id)
        raise HTTPException(status_code=500, detail=str(exc))

    # Resolve the type/proxy namespace once so we can substitute into
    # relative topic suffixes. For an in-process service, ``handle``
    # carries the service instance; we look up the type from REGISTRY.
    type_name = REGISTRY.type_name_for(proxy_id) or ""

    def _resolve(t: str) -> str:
        if t.startswith("/"):
            return t
        return f"/{type_name}/{proxy_id}/{t}"

    publishes: List[Dict[str, Any]] = []
    # Class-level publishes — services declare always-on topics
    # (state, heartbeat, log) via a class attr.
    class_publishes = REGISTRY.class_publishes_for(proxy_id) or []
    for t in class_publishes:
        publishes.append({"topic": _resolve(t), "source": "class", "method": None})
    # Per-method publishes from @service_method(publishes=...)
    for m in infos:
        for t in m.publishes:
            publishes.append({"topic": _resolve(t), "source": "method", "method": m.name})
        if m.publish_return == "last":
            publishes.append({"topic": _resolve(f"return/{m.name}"),
                              "source": "publish_return", "method": m.name, "retained": True})
        elif m.publish_return == "event":
            publishes.append({"topic": _resolve(f"return/{m.name}"),
                              "source": "publish_return", "method": m.name, "retained": False})

    return {
        "transport": handle.transport,
        "type_name": type_name,
        "publishes": publishes,
        "methods": [
            {
                "name": m.name,
                "doc": m.doc,
                "publishes": list(m.publishes),
                "publish_return": m.publish_return,
            }
            for m in infos
        ],
    }
