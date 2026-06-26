# unmanaged
"""Read-only admin endpoints for inspecting the underlying database.

Backend-agnostic: relies on DatabaseAdapter.list_tables() + get_all_items(),
both defined on the shared package. Any adapter that implements list_tables()
gets the admin UI for free; adapters that don't will surface a clear error.
"""
import logging
from typing import Any, Dict, List

from auth import create_auth_dependencies
from config import create_app_settings
from database.factory import get_database_client
from fastapi import APIRouter, Depends, HTTPException

from robotlab_x.models.config import Config

settings, config_provider = create_app_settings("robotlab_x", Config)
auth_deps = create_auth_dependencies(config_provider)
logger = logging.getLogger(__name__)

router = APIRouter()

_ROLES = ["Admin"]


@router.get("/admin/table-list", response_model=List[str])
def list_tables(_: Any = Depends(auth_deps.require_role(_ROLES))) -> List[str]:
    db = get_database_client()
    if db is None:
        raise HTTPException(status_code=503, detail="database client not initialised")
    try:
        return db.list_tables()
    except NotImplementedError as e:
        raise HTTPException(status_code=501, detail=str(e))


@router.get("/admin/table/{table}", response_model=List[Dict[str, Any]])
def get_table(table: str, _: Any = Depends(auth_deps.require_role(_ROLES))) -> List[Dict[str, Any]]:
    db = get_database_client()
    if db is None:
        raise HTTPException(status_code=503, detail="database client not initialised")
    try:
        known = set(db.list_tables())
    except NotImplementedError as e:
        raise HTTPException(status_code=501, detail=str(e))
    if table not in known:
        raise HTTPException(status_code=404, detail=f"table '{table}' not found")
    return db.get_all_items(table)
