# unmanaged
"""System control: system info, save-config, and restart.

  GET  /v1/system/info          process + active-set info
  POST /v1/system/save-config   snapshot all services' config + run-state
                                into the active set (restore point)
  POST /v1/system/reload-config re-read all services' yml + apply live
  POST /v1/system/reload-config/{proxy_id}
                                re-read one service's yml + apply it live
  POST /v1/system/restart       graceful drain + re-exec
  POST /v1/system/shutdown      graceful drain + exit (no re-exec)

Restart re-execs the backend with its recorded launch command (see
runtime/system.py) so config-set switches / upgrades can be applied from the
UI, including on a headless remote box. Admin-gated.
"""
import asyncio
import logging
from typing import Any, Dict

from auth import create_auth_dependencies
from config import create_app_settings
from fastapi import APIRouter, Depends

from robotlab_x.models.config import Config
from robotlab_x.runtime import system

settings, config_provider = create_app_settings("robotlab_x", Config)
auth_deps = create_auth_dependencies(config_provider)
logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/system/info")
def get_system_info(_: Any = Depends(auth_deps.require_role(["Admin"]))) -> Dict[str, Any]:
    return system.system_info()


@router.post("/system/save-config")
def post_system_save_config(_: Any = Depends(auth_deps.require_role(["Admin"]))) -> Dict[str, Any]:
    """Persist every managed service's config + run-state into the active
    config set's ymls, so the next restart restores the exact current state
    (which services run vs are merely created, and each service's own
    runtime state — e.g. a clock's ticks). The same snapshot runs
    automatically before a graceful restart; this exposes it on demand."""
    from robotlab_x.runtime import lifecycle
    report = lifecycle.save_all_service_config()
    logger.info("system: save-config requested by admin — saved=%s", report.get("saved"))
    return report


@router.post("/system/save-config/{proxy_id}")
def post_system_save_config_one(
    proxy_id: str,
    _: Any = Depends(auth_deps.require_role(["Admin"])),
) -> Dict[str, Any]:
    """Persist ONE service's config + run-state to its yml in the active
    config set. Backs the per-node save icon in the Composer's full-view
    title bar — the operator can commit a single service's tweaks
    without touching every other ``*.yml``."""
    from robotlab_x.runtime import lifecycle
    report = lifecycle.save_one_service_config(proxy_id)
    logger.info(
        "system: save-config-one requested by admin — proxy=%s ok=%s",
        proxy_id, report.get("ok"),
    )
    return report


@router.post("/system/reload-config")
def post_system_reload_config_all(
    _: Any = Depends(auth_deps.require_role(["Admin"])),
) -> Dict[str, Any]:
    """Re-read EVERY managed service's yml from the active config set and
    apply each to its live service — the inverse of save-config (all).
    Backs the top-bar "Load all" button."""
    from robotlab_x.runtime import lifecycle
    report = lifecycle.reload_all_service_config()
    logger.info(
        "system: reload-config (all) requested by admin — reloaded=%s skipped=%s errors=%s",
        report.get("reloaded"), list((report.get("skipped") or {}).keys()),
        list((report.get("errors") or {}).keys()),
    )
    return report


@router.post("/system/reload-config/{proxy_id}")
def post_system_reload_config_one(
    proxy_id: str,
    _: Any = Depends(auth_deps.require_role(["Admin"])),
) -> Dict[str, Any]:
    """Re-read ONE service's yml from the active config set and apply it
    to the LIVE service — the inverse of save-config/{proxy_id}. Backs
    the per-node "load config from yml" button so an operator can
    hand-edit a running service's yml and push it in without a restart."""
    from robotlab_x.runtime import lifecycle
    report = lifecycle.reload_one_service_config(proxy_id)
    logger.info(
        "system: reload-config-one requested by admin — proxy=%s ok=%s via=%s",
        proxy_id, report.get("ok"), report.get("applied_via"),
    )
    return report


@router.post("/system/restart")
async def post_system_restart(_: Any = Depends(auth_deps.require_role(["Admin"]))) -> Dict[str, Any]:
    info = system.system_info()
    logger.warning("system: restart requested by admin — graceful drain + re-exec scheduled")
    # Respond first; drain + re-exec shortly after so this response flushes
    # before the process is replaced. graceful_restart() enters draining
    # state, stops non-singleton services (no orphans / no stale 'running'),
    # then execs. The client polls system info (started_at) to detect the
    # fresh process, and the ws auto-reconnects.
    asyncio.get_event_loop().call_later(0.5, system.graceful_restart)
    return {"ok": True, "restarting": True, "start_command": info.get("start_command")}


@router.post("/system/shutdown")
async def post_system_shutdown(_: Any = Depends(auth_deps.require_role(["Admin"]))) -> Dict[str, Any]:
    logger.warning("system: shutdown requested by admin — graceful drain + exit scheduled")
    # Respond first; snapshot + drain + exit shortly after so this response
    # flushes before the process ends. Unlike restart there is NO re-exec —
    # the backend stays down until something starts it again, so the client
    # will NOT auto-reconnect.
    asyncio.get_event_loop().call_later(0.5, system.graceful_shutdown)
    return {"ok": True, "shutting_down": True}
