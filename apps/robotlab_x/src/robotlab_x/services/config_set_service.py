# unmanaged
"""Config-set resource — service layer (filesystem-backed).

Backs the generated config_set CRUD router (resource_slug "config-sets",
methods list + get_by_id + request). The router is storage-agnostic; the
"store" here is the on-disk ``<data_dir>/config_sets/`` tree:

  GET  /v1/config-sets            → get_all_config_set        (list sets + flags)
  GET  /v1/config-sets/{id}       → get_config_set            (one set's detail)
  POST /v1/config-sets-request    → process_config_set_request(action dispatch:
                                       switch | duplicate | delete)

"switch" doesn't hot-swap — it writes a marker the env-var resolver reads
on next boot; the UI shows a "restart required" toast. Admin-gated by the
generated router (app api.allow_roles = Admin).
"""
from __future__ import annotations

import logging
import os
import re
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml
from config import get_settings
from fastapi import HTTPException, Request

from robotlab_x.runtime.config_sets import (
    DEFAULT_SET_NAME,
    SET_ENV_VAR,
    active_set_name,
    load_runtime_yml,
)

logger = logging.getLogger(__name__)

# Set names sanitized to filesystem-safe chars — prevents traversal.
_SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_\-]*$")
# Marker recording the operator-selected active set (env var wins over it).
ACTIVE_MARKER = "active_set.txt"


# ─── filesystem helpers ───────────────────────────────────────────────

def _data_dir() -> Path:
    p = Path(get_settings().data_dir or "data")
    if not p.is_absolute():
        p = Path.cwd() / p
    return p


def _config_sets_root() -> Path:
    return _data_dir() / "config_sets"


def _validate_name(name: Optional[str]) -> str:
    if not _SAFE_NAME_RE.match(name or ""):
        raise HTTPException(400, f"set name must match [A-Za-z0-9_-]+; got {name!r}")
    return name  # type: ignore[return-value]


def _pending_set_name() -> str:
    """Set chosen for the NEXT boot: env var wins → marker file → default."""
    env = os.environ.get(SET_ENV_VAR, "").strip()
    if env:
        return env
    marker = _config_sets_root() / ACTIVE_MARKER
    if marker.is_file():
        return marker.read_text().strip() or DEFAULT_SET_NAME
    return DEFAULT_SET_NAME


def _scan_proxies(set_dir: Path, start_order: List[str]):
    """(proxies_in_start_order, candidates) as ProxyFileInfo dicts."""
    in_order = set(start_order)
    proxies: Dict[str, Dict[str, Any]] = {}
    candidates: List[Dict[str, Any]] = []
    for path in sorted(set_dir.iterdir()):
        if not path.is_file() or path.suffix != ".yml":
            continue
        if path.name == "runtime.yml" or path.name.startswith("."):
            continue
        proxy_id = path.stem
        try:
            raw = yaml.safe_load(path.read_text())
            if not isinstance(raw, dict):
                info = {"proxy_id": proxy_id, "type_id": None,
                        "in_start_order": proxy_id in in_order,
                        "parse_error": "not a yaml mapping", "path": str(path),
                        "desired_state": None}
            else:
                type_id = raw.get("type")
                ds = raw.get("desired_state")
                info = {"proxy_id": proxy_id,
                        "type_id": type_id if isinstance(type_id, str) else None,
                        "in_start_order": proxy_id in in_order,
                        "parse_error": None if isinstance(type_id, str) else "no type: field",
                        "path": str(path),
                        "desired_state": ds if isinstance(ds, str) else None}
        except yaml.YAMLError as exc:
            info = {"proxy_id": proxy_id, "type_id": None,
                    "in_start_order": proxy_id in in_order,
                    "parse_error": str(exc), "path": str(path), "desired_state": None}
        if proxy_id in in_order:
            proxies[proxy_id] = info
        else:
            candidates.append(info)
    ordered = []
    for proxy_id in start_order:
        ordered.append(proxies.get(proxy_id, {
            "proxy_id": proxy_id, "type_id": None, "in_start_order": True,
            "parse_error": "missing yml file", "path": str(set_dir / f"{proxy_id}.yml"),
            "desired_state": None,
        }))
    return ordered, candidates


def _summaries() -> List[Dict[str, Any]]:
    """One summary dict per set on disk; flags the live `active` set + the
    `pending` (next-boot) one. Mirrors the old list endpoint."""
    root = _config_sets_root()
    active = active_set_name()       # LIVE booted set (pinned)
    pending = _pending_set_name()    # marker — boots next
    root_dir = str(root)

    def _summary(name: str, path: Path, proxy_count: int, has_runtime: bool) -> Dict[str, Any]:
        return {"id": name, "name": name, "active": name == active, "pending": name == pending,
                "proxy_count": proxy_count, "has_runtime_yml": has_runtime,
                "root_dir": root_dir, "path": str(path)}

    if not root.is_dir():
        return [_summary(DEFAULT_SET_NAME, root / DEFAULT_SET_NAME, 0, False)]

    out: List[Dict[str, Any]] = []
    for path in sorted(root.iterdir()):
        if not path.is_dir():
            continue
        proxy_count = sum(
            1 for p in path.iterdir()
            if p.is_file() and p.suffix == ".yml" and p.name != "runtime.yml" and not p.name.startswith(".")
        )
        out.append(_summary(path.name, path, proxy_count, (path / "runtime.yml").is_file()))
    # Active set folder may not exist yet — surface it anyway.
    if not any(s["active"] for s in out):
        out.insert(0, _summary(active, root / active, 0, False))
    return out


# ─── router-facing functions (names dictated by create_crud_router) ───

def get_all_config_set(user: dict, request: Request) -> List[Dict[str, Any]]:
    """GET /v1/config-sets — list every set + active/pending flags."""
    return _summaries()


def get_config_set(record_id: str, user: dict, request: Request) -> Optional[Dict[str, Any]]:
    """GET /v1/config-sets/{id} — one set's detail (start_order + proxies +
    candidates). Returns None → 404 when the set dir is absent."""
    name = _validate_name(record_id)
    set_dir = _config_sets_root() / name
    if not set_dir.is_dir():
        return None
    runtime = load_runtime_yml(set_dir)
    proxies, candidates = _scan_proxies(set_dir, runtime.start_order)
    return {
        "id": name, "name": name,
        "active": name == active_set_name(),
        "pending": name == _pending_set_name(),
        "proxy_count": len(proxies) + len(candidates),
        "has_runtime_yml": (set_dir / "runtime.yml").is_file(),
        "root_dir": str(_config_sets_root()),
        "path": str(set_dir),
        "start_order": runtime.start_order,
        "proxies": proxies,
        "candidates": candidates,
    }


def process_config_set_request(payload: Dict[str, Any], user: dict, request: Request) -> Dict[str, Any]:
    """POST /v1/config-sets-request — action dispatch over the set tree.

    payload: {action: "switch"|"duplicate"|"delete", name, new_name?}.
    Returns {"metadata": {...result...}, "records": <refreshed set list>}
    so the UI can update from the response. Validation failures raise
    HTTPException (the router re-raises it with the right status)."""
    action = (payload or {}).get("action")
    name = (payload or {}).get("name")

    if action == "switch":
        name = _validate_name(name)
        if not (_config_sets_root() / name).is_dir():
            raise HTTPException(404, f"config set {name!r} not found")
        prev = _pending_set_name()
        root = _config_sets_root()
        root.mkdir(parents=True, exist_ok=True)
        (root / ACTIVE_MARKER).write_text(name)
        logger.info("config_sets: active set marker → %s (restart required)", name)
        meta = {"status": "success", "action": "switch", "active": name,
                "previous_active": prev, "restart_required": True,
                "note": "Set takes effect on next backend restart."}

    elif action == "duplicate":
        name = _validate_name(name)
        new_name = _validate_name((payload or {}).get("new_name"))
        src = _config_sets_root() / name
        dst = _config_sets_root() / new_name
        if not src.is_dir():
            raise HTTPException(404, f"source set {name!r} not found")
        if dst.exists():
            raise HTTPException(409, f"target set {new_name!r} already exists")
        shutil.copytree(src, dst)
        marker = dst / ".migrated"
        if marker.is_file():
            marker.unlink()
        logger.info("config_sets: duplicated %s → %s", name, new_name)
        meta = {"status": "success", "action": "duplicate", "source": name, "new_name": new_name}

    elif action == "delete":
        name = _validate_name(name)
        if name == _pending_set_name():
            raise HTTPException(409, "cannot delete the active set; switch first")
        if name == DEFAULT_SET_NAME:
            raise HTTPException(409, f"refusing to delete the {DEFAULT_SET_NAME!r} set")
        target = _config_sets_root() / name
        if not target.is_dir():
            raise HTTPException(404, f"config set {name!r} not found")
        shutil.rmtree(target)
        logger.info("config_sets: deleted %s", name)
        meta = {"status": "success", "action": "delete", "deleted": name}

    else:
        raise HTTPException(400, f"unknown action {action!r} (expected switch|duplicate|delete)")

    return {"metadata": meta, "records": _summaries()}
