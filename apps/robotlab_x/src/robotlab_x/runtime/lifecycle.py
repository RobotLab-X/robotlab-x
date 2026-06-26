# unmanaged
"""Service lifecycle state machine — the runtime's lifecycle owner.

This module belongs to the ``runtime`` singleton service (the
robotlab_x backend itself). The runtime owns the *registry* of managed
service instances: the ``service_proxy`` table is the registry, and
every row in it is a service the runtime is responsible for.

Flow: a ``service_request`` row arrives via ``POST /v1/service-request``
with an ``action`` in {install, start, stop, restart, uninstall,
activate_workspace, deactivate_workspace} and either a
``service_meta_id`` (install only) or a ``service_proxy_id``. This
module then:

1. Transitions the service_proxy row's ``status`` field (the registry
   entry's authoritative state).
2. For pip services: hands off to ``process_manager`` which spawns and
   supervises a real subprocess. For builtins: hands off to the
   in-process runner in ``runtime/builtins``.
3. Publishes events on two bus topics so subscribers see live state:
   - ``/service_proxy/{id}/lifecycle`` — every state transition.
   - ``/service_request/{id}/progress`` — progress for the originating request.
4. Marks the service_request row as ``completed`` or ``failed`` and
   stamps ``completed_at`` + ``result``.

Errors here are caught at the boundary — a failed lifecycle still leaves
the request row in a terminal ``failed`` state so the UI can show *why*.

Singleton constraint: types tagged ``singleton`` (currently just
``runtime`` itself) refuse duplicate install + refuse stop/uninstall on
their lone instance. The runtime can't kill its own runtime instance.
"""

from __future__ import annotations

import logging
import os
import random
import shutil
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from pathlib import Path

from config import get_settings
from database.interface import DatabaseAdapter
from database.factory import get_database_client

from robotlab_x.runtime.bus import get_bus
from robotlab_x.runtime import installer
from robotlab_x.runtime import system
from robotlab_x import framework

# Process-level lock around create_service. Without it, two simultaneous
# install requests for the same proxy_name can both pass the "does this
# row exist?" check before either commits, producing duplicate rows.
# Install is rare; a single coarse lock is fine.
_INSTALL_LOCK = threading.Lock()


logger = logging.getLogger(__name__)

# Canonical action verbs the lifecycle pipeline dispatches on. The
# service-level verbs all carry the `_service` suffix to mirror the
# `activate_workspace` / `deactivate_workspace` shape — subject first,
# then the action.
_ACTIONS = {
    "create_service",
    "start_service",
    "stop_service",
    "restart_service",
    "release_service",
    "uninstall_type",
    "activate_workspace",
    "deactivate_workspace",
}

# Legacy verbs (Phase 3) kept working by aliasing to the canonical
# names. The wire protocol accepts either; the dispatch table only
# carries the canonical entries. Add an alias here when renaming a
# verb so existing UIs/tests/scripts don't break.
_ACTION_ALIASES = {
    "install": "create_service",
    "create": "create_service",
    "start": "start_service",
    "stop": "stop_service",
    "restart": "restart_service",
    "uninstall": "release_service",
    "release": "release_service",
}


def _canonical_action(action: object) -> object:
    """Normalize action verbs. Strings go through the alias table; other
    types pass through so the existing 'unsupported action' error still
    fires for non-strings."""
    if isinstance(action, str):
        return _ACTION_ALIASES.get(action, action)
    return action


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _proxy_lifecycle_topic(proxy_id: str) -> str:
    return f"/service_proxy/{proxy_id}/lifecycle"


def _workspace_activation_topic(workspace_id: str) -> str:
    return f"/workspace/{workspace_id}/activation"


def _request_progress_topic(request_id: str) -> str:
    return f"/service_request/{request_id}/progress"


def _resolve_repo_dir() -> Path:
    """Return the absolute repo dir from config.repo_dir."""
    settings = get_settings()
    raw = (settings.repo_dir or "repo")
    p = Path(raw)
    if not p.is_absolute():
        # Resolve against the cwd the backend was launched from. For the
        # generated install.sh + python -m robotlab_x.main flow this is
        # apps/robotlab_x/, which is what we want.
        p = Path.cwd() / p
    p.mkdir(parents=True, exist_ok=True)
    return p


def _publish_progress(
    request_id: str,
    step: str,
    status: str,
    detail: Optional[str] = None,
) -> None:
    bus = get_bus()
    bus.publish_sync(
        _request_progress_topic(request_id),
        {"request_id": request_id, "step": step, "status": status, "detail": detail},
    )


def _publish_install_event(request_id: str, event: Dict[str, Any]) -> None:
    """Publish one structured installer milestone to the request's progress
    topic. Same topic as _publish_progress, but the payload carries step
    metadata (phase, step_id, label, index, total, status, detail, stream,
    error_code) so the UI can render a step list + collapsible raw log
    rather than a flat stream of pip lines.
    """
    bus = get_bus()
    bus.publish_sync(
        _request_progress_topic(request_id),
        {"request_id": request_id, "phase": "install", **event},
    )


def _publish_lifecycle(proxy: Dict[str, Any]) -> None:
    bus = get_bus()
    proxy_id = proxy.get("id")
    if not proxy_id:
        return
    # Snapshot — callers mutate the same dict across transitions and we
    # don't want the queued earlier message to reflect a later mutation.
    bus.publish_sync(
        _proxy_lifecycle_topic(proxy_id),
        dict(proxy),
        retained=True,  # late subscribers should see current state immediately
    )


def _publish_service_meta(meta: Dict[str, Any]) -> None:
    """Publish a catalog-type change (e.g. installed flag flipped by a type
    install/uninstall) so the UI's REPO palette badge updates live without
    a refetch."""
    mid = meta.get("id")
    if not mid:
        return
    get_bus().publish_sync(f"/service_meta/{mid}/changed", dict(meta), retained=True)


# ─── action handlers ────────────────────────────────────────────────────


def _ensure_type_installed(
    meta: Dict[str, Any], progress_req_id: str, db: Optional[DatabaseAdapter] = None
) -> None:
    """Idempotently ensure a service TYPE's dependencies are installed.

    Per-type-version venv + pip install, shared by every instance of that
    type. Builtin (in-process) types are a no-op. Safe to call repeatedly:
    it short-circuits when the venv already exists, so it's cheap to call
    on every Start. Raises on install failure (caller owns proxy state).

    On success it stamps ``service_meta.installed=True`` (when ``db`` is
    supplied) so the REPO palette badge, the install-wizard gate, and the
    Start self-heal all read a truthful flag — without it, lazy
    install-on-Start never flipped the flag and the type looked perpetually
    not-installed.

    Extracted from the old create-time install so the same logic can run
    lazily on first Start — see _handle_start. This is the M1 decouple:
    dropping a service no longer pip-installs; Start does.
    """
    package_spec = meta.get("package_spec")
    dependency_manager = meta.get("dependency_manager")
    if not (package_spec and dependency_manager):
        # Builtin (in-process) — no venv, no install. The runner is the
        # backend process itself.
        _publish_progress(progress_req_id, "install", "running", "builtin — no install step")
        return

    # Real install via the manager dispatcher (pip today; npm/mvn/docker
    # raise a structured unsupported error). The venv lives at
    # <repo>/<name>/<version>/.venv and is shared by every instance of that
    # type. ${APP_ROOT} substitutes to the parent of config.repo_dir so
    # editable specs resolve consistently regardless of cwd.
    repo_dir = _resolve_repo_dir()
    app_root = repo_dir.parent
    resolved_spec = package_spec.replace("${APP_ROOT}", str(app_root))

    meta_id = meta.get("id") or f"{meta.get('name')}@{meta.get('version')}"
    try:
        type_name, type_version = meta_id.split("@", 1)
    except ValueError:
        raise ValueError(f"invalid service_meta_id {meta_id!r} (expected name@version)")
    type_dir = repo_dir / type_name / type_version
    venv_slot = f"{type_name}/{type_version}"

    # Multi-root: the type's SOURCE may live in a read-only repo_paths root
    # (e.g. the image's bundled repo/) while repo_dir is a SEPARATE writable
    # root (a persisted var/repo volume on the s1 deploy). The per-type venv
    # must build in the writable root, so copy the source there first if it
    # isn't already present. ${APP_ROOT}/repo resolves to repo_dir, so the
    # editable spec then points at this copied source. Without this, pip
    # installs an editable spec pointing at an empty dir → "exit 1".
    if not (type_dir / "package.yml").exists():
        # Best-effort: locate the source in another root. If settings/roots
        # aren't resolvable (e.g. unit tests that stub _resolve_repo_dir),
        # fall back to the prior behaviour and let install proceed as before.
        try:
            from robotlab_x.runtime.repo import find_type_dir
            src = find_type_dir(get_settings(), type_name, type_version)
        except Exception:  # noqa: BLE001
            src = None
        if src is not None and src.resolve() != type_dir.resolve():
            type_dir.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(
                src, type_dir, dirs_exist_ok=True,
                ignore=shutil.ignore_patterns(".venv", "__pycache__", "*.pyc"),
            )
            _publish_progress(
                progress_req_id, "install", "running",
                f"copied {type_name}@{type_version} source into the writable repo",
            )

    # SHORT-CIRCUIT: a service TYPE only needs pip-install once. Re-starting
    # an instance (or starting a second instance) of a type whose venv
    # already exists skips pip — saves seconds and avoids noisy output when
    # the deps are already resolved. The explicit "release the type" path
    # (future work) is the way to force a reinstall.
    venv_bin = type_dir / ".venv" / "bin"
    if venv_bin.exists():
        _publish_progress(
            progress_req_id, "install", "running",
            f"type {type_name}@{type_version} already installed — skipping pip",
        )
    else:
        def on_event(event: Dict[str, Any]) -> None:
            _publish_install_event(progress_req_id, event)

        installer.install(
            dependency_manager,
            resolved_spec,
            venv_slot,
            repo_dir,
            on_event=on_event,
        )

    # The venv is present now — stamp the catalog flag truthful.
    _mark_type_installed(meta, db)


def _mark_type_installed(meta: Dict[str, Any], db: Optional[DatabaseAdapter]) -> None:
    """Flip service_meta.installed→True (clearing any prior exception) and
    broadcast, after a successful type install. No-op without a db handle
    or when already marked."""
    if db is None or meta.get("installed"):
        return
    meta_id = meta.get("id")
    if not meta_id:
        return
    meta["installed"] = True
    meta["installation_exception"] = None
    db.update_item("service_meta", meta_id, meta, include_nulls=True)
    _publish_service_meta(meta)


def _handle_install(req: Dict[str, Any], db: DatabaseAdapter) -> Dict[str, Any]:
    """Create a new service_proxy row from a service_meta_id.

    Atomic — the entire check-and-insert (existence guard, singleton
    guard, row insert) runs under _INSTALL_LOCK so two concurrent
    requests for the same proxy_name can't both pass the guards.
    """
    if system.is_draining():
        raise ValueError("runtime is shutting down for restart — not creating services")
    service_meta_id = req.get("service_meta_id")
    proxy_name = req.get("proxy_name") or req.get("service_proxy_id")
    if not service_meta_id:
        raise ValueError("install requires service_meta_id")
    if not proxy_name:
        raise ValueError("install requires proxy_name")

    meta = db.get_item("service_meta", service_meta_id)
    if not meta:
        raise ValueError(f"service_meta '{service_meta_id}' not found")

    # Atomic guard-and-insert. Without the lock, request A reads
    # service_proxy[name]=None, request B reads the same, both fall
    # through and call insert_item — and even with insert_item's
    # duplicate guard one of them errors AFTER the other already
    # half-committed (status='installing' published, etc.). The lock
    # makes the create flow single-threaded per backend, which is
    # fine — install is rare and never on a hot path.
    with _INSTALL_LOCK:
        existing = db.get_item("service_proxy", proxy_name)
        if existing:
            raise ValueError(f"service_proxy '{proxy_name}' already exists")

        # Singleton-per-process types (runtime) allow at most one
        # instance. The catalog seeder auto-creates that instance on
        # startup, so any explicit install attempt arrives second.
        if "singleton" in (meta.get("tags") or []):
            siblings = [
                p for p in (db.get_all_items("service_proxy") or [])
                if p.get("service_meta_id") == service_meta_id
            ]
            if siblings:
                raise ValueError(
                    f"{meta.get('name')} is a singleton — instance '{siblings[0].get('id')}' "
                    "already exists in this backend"
                )

        # M1 decouple: a "placeholder" proxy is dropped on the canvas but
        # NOT installed — it shows a grey light + Play button, and the
        # type's deps install lazily on first Start (_handle_start). The
        # UI drop path sets placeholder=True. Eager callers (catalog
        # seeder, programmatic/legacy installs) omit the flag and keep the
        # original install-now behaviour.
        placeholder = bool(req.get("placeholder"))
        proxy = {
            "id": proxy_name,
            "name": proxy_name,
            "service_meta_id": service_meta_id,
            "status": "placeholder" if placeholder else "installing",
            "configured": False,
            "created_at": _now_iso(),
            "service_config": req.get("config") or {},
        }
        db.insert_item("service_proxy", proxy_name, proxy)
    _publish_lifecycle(proxy)

    if placeholder:
        # Stop here: no venv, no pip. The proxy waits at "placeholder"
        # until Start installs the type and launches the instance.
        _publish_progress(req["id"], "install", "completed")
        return proxy

    # Eager (legacy) flow: install the type's deps now, then mark installed.
    try:
        _ensure_type_installed(meta, req["id"], db)
    except Exception as exc:
        proxy["status"] = "error"
        proxy["error"] = str(exc)
        db.update_item("service_proxy", proxy_name, proxy, include_nulls=True)
        _publish_lifecycle(proxy)
        raise

    proxy["status"] = "installed"
    proxy["installed_at"] = _now_iso()
    db.update_item("service_proxy", proxy_name, proxy, include_nulls=True)
    _publish_lifecycle(proxy)
    _publish_progress(req["id"], "install", "completed")
    return proxy


def _handle_start(req: Dict[str, Any], db: DatabaseAdapter) -> Dict[str, Any]:
    if system.is_draining():
        raise ValueError("runtime is shutting down for restart — not starting services")
    proxy_id = req.get("service_proxy_id")
    if not proxy_id:
        raise ValueError("start requires service_proxy_id")
    proxy = db.get_item("service_proxy", proxy_id)
    if not proxy:
        raise ValueError(f"service_proxy '{proxy_id}' not found")
    # 'placeholder' is startable — that's the M1 decouple: a dropped node
    # installs its type's deps on first Start. 'error' is startable too —
    # the "fix the config and try again" path after a crash (the crash
    # watcher writes 'error' back, and Start retries from there).
    if proxy.get("status") not in {"placeholder", "installed", "stopped", "error"}:
        raise ValueError(
            f"cannot start service_proxy '{proxy_id}' from status="
            f"{proxy.get('status')!r}"
        )

    meta = db.get_item("service_meta", proxy.get("service_meta_id")) or {}

    # Merge any config carried on the request (e.g. install-wizard inputs)
    # into the instance's stored config before we install/launch, so the
    # subprocess's config_state retained publish below picks it up.
    req_config = req.get("config")
    if isinstance(req_config, dict) and req_config:
        proxy["service_config"] = {**(proxy.get("service_config") or {}), **req_config}
        # The user has been through a wizard (install inputs or per-instance
        # config), so mark the instance configured — the config gate won't
        # re-prompt on subsequent starts.
        proxy["configured"] = True
        db.update_item("service_proxy", proxy_id, proxy, include_nulls=True)

    # Lazy type-install. A placeholder has never been installed; install
    # its deps now (idempotent — no-op for builtins, short-circuits when
    # the venv already exists, e.g. a sibling instance installed it). On
    # failure the proxy lands in 'error' and Start can be retried.
    #
    # Self-heal: install on a placeholder OR whenever a pip type isn't
    # installed (its venv was uninstalled / hand-deleted / corrupted). This
    # makes Start always launch against a present venv, so type uninstall →
    # reinstall is repeatable even for non-placeholder instances.
    needs_install = proxy.get("status") == "placeholder" or (
        bool(meta.get("package_spec"))
        and bool(meta.get("dependency_manager"))
        and not meta.get("installed")
    )
    if needs_install:
        proxy["status"] = "installing"
        db.update_item("service_proxy", proxy_id, proxy, include_nulls=True)
        _publish_lifecycle(proxy)
        _publish_progress(req["id"], "install", "running")
        try:
            _ensure_type_installed(meta, req["id"], db)
        except Exception as exc:
            proxy["status"] = "error"
            proxy["error"] = str(exc)
            db.update_item("service_proxy", proxy_id, proxy, include_nulls=True)
            _publish_lifecycle(proxy)
            _publish_progress(req["id"], "install", "failed", str(exc))
            raise
        proxy["installed_at"] = _now_iso()
        _publish_progress(req["id"], "install", "completed")

    proxy["status"] = "starting"
    db.update_item("service_proxy", proxy_id, proxy, include_nulls=True)
    _publish_lifecycle(proxy)
    _publish_progress(req["id"], "start", "running")
    # Single dispatch point — the framework picks in-process vs subprocess
    # based on the service_meta row. Lifecycle no longer branches.
    adapter = framework.pick_adapter(meta)
    config = proxy.get("service_config") or {}
    # Publish the proxy's stored config on a retained topic BEFORE we
    # spawn the subprocess, so the subprocess's bus-client subscribe
    # picks it up immediately. Without this, subprocess services have
    # no way to read their persisted config (e.g. arduino's last_port).
    get_bus().publish_sync(
        f"/service_proxy/{proxy_id}/config_state",
        dict(config),
        retained=True,
    )
    try:
        handle = adapter.start(proxy, meta, config)
    except Exception as exc:
        # Record the real failure on the row BEFORE re-raising. Without
        # this the proxy would sit at status="starting", pid=None until
        # the reconciler stamps a generic "reconciler detected dead pid"
        # 15s later — destroying the actual diagnostic.
        proxy["status"] = "error"
        proxy["pid"] = None
        proxy["error"] = f"{type(exc).__name__}: {exc}"
        proxy["stopped_at"] = _now_iso()
        db.update_item("service_proxy", proxy_id, proxy, include_nulls=True)
        _publish_lifecycle(proxy)
        raise
    framework.REGISTRY.put(handle, adapter)
    proxy["pid"] = handle.pid
    proxy["host"] = handle.host
    proxy["port"] = handle.port

    proxy["status"] = "running"
    proxy["started_at"] = _now_iso()
    proxy["stopped_at"] = None
    proxy["error"] = None
    db.update_item("service_proxy", proxy_id, proxy, include_nulls=True)
    _publish_lifecycle(proxy)
    _publish_progress(req["id"], "start", "completed")
    return proxy


def _handle_stop(req: Dict[str, Any], db: DatabaseAdapter) -> Dict[str, Any]:
    proxy_id = req.get("service_proxy_id")
    if not proxy_id:
        raise ValueError("stop requires service_proxy_id")
    proxy = db.get_item("service_proxy", proxy_id)
    if not proxy:
        raise ValueError(f"service_proxy '{proxy_id}' not found")
    # 'error' / 'stopped' are no-ops — the user wanted the service not
    # running and it isn't. Better UX than refusing.
    if proxy.get("status") in {"stopped", "error", "uninstalled"}:
        return proxy
    # Row says running/starting, but the actual PID is gone — crashed
    # without the crash-watcher seeing it, or a previous backend lifetime
    # owned this row. Flip to stopped and return success; nothing to kill.
    from robotlab_x.runtime import process_manager
    if (
        proxy.get("status") in {"running", "starting"}
        and proxy.get("pid") is not None
        and not process_manager.pid_alive(proxy.get("pid"))
    ):
        proxy["status"] = "stopped"
        proxy["pid"] = None
        proxy["port"] = None
        proxy["stopped_at"] = _now_iso()
        db.update_item("service_proxy", proxy_id, proxy, include_nulls=True)
        _publish_lifecycle(proxy)
        return proxy
    if proxy.get("status") not in {"running", "starting"}:
        raise ValueError(
            f"cannot stop service_proxy '{proxy_id}' from status="
            f"{proxy.get('status')!r}"
        )

    # Singleton runtime instances back the backend itself — stopping
    # them via the lifecycle would be self-destructive (we'd be asking
    # the running backend to shut down its own runtime). Refuse.
    meta = db.get_item("service_meta", proxy.get("service_meta_id")) or {}
    if "singleton" in (meta.get("tags") or []):
        raise ValueError(
            f"refusing to stop '{proxy_id}' — it is the singleton instance of "
            f"'{meta.get('name')}'. Stop the backend process instead."
        )

    proxy["status"] = "stopping"
    db.update_item("service_proxy", proxy_id, proxy, include_nulls=True)
    _publish_lifecycle(proxy)
    _publish_progress(req["id"], "stop", "running")

    # Tear down via the framework. The registry remembers which adapter
    # owns this proxy; lifecycle no longer cares about the transport.
    handle = framework.REGISTRY.get(proxy_id)
    adapter = framework.REGISTRY.adapter_for(proxy_id)
    if handle is not None and adapter is not None:
        adapter.stop(handle)
        framework.REGISTRY.remove(proxy_id)

    proxy["status"] = "stopped"
    proxy["pid"] = None
    proxy["stopped_at"] = _now_iso()
    db.update_item("service_proxy", proxy_id, proxy, include_nulls=True)
    _publish_lifecycle(proxy)
    _publish_progress(req["id"], "stop", "completed")
    return proxy


def _handle_restart(req: Dict[str, Any], db: DatabaseAdapter) -> Dict[str, Any]:
    proxy_id = req.get("service_proxy_id")
    proxy = db.get_item("service_proxy", proxy_id) if proxy_id else None
    if not proxy:
        raise ValueError(f"service_proxy '{proxy_id}' not found")
    # Only stop if currently running; tolerate restarting an already-stopped one.
    if proxy.get("status") in {"running", "starting"}:
        _handle_stop(req, db)
    return _handle_start(req, db)


def _handle_uninstall(req: Dict[str, Any], db: DatabaseAdapter) -> Dict[str, Any]:
    proxy_id = req.get("service_proxy_id")
    if not proxy_id:
        raise ValueError("uninstall requires service_proxy_id")
    proxy = db.get_item("service_proxy", proxy_id)
    if not proxy:
        raise ValueError(f"service_proxy '{proxy_id}' not found")
    if proxy.get("status") in {"running", "starting"}:
        # Liveness check — the row may be lying. If the recorded PID is
        # dead, treat the proxy as effectively-stopped and proceed with
        # release. Saves the user a "stop first" dance for a service
        # that's not actually running.
        from robotlab_x.runtime import process_manager
        if proxy.get("pid") is None or not process_manager.pid_alive(proxy.get("pid")):
            logger.info(
                "uninstall %s: row claimed status=%s pid=%s but the process is gone — proceeding",
                proxy_id, proxy.get("status"), proxy.get("pid"),
            )
        else:
            raise ValueError(
                f"refusing to uninstall service_proxy '{proxy_id}' while "
                f"status={proxy.get('status')!r} — stop it first"
            )

    # Singleton instances back the backend itself — uninstalling would
    # be self-destructive (and the catalog seeder would just recreate
    # the row on next boot anyway). Refuse the request.
    meta = db.get_item("service_meta", proxy.get("service_meta_id")) or {}
    if "singleton" in (meta.get("tags") or []):
        raise ValueError(
            f"refusing to uninstall '{proxy_id}' — it is the singleton instance of "
            f"'{meta.get('name')}' (the backend itself). Singleton runtimes can't be removed."
        )

    final_state = dict(proxy)
    final_state["status"] = "uninstalled"
    final_state["pid"] = None
    db.delete_item("service_proxy", proxy_id)

    # Tidy workspace references. Without this, the layout map keeps the
    # released id and the UI either shows a ghost node forever or — on
    # the runtime canvas where membership is computed — silently keeps
    # the orphan position around for a future proxy of the same name.
    _tidy_workspace_refs(db, proxy_id)

    _publish_lifecycle(final_state)
    _publish_progress(req["id"], "uninstall", "completed")
    return final_state


def _tidy_workspace_refs(db: DatabaseAdapter, proxy_id: str) -> None:
    """Strip ``proxy_id`` from every workspace's stored references.

    Touched fields per workspace:
      * service_proxy_ids  (kind='user' only — runtime workspaces compute)
      * node_positions     (any kind — layout map keyed by proxy id)
      * node_view_types    (any kind — per-node view variant)
      * edges              (any edge whose source or target is this proxy)

    Workspaces are only updated when at least one field actually changed,
    so this is a no-op for workspaces unrelated to the released proxy.
    """
    workspaces = db.get_all_items("workspace") or []
    for ws in workspaces:
        changed = False
        ws_id = ws.get("id")
        if not ws_id:
            continue

        members = ws.get("service_proxy_ids")
        if isinstance(members, list) and proxy_id in members:
            ws["service_proxy_ids"] = [p for p in members if p != proxy_id]
            changed = True

        positions = ws.get("node_positions")
        if isinstance(positions, dict) and proxy_id in positions:
            new_positions = dict(positions)
            new_positions.pop(proxy_id, None)
            ws["node_positions"] = new_positions
            changed = True

        view_types = ws.get("node_view_types")
        if isinstance(view_types, dict) and proxy_id in view_types:
            new_view = dict(view_types)
            new_view.pop(proxy_id, None)
            ws["node_view_types"] = new_view
            changed = True

        edges = ws.get("edges")
        if isinstance(edges, list):
            kept = [
                e for e in edges
                if not (isinstance(e, dict) and (e.get("source") == proxy_id or e.get("target") == proxy_id))
            ]
            if len(kept) != len(edges):
                ws["edges"] = kept
                changed = True

        if changed:
            db.update_item("workspace", ws_id, ws, include_nulls=True)
            # Tell connected UIs the workspace changed so they refetch.
            # Without this, tab A releases a proxy → tab B still shows
            # the old node_positions until a page reload.
            get_bus().publish_sync(
                f"/workspace/{ws_id}/changed",
                {"workspace_id": ws_id, "reason": "tidy", "proxy_id": proxy_id},
            )
            logger.info("tidy_workspace_refs: stripped %s from %s", proxy_id, ws_id)


def _publish_workspace(workspace: Dict[str, Any], event: str, detail: Optional[str] = None) -> None:
    bus = get_bus()
    ws_id = workspace.get("id")
    if not ws_id:
        return
    bus.publish_sync(
        _workspace_activation_topic(ws_id),
        {
            "workspace_id": ws_id,
            "event": event,
            "status": workspace.get("status"),
            "detail": detail,
        },
        retained=True,
    )


def _is_singleton_proxy(db: DatabaseAdapter, proxy: Dict[str, Any]) -> bool:
    """True iff the proxy's service_meta is tagged singleton (e.g. runtime)."""
    meta_id = proxy.get("service_meta_id")
    if not meta_id:
        return False
    meta = db.get_item("service_meta", meta_id)
    return bool(meta) and "singleton" in (meta.get("tags") or [])


def _other_workspaces_claiming(
    db: DatabaseAdapter, proxy_id: str, exclude_workspace_id: str,
) -> list[str]:
    """Return ids of currently-active *user* workspaces that also reference
    ``proxy_id``. Runtime workspace doesn't count — its membership is
    computed from the live registry, not a saved claim.
    """
    out: list[str] = []
    for ws in db.get_all_items("workspace") or []:
        if ws.get("id") == exclude_workspace_id:
            continue
        if ws.get("kind") == "runtime":
            continue
        if not ws.get("activated_at"):
            continue
        if proxy_id in (ws.get("service_proxy_ids") or []):
            out.append(ws.get("id") or ws.get("name"))
    return out


def _handle_activate_workspace(req: Dict[str, Any], db: DatabaseAdapter) -> Dict[str, Any]:
    """Start every service_proxy referenced by the workspace.

    Partial failures don't abort the whole activation — each proxy is
    handled independently so the user can see which ones succeeded. The
    workspace's terminal status reflects whether all proxies reached
    ``running``.
    """
    workspace_id = req.get("workspace_id")
    if not workspace_id:
        raise ValueError("activate_workspace requires workspace_id")
    workspace = db.get_item("workspace", workspace_id)
    if not workspace:
        raise ValueError(f"workspace '{workspace_id}' not found")
    if workspace.get("kind") == "runtime":
        # The runtime canvas is always live; there's no batch activation
        # verb for it. Individual services are still controllable.
        raise ValueError("runtime workspace cannot be activated/deactivated")

    proxy_ids = workspace.get("service_proxy_ids") or []
    workspace["status"] = "activating"
    db.update_item("workspace", workspace_id, workspace, include_nulls=True)
    _publish_workspace(workspace, "activating")
    _publish_progress(req["id"], "activate_workspace", "running", f"{len(proxy_ids)} proxies")

    failures: list[str] = []
    for proxy_id in proxy_ids:
        proxy = db.get_item("service_proxy", proxy_id)
        if not proxy:
            failures.append(f"{proxy_id}: not found")
            continue
        if proxy.get("status") == "running":
            continue  # already up — nothing to do
        try:
            _handle_start({"id": req["id"], "service_proxy_id": proxy_id}, db)
        except Exception as exc:  # noqa: BLE001
            failures.append(f"{proxy_id}: {exc}")

    now_iso = datetime.now(timezone.utc).isoformat()
    if failures:
        workspace["status"] = "degraded"
        detail = "; ".join(failures)
    else:
        workspace["status"] = "active"
        detail = None
    workspace["activated_at"] = now_iso
    db.update_item("workspace", workspace_id, workspace, include_nulls=True)
    _publish_workspace(workspace, workspace["status"], detail)
    _publish_progress(
        req["id"],
        "activate_workspace",
        "completed" if not failures else "partial_failure",
        detail,
    )
    return workspace


def _handle_deactivate_workspace(req: Dict[str, Any], db: DatabaseAdapter) -> Dict[str, Any]:
    """Stop every running service_proxy referenced by the workspace.

    Two exemptions:
      * singletons (e.g. the runtime service) are never stopped here.
      * members that are also claimed by another currently-active
        workspace are left running — that workspace still depends on them.
    """
    workspace_id = req.get("workspace_id")
    if not workspace_id:
        raise ValueError("deactivate_workspace requires workspace_id")
    workspace = db.get_item("workspace", workspace_id)
    if not workspace:
        raise ValueError(f"workspace '{workspace_id}' not found")
    if workspace.get("kind") == "runtime":
        raise ValueError("runtime workspace cannot be activated/deactivated")

    proxy_ids = workspace.get("service_proxy_ids") or []
    workspace["status"] = "deactivating"
    # Clear activated_at *before* the stop loop so _other_workspaces_claiming
    # called by future deactivations sees this workspace as no-longer-active.
    workspace["activated_at"] = None
    db.update_item("workspace", workspace_id, workspace, include_nulls=True)
    _publish_workspace(workspace, "deactivating")
    _publish_progress(req["id"], "deactivate_workspace", "running")

    failures: list[str] = []
    skipped_shared: list[str] = []
    skipped_singleton: list[str] = []
    for proxy_id in proxy_ids:
        proxy = db.get_item("service_proxy", proxy_id)
        if not proxy:
            continue  # gone — that's effectively stopped.
        if proxy.get("status") not in {"running", "starting"}:
            continue  # not running — nothing to stop.
        if _is_singleton_proxy(db, proxy):
            skipped_singleton.append(proxy_id)
            continue
        claimants = _other_workspaces_claiming(db, proxy_id, workspace_id)
        if claimants:
            skipped_shared.append(f"{proxy_id} (claimed by {', '.join(claimants)})")
            continue
        try:
            _handle_stop({"id": req["id"], "service_proxy_id": proxy_id}, db)
        except Exception as exc:  # noqa: BLE001
            failures.append(f"{proxy_id}: {exc}")

    workspace["status"] = "inactive" if not failures else "degraded"
    detail_parts: list[str] = []
    if failures:
        detail_parts.append("failed: " + "; ".join(failures))
    if skipped_singleton:
        detail_parts.append("singletons kept running: " + ", ".join(skipped_singleton))
    if skipped_shared:
        detail_parts.append("shared with other active workspaces: " + ", ".join(skipped_shared))
    detail = " | ".join(detail_parts) if detail_parts else None
    db.update_item("workspace", workspace_id, workspace, include_nulls=True)
    _publish_workspace(workspace, workspace["status"], detail)
    _publish_progress(
        req["id"],
        "deactivate_workspace",
        "completed" if not failures else "partial_failure",
        detail,
    )
    return workspace


def _handle_uninstall_type(req: Dict[str, Any], db: DatabaseAdapter) -> Dict[str, Any]:
    """Uninstall a service TYPE: remove its shared per-type venv (+ marker)
    so the type reads as not-installed, and reset its non-running instances
    back to 'placeholder' (they reinstall on next Start). The source
    (package.yml, src/) is preserved — this is INSTALLED → LOADED, not a
    catalog removal — so it's cleanly repeatable with install.
    """
    service_meta_id = req.get("service_meta_id")
    if not service_meta_id:
        raise ValueError("uninstall_type requires service_meta_id")
    meta = db.get_item("service_meta", service_meta_id)
    if not meta:
        raise ValueError(f"service_meta '{service_meta_id}' not found")

    # Builtins have no venv — nothing to uninstall.
    if not (meta.get("package_spec") and meta.get("dependency_manager")):
        _publish_progress(req["id"], "uninstall", "completed", "builtin — nothing to uninstall")
        return {"service_meta_id": service_meta_id, "installed": False, "instances_reset": 0, "status": "uninstalled"}

    # Serialize against install so the two can't race on the same venv.
    with _INSTALL_LOCK:
        instances = [
            p for p in (db.get_all_items("service_proxy") or [])
            if p.get("service_meta_id") == service_meta_id
        ]
        # Refuse while any instance is actively using the venv. Stopped /
        # placeholder / installed / error instances are fine — reset below.
        busy = [p for p in instances if p.get("status") in {"installing", "starting", "running", "stopping"}]
        if busy:
            names = ", ".join(str(p.get("id") or p.get("name")) for p in busy)
            raise ValueError(
                f"refusing to uninstall {service_meta_id} — stop these instance(s) first: {names}"
            )

        meta_id = meta.get("id") or service_meta_id
        try:
            type_name, type_version = meta_id.split("@", 1)
        except ValueError:
            raise ValueError(f"invalid service_meta_id {meta_id!r} (expected name@version)")
        venv_slot = f"{type_name}/{type_version}"

        _publish_progress(req["id"], "uninstall", "running", f"removing venv for {meta_id}")
        installer.uninstall_type(venv_slot, _resolve_repo_dir())

        # Flip the catalog flag and broadcast so the palette badge updates.
        # install_phase drops back to LOADED (source stays, venv gone);
        # keep the deprecated mirror fields in sync for one release.
        meta["installed"] = False
        meta["install_phase"] = "loaded"
        meta["install_error"] = None
        meta["load_error"] = None
        meta["installation_exception"] = None
        db.update_item("service_meta", service_meta_id, meta, include_nulls=True)
        _publish_service_meta(meta)

        # Revert surviving instances to placeholders so their canvas blocks
        # show a grey light + Play and reinstall on next Start.
        reset = 0
        for p in instances:
            if p.get("status") == "placeholder":
                continue
            p["status"] = "placeholder"
            p["pid"] = None
            p["error"] = None
            db.update_item("service_proxy", p.get("id"), p, include_nulls=True)
            _publish_lifecycle(p)
            reset += 1

    _publish_progress(req["id"], "uninstall", "completed", f"reset {reset} instance(s) to placeholder")
    return {"service_meta_id": service_meta_id, "installed": False, "instances_reset": reset, "status": "uninstalled"}


def _resolve_data_dir() -> Path:
    """Absolute data dir from config.data_dir (mirrors _resolve_repo_dir)."""
    settings = get_settings()
    p = Path(getattr(settings, "data_dir", None) or "data")
    if not p.is_absolute():
        p = Path.cwd() / p
    return p


def save_all_service_config() -> Dict[str, Any]:
    """Snapshot every managed service's config + run-state into the booted
    config set's ymls, so the next boot restores the exact current state
    (which services are running vs stopped, and each service's own runtime
    state — e.g. whether a clock's ticks are running).

    The runtime-owned "save all services" verb. Exposed to the UI/operator
    via POST /v1/system/save-config and called automatically just before a
    graceful drain. Returns the snapshot report.
    """
    db = get_database_client()
    if db is None:
        return {"ok": False, "error": "database client not initialised"}
    from robotlab_x.runtime import boot  # lazy: avoid import cycle
    return boot.save_all_service_config(db, _resolve_repo_dir(), _resolve_data_dir())


def save_one_service_config(proxy_id: str) -> Dict[str, Any]:
    """Snapshot ONE managed service's config to its yml in the booted set.

    Counterpart to ``save_all_service_config``. Exposed via the per-node
    save button in the Composer's full-view title bar so the operator
    can persist one service's tweaks (e.g. an IK model edit) without
    rewriting every other ``*.yml`` on disk.
    """
    db = get_database_client()
    if db is None:
        return {"ok": False, "error": "database client not initialised"}
    from robotlab_x.runtime import boot  # lazy: avoid import cycle
    return boot.save_one_service_config(
        db, _resolve_repo_dir(), _resolve_data_dir(), proxy_id,
    )


def reload_one_service_config(proxy_id: str) -> Dict[str, Any]:
    """Re-read ONE service's yml from disk and apply it to the LIVE
    service — the inverse of ``save_one_service_config``.

    Backs the per-node "load config from yml" button. Lets an operator
    hand-edit ``<active-set>/<proxy_id>.yml`` while the system runs and
    push the change into the running service with no restart.

    Uniform across both service flavours:
      * builtin (in-process) → publish ``{"action": "reload_config"}`` on
        the service's control topic; the live instance re-reads its own
        yml and runs ``apply_config(diff)``.
      * subprocess → the child can't read the config-set dir, so the
        runtime reads + decrypts + validates the yml here, writes it to
        the proxy row, and broadcasts the retained ``config_state`` the
        subprocess already adopts live via ``_apply_config_state``.

    Validation happens here either way (against the type's config_class)
    so a bad hand-edit returns a clear error instead of silently failing
    inside the service. Singletons are refused (they ride restarts).
    """
    db = get_database_client()
    if db is None:
        return {"ok": False, "error": "database client not initialised"}
    row = db.get_item("service_proxy", proxy_id)
    if not row:
        return {"ok": False, "error": f"unknown proxy_id: {proxy_id}", "proxy_id": proxy_id}
    type_id = row.get("service_meta_id")
    if not type_id:
        return {"ok": False, "error": f"proxy {proxy_id} has no service_meta_id", "proxy_id": proxy_id}
    meta = db.get_item("service_meta", type_id) or {}
    if "singleton" in (meta.get("tags") or []):
        return {"ok": False, "skipped": "singleton (rides restart — no reload)", "proxy_id": proxy_id}

    from robotlab_x.runtime import boot  # lazy: avoid import cycle
    from robotlab_x.runtime.config_sets import active_set_dir, active_set_name
    from robotlab_x.runtime.repo import repo_roots, scan_repos

    data_dir = _resolve_data_dir()
    repo_dir = _resolve_repo_dir()
    set_dir = active_set_dir(data_dir)
    path = set_dir / f"{proxy_id}.yml"
    if not path.is_file():
        return {"ok": False, "proxy_id": proxy_id,
                "error": "no yml on disk for this service yet — save it first, then edit + reload"}

    sec_core = boot.bootstrap_security_core(data_dir, repo_dir=repo_dir)
    decrypt_fn = sec_core.decrypt if sec_core else None
    parsed = boot._safe_load_proxy_yml(path, decrypt_fn)
    if parsed is None:
        return {"ok": False, "proxy_id": proxy_id,
                "error": "yml failed to parse/decrypt — check the file for syntax errors"}
    new_config = parsed.get("service_config") or {}

    # Validate against the type's config_class so a bad hand-edit is
    # caught HERE with a readable message, not silently dropped live.
    manifest = {m.id: m for m in scan_repos(repo_roots(get_settings()))}.get(type_id)
    if manifest is not None:
        probe = dict(row)
        probe["service_config"] = new_config
        try:
            boot._row_to_config_instance(probe, manifest, repo_dir)
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "proxy_id": proxy_id,
                    "error": f"invalid config: {type(exc).__name__}: {exc}"}

    # Persist the reloaded config to the row — the source of truth for a
    # (re)start and for the next save — then push it into the live service.
    row["service_config"] = new_config
    db.update_item("service_proxy", proxy_id, row, include_nulls=True)

    type_name = meta.get("name") or type_id.split("@")[0]
    if meta.get("language") == "builtin":
        get_bus().publish_sync(f"/{type_name}/{proxy_id}/control", {"action": "reload_config"})
        applied = "control:reload_config"
    else:
        get_bus().publish_sync(
            f"/service_proxy/{proxy_id}/config_state", new_config, retained=True,
        )
        applied = "config_state"

    logger.info("lifecycle.reload_one: set=%s proxy=%s applied_via=%s",
                active_set_name(), proxy_id, applied)
    return {
        "ok": True,
        "proxy_id": proxy_id,
        "set_name": active_set_name(),
        "applied_via": applied,
        "yml_path": str(path),
    }


def reload_all_service_config() -> Dict[str, Any]:
    """Re-read every managed service's yml from the active set and apply
    each to its LIVE service — the inverse of ``save_all_service_config``.

    Backs the top-bar "Load all" button. Iterates the proxy registry (so
    "all services", symmetric with "Save all"); singletons ride the
    process and are skipped, and a proxy with no yml on disk yet (never
    saved) is skipped rather than errored. Per-proxy work is delegated to
    ``reload_one_service_config`` so validation + the builtin/subprocess
    apply path stay identical to the single-service button.
    """
    db = get_database_client()
    if db is None:
        return {"ok": False, "error": "database client not initialised"}
    from robotlab_x.runtime.config_sets import active_set_dir, active_set_name

    set_dir = active_set_dir(_resolve_data_dir())
    reloaded: List[str] = []
    skipped: Dict[str, str] = {}
    errors: Dict[str, str] = {}
    for row in (db.get_all_items("service_proxy") or []):
        proxy_id = row.get("id")
        if not proxy_id:
            continue
        meta = db.get_item("service_meta", row.get("service_meta_id")) or {}
        if "singleton" in (meta.get("tags") or []):
            skipped[proxy_id] = "singleton (rides restart)"
            continue
        if not (set_dir / f"{proxy_id}.yml").is_file():
            skipped[proxy_id] = "no yml on disk (never saved)"
            continue
        rep = reload_one_service_config(proxy_id)
        if rep.get("ok"):
            reloaded.append(proxy_id)
        elif rep.get("skipped"):
            skipped[proxy_id] = str(rep["skipped"])
        else:
            errors[proxy_id] = str(rep.get("error", "unknown"))

    logger.info("lifecycle.reload_all: set=%s reloaded=%d skipped=%d errors=%d",
                active_set_name(), len(reloaded), len(skipped), len(errors))
    return {
        "ok": True,
        "set_name": active_set_name(),
        "reloaded": reloaded,
        "skipped": skipped,
        "errors": errors,
    }


def drain_services() -> int:
    """Stop every non-singleton managed service for a graceful restart.

    Terminates subprocess services (so they don't orphan when the runtime
    re-execs) and marks every affected row 'stopped' (so state isn't left
    stale-'running'). Singletons (the runtime/security core) are left alone
    — they ride the restart with the process and re-materialize on boot. The
    active config set's start_order services are respawned fresh on boot.
    Returns the number stopped.
    """
    db = get_database_client()
    if db is None:
        return 0
    stopped = 0
    for proxy in (db.get_all_items("service_proxy") or []):
        if proxy.get("status") not in {"running", "starting", "installing", "stopping"}:
            continue
        proxy_id = proxy.get("id")
        meta = db.get_item("service_meta", proxy.get("service_meta_id")) or {}
        if "singleton" in (meta.get("tags") or []):
            continue
        try:
            _handle_stop({"id": f"drain-{proxy_id}", "service_proxy_id": proxy_id}, db)
        except Exception:  # noqa: BLE001
            logger.exception("drain: stop failed for %s — force-marking stopped", proxy_id)
            proxy["status"] = "stopped"
            proxy["pid"] = None
            db.update_item("service_proxy", proxy_id, proxy, include_nulls=True)
            _publish_lifecycle(proxy)
        stopped += 1
    logger.info("drain: stopped %d non-singleton service(s)", stopped)
    return stopped


_DISPATCH = {
    "create_service": _handle_install,
    "start_service": _handle_start,
    "stop_service": _handle_stop,
    "restart_service": _handle_restart,
    "release_service": _handle_uninstall,
    "uninstall_type": _handle_uninstall_type,
    "activate_workspace": _handle_activate_workspace,
    "deactivate_workspace": _handle_deactivate_workspace,
}


# ─── public entry point ─────────────────────────────────────────────────


def handle(req_record: Dict[str, Any]) -> Dict[str, Any]:
    """Dispatch ``req_record`` to the right handler.

    ``req_record`` is the dict freshly inserted into the service_request
    table — it always has ``id``, ``action``, plus action-specific fields.
    Returns the request row (in its terminal state) so the API caller
    can echo it back to the UI.
    """
    db = get_database_client()
    if db is None:
        raise RuntimeError("lifecycle.handle: database client not initialised")

    # Normalize legacy verbs (install/uninstall/start/...) to the
    # canonical create_service/release_service/start_service/... form.
    # Stamp the canonical name back on req_record so downstream
    # consumers + saved request history are consistent.
    action = _canonical_action(req_record.get("action"))
    req_record["action"] = action

    req_record["status"] = "running"
    db.update_item("service_request", req_record["id"], req_record, include_nulls=True)

    started = time.time()
    try:
        if action not in _ACTIONS:
            raise ValueError(f"unsupported action: {action!r}")
        proxy_state = _DISPATCH[action](req_record, db)
    except Exception as exc:  # noqa: BLE001 — boundary catch
        logger.exception("lifecycle.failed action=%s request=%s", action, req_record.get("id"))
        req_record["status"] = "failed"
        req_record["result"] = str(exc)
        req_record["completed_at"] = _now_iso()
        db.update_item("service_request", req_record["id"], req_record, include_nulls=True)
        _publish_progress(req_record["id"], action, "failed", str(exc))
        return req_record

    elapsed_ms = int((time.time() - started) * 1000)
    req_record["status"] = "completed"
    req_record["result"] = f"{action} ok ({elapsed_ms}ms) — proxy status={proxy_state.get('status')}"
    req_record["completed_at"] = _now_iso()
    db.update_item("service_request", req_record["id"], req_record, include_nulls=True)
    return req_record
