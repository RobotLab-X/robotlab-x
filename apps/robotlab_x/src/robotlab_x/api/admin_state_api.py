# unmanaged
"""GET /v1/admin/state — structured snapshot of robotlab_x state.

Backs the in-UI ``/admin/state`` page. Returns the same dict the CLI
``python -m robotlab_x.tools.state --json`` produces. Admin-gated.
"""
from __future__ import annotations

import logging
from typing import Any, Dict

from auth import create_auth_dependencies
from config import create_app_settings
from fastapi import APIRouter, Depends

from robotlab_x.models.config import Config
from robotlab_x.tools.state import gather_state


settings, config_provider = create_app_settings("robotlab_x", Config)
auth_deps = create_auth_dependencies(config_provider)
logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/admin/state", response_model=Dict[str, Any])
def get_state(_: Any = Depends(auth_deps.require_role(["Admin"]))) -> Dict[str, Any]:
    """Returns the same structure as the CLI tool. Cheap — milliseconds."""
    return gather_state()
