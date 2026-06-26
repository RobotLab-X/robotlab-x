# unmanaged
"""GET /v1/logs — recent runtime log lines from the in-memory ring buffer
(runtime/log_bus.py). Lets the UI Logs page show backend activity with
history; it still live-tails per-service logs over the bus separately.
"""
from typing import Any, Dict, List

from auth import create_auth_dependencies
from config import create_app_settings
from fastapi import APIRouter, Depends, Query

from robotlab_x.models.config import Config
from robotlab_x.runtime import log_bus

settings, config_provider = create_app_settings("robotlab_x", Config)
auth_deps = create_auth_dependencies(config_provider)

router = APIRouter()


@router.get("/logs")
def get_logs(
    limit: int = Query(300, ge=1, le=1000),
    _: Any = Depends(auth_deps.require_role(["Admin"])),
) -> List[Dict[str, Any]]:
    return log_bus.recent(limit)
