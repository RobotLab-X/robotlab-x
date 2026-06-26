# unmanaged
"""GET /v1/bus/topics — live bus topology snapshot.

Returns every active topic with its parsed subscribers + retained
metadata. Backs the new Topology page and the per-service "Topics" tab
in the Composer's view_full. Cheap — single pass over the in-memory
bus state.

Same data as ``list_topics`` over WebSocket; the REST surface lets the
UI poll without holding a subscription frame open.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

from auth import create_auth_dependencies
from config import create_app_settings
from fastapi import APIRouter, Depends

from robotlab_x.models.config import Config
from robotlab_x.runtime.bus import get_bus


settings, config_provider = create_app_settings("robotlab_x", Config)
auth_deps = create_auth_dependencies(config_provider)
logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/bus/topics", response_model=Dict[str, Any])
def get_bus_topics(_: Any = Depends(auth_deps.require_role(["Admin"]))) -> Dict[str, Any]:
    bus = get_bus()
    return {
        "topics": bus.list_topics_detail(),
        "patterns": sorted(bus.patterns()),
    }
