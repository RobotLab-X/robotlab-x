# unmanaged
"""Catalog (types) + registry (instances) reconciliation.

Two distinct tables the runtime cares about:

  • ``service_meta`` — the *catalog* of service types available on this
    backend. Reconciled from ``<repo>/<name>/<version>/package.yml`` on
    every boot. Dropping a folder into ``repo/`` and rebooting is enough
    to register a new type; removing the folder removes the catalog row.

  • ``service_proxy`` — the *registry* of service instances the runtime
    is managing. One row per running (or stopped) instance. Lifecycle
    transitions (``runtime/lifecycle.py``) own the writes; this module
    just bootstraps the singleton instances that should always exist.

On every startup, ``reconcile_catalog``:

  1. Scans the repo and upserts every manifest into ``service_meta``.
  2. Deletes catalog rows whose backing package is gone.
  3. For each ``singleton: true`` manifest, materializes its registry
     row if missing (the runtime singleton is the canonical case — the
     backend process itself is that registry entry).

The UI exposes both lists side-by-side: the palette's REPO tab reads
``service_meta``, the REGISTRY tab reads ``service_proxy``.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import List

from database.interface import DatabaseAdapter

from datetime import datetime, timezone
import os

from robotlab_x.runtime.repo import (
    PackageManifest,
    manifest_to_service_meta,
    root_of,
    scan_repo,
    scan_repos,
)


logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_singleton_proxy(db: DatabaseAdapter, m: PackageManifest) -> None:
    """Singleton-per-process types auto-materialize their one instance.

    The ``runtime`` service is the canonical example: the backend
    process IS this service, so there's always exactly one running
    instance regardless of what the DB says. If no service_proxy row
    exists for this singleton, create one. If one exists, refresh the
    pid/host so it always reflects the current process.
    """
    if not m.singleton:
        return

    # Find any existing proxy of this type. The convention is one proxy
    # per singleton named after the type itself (e.g. "runtime") — but
    # we tolerate whatever name the user picked.
    all_proxies = db.get_all_items("service_proxy") or []
    existing = next(
        (p for p in all_proxies if p.get("service_meta_id") == m.id),
        None,
    )
    now = _now_iso()
    if existing is None:
        proxy_id = m.name  # default singleton name matches type name
        row = {
            "id": proxy_id,
            "name": proxy_id,
            "service_meta_id": m.id,
            "status": "running",     # the backend IS this service
            "configured": True,
            "created_at": now,
            "started_at": now,
            "pid": os.getpid(),
            "host": "in-process",
            "service_config": {},
        }
        db.insert_item("service_proxy", proxy_id, row)
        logger.info("catalog.singleton: created %s (proxy_id=%s)", m.id, proxy_id)
    else:
        # Refresh pid + host so the inspector shows the live process.
        existing["status"] = "running"
        existing["pid"] = os.getpid()
        existing["host"] = "in-process"
        db.update_item("service_proxy", existing["id"], existing, include_nulls=True)


def reconcile_catalog(db: DatabaseAdapter, repo_dirs) -> dict:
    """Refresh service_meta to match what's on disk under one or more
    repo roots.

    ``repo_dirs`` may be a single ``Path`` (legacy single-root callers)
    or an ordered list of roots (multi-root: writable first, then
    read-only ``config.repo_paths``). When several roots hold the same
    ``name@version`` the first wins (see ``repo.scan_repos``). Each row
    records its ``repo_root`` so install/uninstall act on the right dir.

    Returns a small summary dict (counts) for logging.
    """
    roots: List[Path] = [repo_dirs] if isinstance(repo_dirs, (str, Path)) else list(repo_dirs)
    roots = [Path(r) for r in roots]
    # A scan failure (or a transiently-wrong root) must NOT be allowed to
    # prune the live catalog — that's how an uninstall/install hiccup
    # could wipe every service. On any scan exception, keep the catalog
    # untouched.
    try:
        manifests: List[PackageManifest] = scan_repos(roots)
    except Exception:  # noqa: BLE001 — defensive: never wedge on scan
        logger.exception("catalog.reconcile: scan_repos failed — keeping existing catalog intact")
        return {"inserted": 0, "upserted": 0, "removed": 0, "found": 0, "error": "scan_failed"}
    found_ids = {m.id for m in manifests}

    existing_rows = db.get_all_items("service_meta") or []
    existing_ids = {row.get("id") for row in existing_rows if row.get("id")}

    # Empty-scan guard: if the scan found nothing but the catalog already
    # has rows, treat it as a transient/misconfigured scan (e.g. wrong
    # cwd, a root being rewritten) rather than "every service was deleted
    # from disk". Skip the whole reconcile so the catalog can't be wiped;
    # a later good scan reconciles normally.
    if not manifests and existing_ids:
        logger.warning(
            "catalog.reconcile: 0 manifests but %d existing rows (roots=%s) — "
            "skipping to avoid wiping the catalog (empty-scan guard)",
            len(existing_ids), [str(r) for r in roots],
        )
        return {"inserted": 0, "upserted": 0, "removed": 0, "found": 0, "skipped": "empty_scan_guard"}

    inserted = 0
    upserted = 0
    for m in manifests:
        record = manifest_to_service_meta(m)
        # Tag which local root this type's source resolved from so the
        # registry's install/uninstall know where it lives.
        record["repo_root"] = str(root_of(m))
        if m.id in existing_ids:
            db.update_item("service_meta", m.id, record, include_nulls=True)
            upserted += 1
        else:
            db.insert_item("service_meta", m.id, record)
            inserted += 1
        # Auto-materialize singleton instances. The runtime is the
        # canonical case — the backend process IS the running service,
        # so the proxy row should always exist and reflect this process.
        _ensure_singleton_proxy(db, m)

    removed = 0
    for stale_id in existing_ids - found_ids:
        db.delete_item("service_meta", stale_id)
        removed += 1

    summary = {"inserted": inserted, "upserted": upserted, "removed": removed, "found": len(manifests)}
    logger.info("catalog.reconciled %s roots=%s", summary, [str(r) for r in roots])
    return summary


# Backwards-compatible name for callers that haven't switched yet.
seed_catalog = reconcile_catalog
