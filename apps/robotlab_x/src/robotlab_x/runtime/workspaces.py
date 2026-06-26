# unmanaged
"""Workspace lifecycle helpers.

Two responsibilities, kept here so the surface of ``event_handlers.on_startup``
stays small:

  1. ``ensure_runtime_workspace`` materialises the singleton "runtime"
     workspace row on boot — the always-present canvas the user lands on.
  2. ``restore_active_workspaces`` re-fires ``start_service`` for every
     member of any workspace whose ``activated_at`` survived the last shutdown.

Membership for kind='runtime' is computed at read-time in
``services.workspace_service`` — this module deliberately does not stamp a
``service_proxy_ids`` list on the runtime row.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List

from database.interface import DatabaseAdapter

logger = logging.getLogger(__name__)

RUNTIME_WORKSPACE_ID = "runtime"


def ensure_runtime_workspace(db: DatabaseAdapter) -> Dict[str, Any]:
    """Create the singleton runtime workspace row if it's missing.

    Idempotent. The row's layout (node_positions, edges, viewport) survives
    across reboots; membership does not.
    """
    existing = db.get_item("workspace", RUNTIME_WORKSPACE_ID)
    if existing:
        # Cheap migration for installs that pre-date the kind field.
        if existing.get("kind") != "runtime":
            existing["kind"] = "runtime"
            existing["updated_at"] = datetime.now(timezone.utc).isoformat()
            db.update_item("workspace", RUNTIME_WORKSPACE_ID, existing, include_nulls=True)
        return existing

    now = datetime.now(timezone.utc).isoformat()
    row: Dict[str, Any] = {
        "id": RUNTIME_WORKSPACE_ID,
        "name": "Runtime",
        "description": "Live view of every running service. Always available; cannot be deleted.",
        "kind": "runtime",
        "status": "active",
        # Members are computed; don't stamp a list here.
        "service_proxy_ids": None,
        "node_positions": {},
        "edges": [],
        "dashboard": None,
        "viewport": None,
        "activated_at": None,
        "created_at": now,
        "updated_at": now,
    }
    db.insert_item("workspace", RUNTIME_WORKSPACE_ID, row)
    logger.info("Created singleton runtime workspace")
    return row


def reconcile_running_proxies(db: DatabaseAdapter) -> None:
    """Re-fire start_service for every non-singleton proxy that was running.

    On boot, ``service_proxy.status`` rows still say 'running' / 'starting'
    from the previous backend lifetime — but the processes are gone. Reset
    those rows to 'stopped' and fire start_service so they come back up.
    Singletons (the runtime service) are auto-materialised elsewhere and
    must not be re-started here.
    """
    from robotlab_x.runtime.lifecycle import _handle_start  # noqa: WPS433
    from robotlab_x.runtime import process_manager

    proxies: List[Dict[str, Any]] = db.get_all_items("service_proxy") or []
    stale: List[Dict[str, Any]] = []
    survived: List[str] = []
    for p in proxies:
        if p.get("status") not in {"running", "starting"}:
            continue
        meta_id = p.get("service_meta_id")
        meta = db.get_item("service_meta", meta_id) if meta_id else None
        if meta and "singleton" in (meta.get("tags") or []):
            continue
        # Subprocess survived our restart — its rlx_bus client will
        # reconnect and the discovery listener will reaffirm its row.
        # Leave it alone; spawning a duplicate would race for the
        # service_meta-owned resource (port, serial device, etc.).
        if process_manager.pid_alive(p.get("pid")):
            survived.append(p.get("id") or "?")
            continue
        stale.append(p)

    if survived:
        logger.info("reconcile_running_proxies: survived restart: %s", survived)
    if not stale:
        if not survived:
            logger.info("reconcile_running_proxies: no stale running proxies")
        return

    for p in stale:
        proxy_id = p.get("id")
        if not proxy_id:
            continue
        p["status"] = "stopped"
        p["pid"] = None
        p["error"] = None
        db.update_item("service_proxy", proxy_id, p, include_nulls=True)
        try:
            _handle_start({"id": f"restore-{proxy_id}", "service_proxy_id": proxy_id}, db)
            logger.info("reconcile_running_proxies: restarted %s", proxy_id)
        except Exception:  # noqa: BLE001
            logger.exception("reconcile_running_proxies: failed to restart %s", proxy_id)


def restore_active_workspaces(db: DatabaseAdapter) -> None:
    """Mark previously-active workspaces as active again.

    After ``reconcile_running_proxies`` has revived the services, just
    re-stamp ``activated_at`` and ``status='active'`` on workspaces that
    were active before shutdown. We don't need to fire start_service here
    because reconcile already handled it.
    """
    from datetime import datetime, timezone

    workspaces: List[Dict[str, Any]] = db.get_all_items("workspace") or []
    candidates = [
        w for w in workspaces
        if w.get("kind") != "runtime" and w.get("activated_at")
    ]
    if not candidates:
        logger.info("restore_active_workspaces: no active workspaces to re-stamp")
        return
    now_iso = datetime.now(timezone.utc).isoformat()
    for ws in candidates:
        ws_id = ws.get("id") or ws.get("name")
        ws["activated_at"] = now_iso
        ws["status"] = "active"
        db.update_item("workspace", ws_id, ws, include_nulls=True)
        logger.info("restore_active_workspaces: re-stamped %s as active", ws_id)
