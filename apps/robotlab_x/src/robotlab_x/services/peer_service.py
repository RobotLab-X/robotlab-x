# unmanaged
"""Federation peers — service layer.

Backs the generated peer router (resource_slug "peers", methods list +
request). The "store" is the live peer_manager state, mirrored into the
runtime singleton's service_config.peers for restart-survival:

  GET  /v1/peers           → get_all_peer            (live peer snapshot)
  POST /v1/peers-request   → process_peer_request    (action: connect | disconnect)

Was the peer_api escape-hatch router; promoted to a normal DSL model
since a peer is a record (key/url/remote_id/state) with actions.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List

from database.factory import get_database_client
from fastapi import HTTPException, Request

from robotlab_x.runtime import peer_manager

logger = logging.getLogger(__name__)


def _current_peer_urls() -> List[str]:
    return [info["url"] for info in peer_manager.peers().values()]


def _persist_peers(urls: List[str]) -> None:
    """Mirror the active peer URLs into the runtime singleton's
    service_config.peers so reboots reconnect. Best-effort."""
    db = get_database_client()
    if db is None:
        return
    proxy = db.get_item("service_proxy", "runtime")
    if not proxy:
        return
    cfg = dict(proxy.get("service_config") or {})
    cfg["peers"] = sorted(set(urls))
    proxy["service_config"] = cfg
    try:
        db.update_item("service_proxy", "runtime", proxy, include_nulls=True)
    except Exception:  # noqa: BLE001
        logger.exception("peer_service: failed to persist peers")


def _snapshot() -> List[Dict[str, Any]]:
    return [{"id": key, "key": key, **info} for key, info in sorted(peer_manager.peers().items())]


def get_all_peer(user: dict, request: Request) -> List[Dict[str, Any]]:
    """GET /v1/peers — snapshot of every known peer + state."""
    return _snapshot()


def _run_async(coro) -> None:
    """Run a peer_manager coroutine to completion. disconnect() must run on
    the manager's own event loop (where the connections live); we're called
    from a sync threadpool worker, so schedule it there and wait."""
    loop = getattr(peer_manager, "_manager_loop", None)
    if loop is not None:
        asyncio.run_coroutine_threadsafe(coro, loop).result(timeout=15)
    else:
        asyncio.run(coro)


def process_peer_request(payload: Dict[str, Any], user: dict, request: Request) -> Dict[str, Any]:
    """POST /v1/peers-request {action: connect|disconnect, …}.

    connect: {url} — open/look-up a connection (idempotent), persist it.
    disconnect: {key} — drop a peer by remote_id or url, unpersist.
    Returns {"metadata": {...}, "records": <refreshed peer snapshot>}."""
    action = (payload or {}).get("action")

    if action == "connect":
        url = (payload or {}).get("url")
        if not url:
            raise HTTPException(400, "connect requires 'url'")
        try:
            pc = peer_manager.connect(url)
        except Exception as exc:  # noqa: BLE001
            logger.exception("peer_service.connect failed for %s", url)
            raise HTTPException(500, str(exc))
        _persist_peers(_current_peer_urls())
        meta = {"status": "success", "action": "connect",
                "key": pc.remote_id or pc.url, "url": pc.url,
                "remote_id": pc.remote_id, "state": pc.state.value}

    elif action == "disconnect":
        key = (payload or {}).get("key") or (payload or {}).get("name")
        if not key:
            raise HTTPException(400, "disconnect requires 'key'")
        known = key in peer_manager.peers()
        _run_async(peer_manager.disconnect(key))
        if known:
            _persist_peers(_current_peer_urls())
        meta = {"status": "success", "action": "disconnect", "key": key, "disconnected": known}

    else:
        raise HTTPException(400, f"unknown action {action!r} (expected connect|disconnect)")

    return {"metadata": meta, "records": _snapshot()}
