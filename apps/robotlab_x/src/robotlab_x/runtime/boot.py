# unmanaged
"""Boot-from-config-set — stone 4 of the TODO_CONFIG_SETS spec.

Glue between the file-based loader (``runtime/config_sets.py``) and the
existing lifecycle that walks ``service_proxy`` rows. Three responsibilities:

  1. **One-shot migrator.** On first boot under the new system — empty
     active set on disk but populated ``service_proxy`` rows — write
     ``<proxy_id>.yml`` for each row, run security through the encrypt
     walk so secrets land as ``Encrypted--`` rather than plaintext.

  2. **Sync.** On every boot, read every yml in the active set, decrypt
     via the security core, validate against ``config_class``, and
     update the matching ``service_proxy`` row. The DB row becomes a
     mirror; the file is authoritative.

  3. **Bootstrap security.** Before any decryption can happen the
     SecurityCore needs to be live. The security *Service* is spawned
     by the normal lifecycle later — but during the sync step we
     instantiate a SecurityCore inline using the same key file, so the
     decrypt callable exists. Same key file → independent SecurityCore
     instances produce identical results.

Stone 4 deliberately does NOT remove the dual-write in
``Service.save_config`` (stone 3 added ``_save_config_to_db_legacy``).
That dual-write is what keeps the DB row in sync with the file between
boots, so the legacy ``reconcile_running_proxies`` path can spawn
services without needing further refactor. Stone 4b (future) strips
the DB write entirely once the loader becomes the only source of
config at boot.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import yaml
from pydantic import SecretStr

from robotlab_x.runtime.config_sets import (
    ConfigSetError,
    active_set_dir,
    active_set_name,
    decrypt_tree,
    discover_candidates,
    encrypt_tree,
    load_runtime_yml,
    save_proxy_yml,
)
from robotlab_x.runtime.repo import PackageManifest, repo_roots, root_of, scan_repo, scan_repos


def _all_roots(repo_dir: Path) -> List[Path]:
    """The passed writable ``repo_dir`` plus any read-only
    ``config.repo_paths`` roots, deduped, writable first. Falls back to
    just ``[repo_dir]`` if settings are unavailable (keeps unit tests
    that pass a bare temp repo_dir behaving exactly as single-root)."""
    try:
        from config import get_settings
        roots = repo_roots(get_settings())
    except Exception:  # noqa: BLE001
        return [repo_dir]
    # Ensure the explicitly-passed root is honoured + first.
    out: List[Path] = [repo_dir]
    for r in roots:
        if r != repo_dir and r not in out:
            out.append(r)
    return out


logger = logging.getLogger(__name__)


# Filename prefix for the "this set has been migrated" marker. Kept as
# a hidden file so it doesn't show up in `ls` output the operator
# scrolls past.
MIGRATION_MARKER = ".migrated"


# ─── security bootstrap ───────────────────────────────────────────────


def bootstrap_security_core(data_dir: Path, repo_dir: Optional[Path] = None):
    """Instantiate a SecurityCore directly (NOT via the Service wrapper).

    Returns the core or None if the security module can't be imported
    (e.g. tests that don't ship the repo). The same key file is shared
    with the eventually-spawned SecurityService — independent cores
    over the same key file produce identical results.

    ``repo_dir`` defaults to ``<data_dir>/../repo`` to match the standard
    layout; tests can pass an explicit path.
    """
    import sys
    if repo_dir is None:
        repo_dir = data_dir.parent / "repo"
    candidate = repo_dir / "security" / "1.0.0"
    if candidate.is_dir() and str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))
    try:
        import importlib
        sec_mod = importlib.import_module("security")
    except ImportError as exc:
        logger.warning(
            "boot: SecurityCore unavailable (%s) — encrypted configs "
            "will fail to load. Install the security package.", exc,
        )
        return None
    key_path = (data_dir / "security" / "key.bin").resolve()
    return sec_mod.SecurityCore(key_path=key_path)


# ─── migrator ─────────────────────────────────────────────────────────


def _set_is_empty(set_dir: Path) -> bool:
    """An empty set is one with no proxy yml files (runtime.yml + dot
    files don't count). Migration triggers only on truly empty sets so
    a user who's deleted their files doesn't get them silently restored."""
    if not set_dir.is_dir():
        return True
    for p in set_dir.iterdir():
        if not p.is_file():
            continue
        if p.name.startswith("."):
            continue
        if p.suffix != ".yml":
            continue
        if p.name == "runtime.yml":
            continue
        return False
    return True


def _row_to_config_instance(row: Dict[str, Any], manifest: PackageManifest, repo_dir: Path):
    """Reconstruct a Pydantic config_class instance from a service_proxy
    row's ``service_config`` dict. Used by the migrator to round-trip
    through ``save_proxy_yml`` so the encrypted-secrets path runs."""
    from robotlab_x.framework.adapters.in_process import _load_service_class
    module_name = manifest.entry.module or manifest.name
    class_name = manifest.entry.class_name or (
        "".join(p.capitalize() for p in manifest.name.split("_")) + "Service"
    )
    # Load the class from the manifest's OWN root, not the passed
    # writable repo_dir — a type may live in a read-only repo_paths root.
    cls = _load_service_class(
        root_of(manifest), manifest.name, manifest.version, module_name, class_name,
    )
    config_class = getattr(cls, "config_class", None)
    if config_class is None:
        raise RuntimeError(f"{manifest.name} has no config_class")
    # service_config is a plain dict — go straight through Pydantic.
    return config_class(**(row.get("service_config") or {}))


def _write_raw_yml(
    set_dir: Path,
    proxy_id: str,
    type_id: str,
    raw_config: Dict[str, Any],
    encrypt_fn: Optional[Callable[[str], str]] = None,
    desired_state: Optional[str] = None,
) -> None:
    """Fallback write path used when the config_class can't be loaded
    (subprocess services, the runtime singleton, types removed from
    the registry). Walks the raw dict through the encrypt tree before
    writing — secret hygiene is preserved even without Pydantic
    validation.

    ``desired_state`` (when given) is written as a top-level field right
    after ``type:`` — same contract as ``save_proxy_yml``."""
    payload_body = encrypt_tree(raw_config, encrypt_fn)
    payload = {"type": type_id}
    if desired_state is not None:
        payload["desired_state"] = desired_state
    payload.update(payload_body)
    set_dir.mkdir(parents=True, exist_ok=True)
    path = set_dir / f"{proxy_id}.yml"
    tmp = path.with_suffix(".yml.tmp")
    tmp.write_text(yaml.safe_dump(payload, sort_keys=False, default_flow_style=False))
    tmp.rename(path)


def migrate_db_to_config_set(
    db,
    set_dir: Path,
    manifests: Dict[str, PackageManifest],
    repo_dir: Path,
    encrypt_fn: Optional[Callable[[str], str]] = None,
) -> List[str]:
    """Walk every ``service_proxy`` row that has a ``service_config``
    blob; write a yml file for it in ``set_dir``.

    Idempotent — skips rows whose yml file already exists. Returns the
    list of proxy_ids whose files were written (or empty if nothing
    needed migrating).

    Run conditions: set is empty (no proxy ymls present). Caller
    decides whether to invoke; this function does NOT gate on emptiness
    so tests can exercise it on populated sets too.
    """
    rows = db.get_all_items("service_proxy") or []
    written: List[str] = []
    set_dir.mkdir(parents=True, exist_ok=True)
    for row in rows:
        proxy_id = row.get("id")
        type_id = row.get("service_meta_id")
        if not proxy_id or not type_id:
            continue
        target = set_dir / f"{proxy_id}.yml"
        if target.is_file():
            continue  # operator may have hand-authored; never clobber
        manifest = manifests.get(type_id)
        if manifest is None:
            # Type isn't in the registry — likely a removed package.
            # Skip the row; the operator will see a candidate without
            # type resolution in the UI.
            logger.warning(
                "boot.migrate: skipping %s — service_meta_id=%s not in registry",
                proxy_id, type_id,
            )
            continue
        try:
            config_instance = _row_to_config_instance(row, manifest, repo_dir)
            try:
                save_proxy_yml(
                    set_dir, proxy_id, type_id, config_instance,
                    encrypt_fn=encrypt_fn,
                )
            except Exception:  # noqa: BLE001
                logger.exception("boot.migrate: failed to write %s.yml", proxy_id)
                continue
        except Exception as exc:  # noqa: BLE001
            # Subprocess services + the runtime singleton don't have
            # an in-process Service class to load. Fall back to writing
            # the raw service_config dict — the encryption walk still
            # applies, but Pydantic validation is skipped (the operator
            # gets validation on next load).
            logger.info(
                "boot.migrate: %s has no loadable config_class (%s); "
                "writing raw dict",
                proxy_id, exc,
            )
            try:
                _write_raw_yml(
                    set_dir, proxy_id, type_id,
                    row.get("service_config") or {},
                    encrypt_fn=encrypt_fn,
                )
            except Exception:  # noqa: BLE001
                logger.exception(
                    "boot.migrate: fallback write also failed for %s.yml",
                    proxy_id,
                )
                continue
        written.append(proxy_id)

    # Drop the marker so we can spot in logs that the migrator ran.
    if written:
        (set_dir / MIGRATION_MARKER).write_text(
            f"migrated {len(written)} rows at "
            f"{datetime.now(timezone.utc).isoformat()}\n"
            + "\n".join(written)
        )
    return written


# ─── sync (yml → row) ─────────────────────────────────────────────────


def _safe_load_proxy_yml(path: Path, decrypt_fn) -> Optional[Dict[str, Any]]:
    """Read + decrypt a proxy yml, return raw dict ready to write into
    ``service_config``. Returns None on any parse/decrypt failure
    (logged); caller skips that row."""
    try:
        raw = yaml.safe_load(path.read_text())
    except yaml.YAMLError as exc:
        logger.warning("boot.sync: %s failed to parse: %s", path, exc)
        return None
    if not isinstance(raw, dict):
        logger.warning("boot.sync: %s isn't a yaml mapping", path)
        return None
    type_id = raw.pop("type", None)
    if not isinstance(type_id, str):
        logger.warning("boot.sync: %s missing 'type:' field", path)
        return None
    # desired_state is runtime metadata, not service config — pull it out
    # before the rest of the mapping becomes service_config.
    desired_state = raw.pop("desired_state", None)
    if not isinstance(desired_state, str):
        desired_state = None
    try:
        decrypted = decrypt_tree(raw, decrypt_fn)
    except ConfigSetError as exc:
        logger.warning("boot.sync: %s decrypt failed: %s", path, exc)
        return None
    return {
        "type_id": type_id,
        "service_config": decrypted,
        "desired_state": desired_state,
    }


def sync_config_set_to_db(
    db,
    set_dir: Path,
    manifests: Dict[str, PackageManifest],
    decrypt_fn: Optional[Callable[[str], str]] = None,
) -> Dict[str, str]:
    """For every proxy yml in ``set_dir``, ensure a matching row exists
    in ``service_proxy`` with the yml's contents.

    File is authoritative — for BOTH config and desired run-state:

      * ``service_config`` + ``service_meta_id`` are overwritten from the yml.
      * The yml's ``desired_state`` decides the boot status:
          - ``running`` → row status ``running`` so reconcile spawns it.
          - ``stopped`` → row status ``stopped`` so it's instantiated/visible
            on the canvas but left idle.
        This OVERRIDES whatever stale status the persisted row carried (the
        previous process may have died leaving a row stale-``running``); the
        file, written at the last clean shutdown, is the truth.
      * When the yml has NO ``desired_state`` (hand-authored or pre-dating
        this feature) we fall back to the legacy rule: bump to ``running``
        iff the proxy is in start_order. New rows otherwise start
        ``installed``.

    Returns a small map proxy_id → action ('created' | 'updated' |
    'skipped:<reason>') for logging/auditing.
    """
    actions: Dict[str, str] = {}
    if not set_dir.is_dir():
        return actions
    runtime_yml = load_runtime_yml(set_dir)
    in_start_order = set(runtime_yml.start_order)
    for path in sorted(set_dir.iterdir()):
        if not path.is_file() or path.suffix != ".yml":
            continue
        if path.name in ("runtime.yml",) or path.name.startswith("."):
            continue
        proxy_id = path.stem
        parsed = _safe_load_proxy_yml(path, decrypt_fn)
        if parsed is None:
            actions[proxy_id] = "skipped:parse_or_decrypt_failed"
            continue
        type_id = parsed["type_id"]
        # Resolve bare names (clock → clock@1.0.0) the same way the
        # loader does, so the migrator-produced yml and hand-authored
        # yml behave identically.
        if type_id not in manifests:
            matches = [m for m in manifests.values() if m.name == type_id]
            if len(matches) == 1:
                type_id = matches[0].id
            elif len(matches) > 1:
                actions[proxy_id] = f"skipped:ambiguous_type:{type_id}"
                continue
            else:
                actions[proxy_id] = f"skipped:unknown_type:{type_id}"
                continue

        desired_state = parsed.get("desired_state")

        existing = db.get_item("service_proxy", proxy_id)
        if existing is None:
            new_row = {
                "id": proxy_id,
                "name": proxy_id,
                "service_meta_id": type_id,
                "service_config": parsed["service_config"],
                "status": "installed",
                "configured": False,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "installed_at": datetime.now(timezone.utc).isoformat(),
                "pid": None,
                "host": None,
                "port": None,
                "started_at": None,
                "stopped_at": None,
                "error": None,
            }
            if desired_state == "running":
                # reconcile_running_proxies looks for status=running/starting.
                new_row["status"] = "running"
            elif desired_state == "stopped":
                # Instantiate/visible but idle — reconcile leaves it alone.
                new_row["status"] = "stopped"
            elif proxy_id in in_start_order:
                # Legacy fallback: no desired_state recorded, but the yml is
                # in start_order — boot path expects to spawn it.
                new_row["status"] = "running"
            db.insert_item("service_proxy", proxy_id, new_row)
            actions[proxy_id] = "created"
            continue

        # Update existing row — overwrite the config. If the operator
        # changed the type via file rename (swap-by-rename), the new
        # type_id wins.
        existing["service_meta_id"] = type_id
        existing["service_config"] = parsed["service_config"]
        # desired_state is AUTHORITATIVE over the persisted status: the row
        # may be stale-'running' from a process that died uncleanly. Reset
        # pid/error so reconcile starts from a clean slate.
        if desired_state == "running":
            existing["status"] = "running"
            existing["error"] = None
            existing["pid"] = None
        elif desired_state == "stopped":
            existing["status"] = "stopped"
            existing["error"] = None
            existing["pid"] = None
        elif proxy_id in in_start_order and existing.get("status") in (
            None, "installed", "stopped", "error",
        ):
            # Legacy fallback (yml predates desired_state).
            existing["status"] = "running"
            existing["error"] = None
        db.update_item("service_proxy", proxy_id, existing, include_nulls=True)
        actions[proxy_id] = "updated"
    return actions


# ─── orchestrator ─────────────────────────────────────────────────────


def boot_from_config_set(
    db,
    repo_dir: Path,
    data_dir: Path,
) -> Dict[str, Any]:
    """Migrate (if needed) + sync. Returns a report dict for logging.

    Caller (event_handlers.on_startup) calls this BEFORE
    reconcile_running_proxies. After this, the rows in ``service_proxy``
    reflect the contents of the active config set on disk; reconcile
    spawns whatever is in start_order.
    """
    manifests = {m.id: m for m in scan_repos(_all_roots(repo_dir))}
    set_dir = active_set_dir(data_dir)
    set_dir.mkdir(parents=True, exist_ok=True)

    sec_core = bootstrap_security_core(data_dir, repo_dir=repo_dir)
    encrypt_fn = sec_core.encrypt if sec_core else None
    decrypt_fn = sec_core.decrypt if sec_core else None

    migrated: List[str] = []
    if _set_is_empty(set_dir):
        migrated = migrate_db_to_config_set(
            db, set_dir, manifests, repo_dir, encrypt_fn=encrypt_fn,
        )
        if migrated:
            logger.info(
                "boot.migrate: wrote %d yml file(s) to %s (set name=%s)",
                len(migrated), set_dir, active_set_name(),
            )

    actions = sync_config_set_to_db(db, set_dir, manifests, decrypt_fn=decrypt_fn)
    if actions:
        created = [k for k, v in actions.items() if v == "created"]
        updated = [k for k, v in actions.items() if v == "updated"]
        skipped = {k: v for k, v in actions.items() if v.startswith("skipped:")}
        logger.info(
            "boot.sync: set=%s created=%d updated=%d skipped=%d",
            active_set_name(), len(created), len(updated), len(skipped),
        )
        if skipped:
            for k, reason in skipped.items():
                logger.warning("boot.sync: %s %s", k, reason)

    return {
        "set_name": active_set_name(),
        "set_dir": str(set_dir),
        "migrated": migrated,
        "sync_actions": actions,
        "security_available": sec_core is not None,
    }


# ─── snapshot (DB + live state → yml) ─────────────────────────────────


def _save_one_proxy(
    row: Dict[str, Any],
    manifests: Dict[str, Any],
    set_dir: Path,
    encrypt_fn: Optional[Callable[[str], str]],
    repo_dir: Path,
) -> Optional[str]:
    """Snapshot ONE proxy row to ``<set_dir>/<proxy_id>.yml``.

    Returns the ``desired_state`` written (``'running'`` / ``'stopped'``)
    so the caller can aggregate, or ``None`` if the row was a singleton
    and skipped. Raises on persistence failure — callers decide whether
    to log + continue (save_all) or surface as 404/500 (save_one).
    """
    proxy_id = row.get("id")
    type_id = row.get("service_meta_id")
    if not proxy_id or not type_id:
        return None
    from robotlab_x import framework  # lazy: avoid import cycle at module load

    status = row.get("status")
    desired = "running" if status in ("running", "starting", "installing") else "stopped"

    # Prefer the live Service object's config so freshly-flushed
    # runtime state (clock is_clock_running, etc.) is captured. Fall
    # back to the row's stored config when the service isn't running
    # in-process.
    handle = framework.REGISTRY.get(proxy_id)
    svc = handle.payload.get("service") if handle is not None else None
    manifest = manifests.get(type_id)

    if svc is not None:
        try:
            svc.serialize_runtime_state()
        except Exception:  # noqa: BLE001 — never block the snapshot
            logger.exception(
                "boot.save: serialize_runtime_state failed for %s", proxy_id,
            )
        save_proxy_yml(
            set_dir, proxy_id, type_id, svc.config,
            encrypt_fn=encrypt_fn, desired_state=desired,
        )
    elif manifest is not None:
        try:
            config_instance = _row_to_config_instance(row, manifest, repo_dir)
            save_proxy_yml(
                set_dir, proxy_id, type_id, config_instance,
                encrypt_fn=encrypt_fn, desired_state=desired,
            )
        except Exception:  # noqa: BLE001 — class unloadable: raw write
            _write_raw_yml(
                set_dir, proxy_id, type_id,
                row.get("service_config") or {},
                encrypt_fn=encrypt_fn, desired_state=desired,
            )
    else:
        # Type not in registry (subprocess / removed package).
        _write_raw_yml(
            set_dir, proxy_id, type_id,
            row.get("service_config") or {},
            encrypt_fn=encrypt_fn, desired_state=desired,
        )
    return desired


def save_one_service_config(
    db,
    repo_dir: Path,
    data_dir: Path,
    proxy_id: str,
) -> Dict[str, Any]:
    """Snapshot a SINGLE service proxy's config to the booted set's yml.

    Counterpart to ``save_all_service_config``. Used by the per-node
    "save" affordance in the Composer title bar so the operator can
    commit one service's tweaks (e.g. an IK model edit) without
    rewriting every other ``*.yml`` on disk.
    """
    row = db.get_item("service_proxy", proxy_id)
    if not row:
        return {"ok": False, "error": f"unknown proxy_id: {proxy_id}"}
    type_id = row.get("service_meta_id")
    if not type_id:
        return {"ok": False, "error": f"proxy {proxy_id} has no service_meta_id"}
    meta = db.get_item("service_meta", type_id) or {}
    if "singleton" in (meta.get("tags") or []):
        return {
            "ok": False,
            "skipped": "singleton (rides restart — no per-proxy save)",
            "proxy_id": proxy_id,
        }

    manifests = {m.id: m for m in scan_repos(_all_roots(repo_dir))}
    set_dir = active_set_dir(data_dir)
    set_dir.mkdir(parents=True, exist_ok=True)
    sec_core = bootstrap_security_core(data_dir, repo_dir=repo_dir)
    encrypt_fn = sec_core.encrypt if sec_core else None

    try:
        desired = _save_one_proxy(row, manifests, set_dir, encrypt_fn, repo_dir)
    except Exception as exc:  # noqa: BLE001
        logger.exception("boot.save_one: failed to snapshot %s", proxy_id)
        return {"ok": False, "proxy_id": proxy_id, "error": f"{type(exc).__name__}: {exc}"}

    logger.info(
        "boot.save_one: set=%s proxy=%s desired=%s",
        active_set_name(), proxy_id, desired,
    )
    return {
        "ok": True,
        "set_name": active_set_name(),
        "set_dir": str(set_dir),
        "proxy_id": proxy_id,
        "yml_path": str(set_dir / f"{proxy_id}.yml"),
        "desired_state": desired,
    }


def save_all_service_config(
    db,
    repo_dir: Path,
    data_dir: Path,
) -> Dict[str, Any]:
    """Snapshot every managed service into the BOOTED set's ymls so the
    exact current state is restored on the next boot.

    For each ``service_proxy`` row this records:

      * ``desired_state`` — ``running`` if the row is live
        (running/starting/installing), else ``stopped``. boot.sync reads
        this back to decide start-vs-create-only.
      * The service's config, including any runtime state the service
        flushes via ``serialize_runtime_state`` (e.g. the clock writes
        ``is_clock_running`` so a ticking clock comes back ticking). For a
        LIVE in-process service we snapshot its live ``self.config``; for a
        non-running one we reconstruct from the row's stored config.

    Singletons (runtime, security) are skipped — they ride the restart with
    the process and re-materialize on boot, exactly like drain leaves them
    alone. Writing to the pinned booted set means a staged config switch
    can't retarget these writes at another set.

    Safe to call on demand (a UI/operator "save all" button) or just before
    a graceful drain. Returns a report dict for logging.
    """
    manifests = {m.id: m for m in scan_repos(_all_roots(repo_dir))}
    set_dir = active_set_dir(data_dir)
    set_dir.mkdir(parents=True, exist_ok=True)

    sec_core = bootstrap_security_core(data_dir, repo_dir=repo_dir)
    encrypt_fn = sec_core.encrypt if sec_core else None

    saved: List[str] = []
    skipped: Dict[str, str] = {}
    live_states: Dict[str, str] = {}

    for row in (db.get_all_items("service_proxy") or []):
        proxy_id = row.get("id")
        type_id = row.get("service_meta_id")
        if not proxy_id or not type_id:
            continue
        meta = db.get_item("service_meta", type_id) or {}
        if "singleton" in (meta.get("tags") or []):
            skipped[proxy_id] = "singleton (rides restart)"
            continue
        try:
            desired = _save_one_proxy(row, manifests, set_dir, encrypt_fn, repo_dir)
            if desired is not None:
                live_states[proxy_id] = desired
                saved.append(proxy_id)
        except Exception as exc:  # noqa: BLE001
            logger.exception("boot.save: failed to snapshot %s", proxy_id)
            skipped[proxy_id] = f"{type(exc).__name__}: {exc}"

    logger.info(
        "boot.save: set=%s saved=%d skipped=%d (running=%d stopped=%d)",
        active_set_name(), len(saved), len(skipped),
        sum(1 for v in live_states.values() if v == "running"),
        sum(1 for v in live_states.values() if v == "stopped"),
    )
    return {
        "ok": True,
        "set_name": active_set_name(),
        "set_dir": str(set_dir),
        "saved": saved,
        "skipped": skipped,
        "desired_states": live_states,
    }
