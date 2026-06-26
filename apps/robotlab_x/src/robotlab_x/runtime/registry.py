# unmanaged
"""Remote service registry — Phase 2 + 3 + 4 of docs/TODO_REPO.md.

Bridges a remote catalog (catalog.yml at a URL) to the local
``repo/<type>/<version>/`` layout that the rest of the runtime already
knows how to consume. Three transitions:

    ABSENT      ──load──▶   LOADED       ──install──▶   INSTALLED
   (no dir)                (dir exists,                 (venv ready
                            in service_meta              for pip svcs;
                            but not installed)           noop for builtins)

The transitions are explicit functions in this module:
    fetch_catalog(url)       → parse + return the catalog
    load(name, ver, …)       → ABSENT → LOADED (download, sha256, extract)
    install(name, ver, …)    → LOADED → INSTALLED (venv build / no-op)
    uninstall(name, ver, …)  → INSTALLED → LOADED (drop .venv, flip flag)

After every transition we call ``catalog.reconcile_catalog()`` so the
existing service_meta table + types index stay consistent — the
runtime + UI never have to know whether a directory was put there by
``git clone`` or by us. That's the whole point of the design.
"""
from __future__ import annotations

import hashlib
import io
import logging
import shutil
import tarfile
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Optional

import yaml

from database.interface import DatabaseAdapter

from robotlab_x.runtime.catalog import reconcile_catalog
from robotlab_x.runtime.repo import scan_repo


logger = logging.getLogger(__name__)


class RegistryError(Exception):
    """Base error for registry operations. Subclasses give more
    actionable feedback to the UI."""


class CatalogError(RegistryError):
    """Catalog couldn't be fetched or parsed."""


class NotInCatalogError(RegistryError):
    """The requested (name, version) isn't in the catalog."""


class IntegrityError(RegistryError):
    """sha256 of the downloaded archive didn't match the catalog."""


class LoadError(RegistryError):
    """ABSENT → LOADED transition failed."""


class InstallError(RegistryError):
    """LOADED → INSTALLED transition failed."""


# ─── catalog fetch ───────────────────────────────────────────────────

def fetch_catalog(url: str) -> Dict[str, Any]:
    """Fetch + parse a catalog.yml. Supports ``file://`` and
    ``http(s)://``. Returns the parsed dict; raises ``CatalogError``
    if anything's broken.

    No caching here — callers decide. For Phase 2 simplicity the
    catalog is small and we refetch on demand; a cache layer goes in
    later if it becomes load-bearing.
    """
    if not url:
        raise CatalogError("registry URL is empty")
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            body = resp.read()
    except Exception as exc:  # noqa: BLE001
        raise CatalogError(f"could not fetch catalog from {url!r}: {exc}") from exc
    try:
        data = yaml.safe_load(body)
    except yaml.YAMLError as exc:
        raise CatalogError(f"catalog at {url!r} is not valid YAML: {exc}") from exc
    if not isinstance(data, dict):
        raise CatalogError(f"catalog at {url!r} must be a YAML mapping at the root")
    if "services" not in data:
        raise CatalogError(f"catalog at {url!r} missing 'services' key")
    return data


def find_in_catalog(catalog: Dict[str, Any], name: str, version: str) -> Dict[str, Any]:
    """Locate (name, version) in a parsed catalog. Returns the
    version-level dict (which includes ``archive``, ``sha256``,
    ``language``, ``install``, etc.). Raises NotInCatalogError if
    absent."""
    for svc in catalog.get("services") or []:
        if svc.get("name") != name:
            continue
        for ver in svc.get("versions") or []:
            if ver.get("version") == version:
                # Merge in service-level fields the version dict
                # doesn't carry, so callers get a single flat view.
                merged = dict(ver)
                for top in ("name", "description", "tags", "implements", "requires"):
                    merged.setdefault(top, svc.get(top))
                return merged
    raise NotInCatalogError(f"{name}@{version} not found in catalog")


# ─── effective config (DB row over env) ──────────────────────────────
# repo_paths + registries are user-editable from the Catalog UI. Edits
# persist to the config/default DB row, which takes precedence over the
# env-built settings so changes apply without an env edit + restart. The
# writable repo_dir stays env-only (it's the install location, not list-
# editable). These helpers are the single source of truth used by both
# boot-time reconcile and the registry endpoints.

def effective_repo_paths(settings: Any, db: Optional[DatabaseAdapter]) -> list:
    """Ordered read-only repo roots. DB config/default.repo_paths wins
    when present (even when []); else config.repo_paths from env."""
    row = db.get_item("config", "default") if db else None
    if row is not None and row.get("repo_paths") is not None:
        return [str(p) for p in (row.get("repo_paths") or []) if p]
    return [str(p) for p in (getattr(settings, "repo_paths", None) or []) if p]


def effective_registries(settings: Any, db: Optional[DatabaseAdapter]) -> list:
    """Ordered registry URLs. DB config/default.registries wins when set;
    else config.registries from env; else the single registry_url."""
    row = db.get_item("config", "default") if db else None
    if row is not None and row.get("registries") is not None:
        urls = [str(u) for u in (row.get("registries") or []) if u]
        if urls:
            return urls
        # An explicit empty list means "no registries" — honour it only
        # if env had none either; otherwise fall through so a blank row
        # doesn't silently disable a configured env default.
        if not (getattr(settings, "registries", None) or getattr(settings, "registry_url", None)):
            return []
    urls = [str(u) for u in (getattr(settings, "registries", None) or []) if u]
    if urls:
        return urls
    single = getattr(settings, "registry_url", None)
    return [str(single)] if single else []


def effective_repo_roots(settings: Any, db: Optional[DatabaseAdapter]) -> list:
    """Writable root first, then the effective read-only repo_paths."""
    from robotlab_x.runtime.repo import _resolve_repo_path, writable_repo_dir
    roots = [writable_repo_dir(settings)]
    for raw in effective_repo_paths(settings, db):
        p = _resolve_repo_path(raw)
        if p not in roots:
            roots.append(p)
    return roots


# ─── multiple registries ─────────────────────────────────────────────

def _as_url_list(catalog_url: Optional[str], catalog_urls: Optional[list]) -> list:
    """Normalize the (url | urls) args callers pass into an ordered list.
    ``catalog_urls`` wins; otherwise the single ``catalog_url`` is used."""
    if catalog_urls:
        return [u for u in catalog_urls if u]
    return [catalog_url] if catalog_url else []


def fetch_merged_catalog(urls: list) -> Dict[str, Any]:
    """Fetch several catalogs and merge their ``services`` lists in
    registry order. When two registries list the same service name, the
    EARLIER registry's entry wins (its versions are kept; later
    duplicates of the same version are dropped). Used by the read-only
    catalog endpoint so the UI sees one unified list across registries.

    Unreachable registries are skipped with a warning rather than failing
    the whole call — a private mirror being down shouldn't hide the
    public catalog. Raises ``CatalogError`` only if EVERY url fails."""
    merged: Dict[str, Any] = {"registry_version": 1, "services": []}
    by_name: Dict[str, Dict[str, Any]] = {}
    errors = []
    any_ok = False
    for url in urls:
        try:
            cat = fetch_catalog(url)
        except CatalogError as exc:
            errors.append(str(exc))
            logger.warning("registry: skipping unreachable catalog %r: %s", url, exc)
            continue
        any_ok = True
        for svc in cat.get("services") or []:
            nm = svc.get("name")
            if nm not in by_name:
                by_name[nm] = {**svc, "versions": list(svc.get("versions") or [])}
                by_name[nm]["source_registry"] = url
                merged["services"].append(by_name[nm])
            else:
                have = {v.get("version") for v in by_name[nm]["versions"]}
                for v in svc.get("versions") or []:
                    if v.get("version") not in have:
                        by_name[nm]["versions"].append(v)
    if not any_ok and urls:
        raise CatalogError(f"no registry reachable: {'; '.join(errors)}")
    return merged


def find_in_catalogs(urls: list, name: str, version: str) -> tuple:
    """Search registries in order for ``name@version``. Returns
    ``(entry, catalog_url)`` from the FIRST registry that has it, so the
    archive download resolves against the right base URL. Raises
    ``NotInCatalogError`` if no registry has it (and ``CatalogError`` if
    none were even reachable)."""
    last_err: Optional[Exception] = None
    reachable = False
    for url in urls:
        try:
            cat = fetch_catalog(url)
        except CatalogError as exc:
            last_err = exc
            continue
        reachable = True
        try:
            return find_in_catalog(cat, name, version), url
        except NotInCatalogError:
            continue
    if not reachable:
        raise CatalogError(f"no registry reachable: {last_err}")
    raise NotInCatalogError(f"{name}@{version} not found in any configured registry")


# ─── helpers ─────────────────────────────────────────────────────────

def _resolve_archive_url(catalog_url: str, archive: str) -> str:
    """Resolve the ``archive`` field (which may be relative) against
    the catalog URL. ``catalog.yml`` typically lives next to the
    archives in the registry root, so the relative path
    ``video/video-1.0.0.tar.gz`` resolves to a sibling of the catalog.
    """
    if archive.startswith(("http://", "https://", "file://")):
        return archive
    return urllib.parse.urljoin(catalog_url, archive)


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _download(url: str, expected_sha: str) -> bytes:
    """Fetch ``url`` to memory, verify sha256. Raises IntegrityError
    if the hash doesn't match. Buffer the whole archive in RAM — they
    measure in single-digit MB at our scale, no streaming complexity
    needed."""
    try:
        with urllib.request.urlopen(url, timeout=60) as resp:
            data = resp.read()
    except Exception as exc:  # noqa: BLE001
        raise LoadError(f"download failed for {url!r}: {exc}") from exc
    actual = _sha256_bytes(data)
    if actual != expected_sha:
        raise IntegrityError(
            f"sha256 mismatch on {url!r}: catalog says {expected_sha}, downloaded {actual}"
        )
    return data


def _extract_archive(data: bytes, repo_dir: Path, name: str, version: str) -> Path:
    """Extract the tarball into ``repo_dir``. The archive is expected
    to contain a top-level ``<name>/<version>/`` dir (matching what
    build_services.py produces); we verify that before extracting so
    we don't litter the repo if someone hands us a malformed archive.

    Returns the resulting directory path (``repo_dir/<name>/<version>``).
    """
    repo_dir.mkdir(parents=True, exist_ok=True)
    expected_prefix = f"{name}/{version}/"

    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tf:
            members = tf.getmembers()
            if not members:
                raise LoadError(f"archive for {name}@{version} is empty")
            # Sanity check: every member path must start with our
            # expected prefix (or be exactly the directory entry).
            # Defends against malicious archives that try to write
            # outside the repo_dir (..-style traversal).
            for m in members:
                if m.name in (name, f"{name}/", f"{name}/{version}", expected_prefix):
                    continue
                if not m.name.startswith(expected_prefix):
                    raise LoadError(
                        f"archive for {name}@{version} contains unexpected path {m.name!r}"
                    )
                # No absolute paths, no parent refs — belt + suspenders
                # against archive traversal.
                if Path(m.name).is_absolute() or ".." in Path(m.name).parts:
                    raise LoadError(
                        f"archive for {name}@{version} contains unsafe path {m.name!r}"
                    )
            # Wipe any previous load of this version — the registry's
            # contract is "extracting gives you a clean fresh copy."
            target = repo_dir / name / version
            if target.exists():
                shutil.rmtree(target)
            # ``filter='data'`` rejects unsafe tar features (absolute
            # paths, parent traversal, device files, etc.). Python 3.14
            # makes this the default; pin it explicitly for 3.12 + 3.13
            # so the deprecation warning stays quiet AND we stay safe.
            tf.extractall(repo_dir, filter="data")
    except (LoadError, IntegrityError):
        raise
    except Exception as exc:  # noqa: BLE001
        raise LoadError(f"extract failed for {name}@{version}: {exc}") from exc

    target = repo_dir / name / version
    if not (target / "package.yml").exists():
        raise LoadError(
            f"extracted archive for {name}@{version} missing package.yml at {target}"
        )
    return target


# ─── sideload (Phase 6) ──────────────────────────────────────────────

def _sniff_name_version(data: bytes) -> Optional[tuple]:
    """Peek a sideloaded tarball's members to recover the
    ``<name>/<version>/`` it carries. Returns ``(name, version)`` or
    None if the archive doesn't have the expected top-level shape."""
    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tf:
            for m in tf.getmembers():
                parts = Path(m.name).parts
                if len(parts) >= 2 and parts[0] and parts[1]:
                    return parts[0], parts[1]
    except Exception:  # noqa: BLE001
        return None
    return None


def sideload_dir(
    staging_dir: Path,
    *,
    repo_dir: Path,
    db: DatabaseAdapter,
    reconcile_roots: Optional[list] = None,
) -> Dict[str, Any]:
    """Air-gapped install path. Extract every ``*.tar.gz`` dropped in
    ``staging_dir`` into the WRITABLE ``repo_dir`` (ABSENT → LOADED, no
    network, no sha256 — the operator vouches for the bits), then move
    each processed archive into ``staging_dir/installed/`` so it isn't
    re-extracted on the next boot. Reconciles the catalog once at the end.

    Returns a summary dict ``{loaded: [...], failed: [...]}``. Safe to
    call when ``staging_dir`` doesn't exist (no-op)."""
    staging_dir = Path(staging_dir)
    repo_dir = Path(repo_dir).resolve()
    summary: Dict[str, Any] = {"loaded": [], "failed": []}
    if not staging_dir.is_dir():
        return summary

    archives = sorted(staging_dir.glob("*.tar.gz"))
    if not archives:
        return summary

    done_dir = staging_dir / "installed"
    for arc in archives:
        try:
            data = arc.read_bytes()
            nv = _sniff_name_version(data)
            if not nv:
                raise LoadError(f"{arc.name} has no <name>/<version>/ top-level dir")
            name, version = nv
            _extract_archive(data, repo_dir, name, version)
            done_dir.mkdir(parents=True, exist_ok=True)
            shutil.move(str(arc), str(done_dir / arc.name))
            summary["loaded"].append(f"{name}@{version}")
            logger.info("registry.sideload: loaded %s@%s from %s", name, version, arc.name)
        except Exception as exc:  # noqa: BLE001
            summary["failed"].append({"archive": arc.name, "error": str(exc)})
            logger.warning("registry.sideload: failed %s: %s", arc.name, exc)

    if summary["loaded"]:
        reconcile_catalog(db, reconcile_roots or [repo_dir])
    return summary


# ─── ABSENT → LOADED ─────────────────────────────────────────────────

def load(
    name: str,
    version: str,
    *,
    catalog_url: Optional[str] = None,
    catalog_urls: Optional[list] = None,
    repo_dir: Path,
    db: DatabaseAdapter,
    reconcile_roots: Optional[list] = None,
) -> Dict[str, Any]:
    """ABSENT → LOADED. Returns the freshly-written service_meta row.

    Steps: search the configured registries in order for (name, version)
    → download archive → verify sha256 → extract to the WRITABLE
    ``repo_dir/<name>/<version>/`` → ``reconcile_catalog()`` to refresh
    the service_meta table from disk. After this the UI sees the new type
    in /v1/service-meta-list and the framework can introspect it.

    ``catalog_urls`` is the ordered registry list (first hit wins);
    ``catalog_url`` is the single-registry back-compat form. ``repo_dir``
    is always the writable root — loads land there regardless of which
    read-only roots also exist. ``reconcile_roots`` is the full root list
    to reconcile after extraction (so types from other roots aren't
    pruned); defaults to just ``[repo_dir]``.

    For services already on disk (LOADED or INSTALLED) this re-extracts
    a fresh copy — useful for reset / corruption recovery. Existing
    ``.venv`` directories are NOT touched.

    Raises ``CatalogError``, ``NotInCatalogError``, ``IntegrityError``,
    or ``LoadError`` on failure.
    """
    repo_dir = Path(repo_dir).resolve()
    urls = _as_url_list(catalog_url, catalog_urls)
    entry, serving_url = find_in_catalogs(urls, name, version)
    archive = entry.get("archive")
    sha = entry.get("sha256")
    if not archive or not sha:
        raise LoadError(f"{name}@{version} catalog entry missing archive or sha256")

    archive_url = _resolve_archive_url(serving_url, archive)
    logger.info("registry.load: %s@%s ← %s", name, version, archive_url)

    # Preserve any existing .venv so a Load-after-Install doesn't wipe
    # the operator's installation. We move it aside, extract, then
    # move it back.
    target = repo_dir / name / version
    saved_venv = None
    if (target / ".venv").exists():
        saved_venv = target.parent / f".__saved_venv__.{int(time.time())}"
        shutil.move(target / ".venv", saved_venv)

    try:
        data = _download(archive_url, sha)
        _extract_archive(data, repo_dir, name, version)
    finally:
        if saved_venv and saved_venv.exists():
            # Move back. The freshly-extracted dir won't have a .venv,
            # so this is safe.
            shutil.move(saved_venv, target / ".venv")

    reconcile_catalog(db, reconcile_roots or [repo_dir])

    meta_id = f"{name}@{version}"
    row = db.get_item("service_meta", meta_id) or {}
    if not row:
        raise LoadError(
            f"reconcile_catalog did not produce a service_meta row for {meta_id} "
            f"after extracting to {target}"
        )

    # Best-effort: tell the in-process types index to republish. Done
    # lazily here (import in-line) because the index module has runtime
    # imports we don't want to drag in at unit-test import time.
    try:
        from robotlab_x.runtime import types_index
        types_index.rebuild()
    except Exception:  # noqa: BLE001
        # The types index isn't running under pytest direct calls; not
        # a registry failure. Production paths will exercise it.
        logger.debug("registry.load: types_index.rebuild skipped (no publisher running)")

    return row


# ─── LOADED → INSTALLED ──────────────────────────────────────────────

def install(
    name: str,
    version: str,
    *,
    repo_dir: Path,
    db: DatabaseAdapter,
    on_progress: Optional[Callable[[str, str], None]] = None,
    on_event: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Dict[str, Any]:
    """LOADED → INSTALLED. For pip services creates the venv + runs
    ``uv pip install <package_spec>`` into it. For builtins (and any
    ``install.kind: builtin``) it's a no-op apart from flipping the
    service_meta row's ``installed`` flag.

    Returns the updated service_meta row.

    Raises ``InstallError`` if the type isn't LOADED or the install
    pipeline fails.
    """
    repo_dir = Path(repo_dir).resolve()
    meta_id = f"{name}@{version}"
    row = db.get_item("service_meta", meta_id)
    if not row:
        raise InstallError(
            f"{meta_id} isn't LOADED — run registry.load first "
            f"(no service_meta row for it)"
        )

    # Installs always build the per-type venv in the WRITABLE root. If
    # the type's source lives in a read-only repo_paths root (recorded as
    # repo_root by reconcile), copy it into the writable root first so we
    # never try to write a .venv under a read-only checkout.
    type_dir = repo_dir / name / version
    if not (type_dir / "package.yml").exists():
        src_root = row.get("repo_root")
        src_dir = Path(src_root) / name / version if src_root else None
        if src_dir and (src_dir / "package.yml").exists() and src_dir.resolve() != type_dir.resolve():
            type_dir.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(src_dir, type_dir, dirs_exist_ok=True,
                            ignore=shutil.ignore_patterns(".venv", "__pycache__", "*.pyc"))
            logger.info("registry.install: copied %s@%s source %s → writable %s",
                        name, version, src_dir, type_dir)
        else:
            raise InstallError(
                f"{meta_id} has a DB row but no files on disk at {type_dir} — "
                f"run registry.load to re-extract"
            )

    dep_mgr = row.get("dependency_manager")
    pkg_spec = row.get("package_spec")

    # Builtin / in-process services: nothing to install. LOADED = INSTALLED.
    if not dep_mgr or dep_mgr == "builtin":
        _mark_installed(db, meta_id, row, error=None)
        return db.get_item("service_meta", meta_id) or row

    if dep_mgr != "pip":
        raise InstallError(
            f"unsupported dependency_manager {dep_mgr!r} for {meta_id} "
            f"(only 'pip' and 'builtin' are wired up today)"
        )
    if not pkg_spec:
        raise InstallError(
            f"{meta_id} declares dependency_manager=pip but no package_spec; "
            f"check the service's package.yml"
        )

    # Mark the transient phase so the UI can show a spinner while the
    # venv builds (pip installs measure in tens of seconds).
    _mark_phase(db, meta_id, "installing")

    # Substitute the ${APP_ROOT} placeholder the same way lifecycle does.
    pkg_spec_resolved = _resolve_package_spec(pkg_spec, repo_dir.parent)

    # Reuse the existing installer — it's the same pipeline /v1/service-
    # request action=install uses, so registry-installed services land
    # exactly where lifecycle-installed ones would. install_pip emits
    # structured step events via ``on_event`` (dict per milestone).
    #
    # We forward those events two ways so callers can pick their fidelity:
    #   * ``on_event``    — the FULL structured milestone dict, so the
    #     registry install can stream the same {step_id, label, index,
    #     total, status, detail, stream, error_code} schema the canvas
    #     (service_request) flow does. Preferred.
    #   * ``on_progress`` — the legacy flattened ``(step, line)`` shape,
    #     kept for back-compat callers that only want a coarse log line.
    def _forward_event(ev: Dict[str, Any]) -> None:
        if on_event is not None:
            try:
                on_event(ev)
            except Exception:  # noqa: BLE001
                logger.debug("registry.install on_event callback raised", exc_info=True)
        if on_progress is not None:
            step = str(ev.get("step_id") or "install")
            line = str(ev.get("detail") or ev.get("status") or ev.get("label") or "")
            on_progress(step, line)

    try:
        from robotlab_x.runtime.installer import install_pip
        install_pip(
            pkg_spec_resolved,
            slot=f"{name}/{version}",
            repo_dir=repo_dir,
            on_event=_forward_event,
        )
    except Exception as exc:  # noqa: BLE001
        _mark_installed(db, meta_id, row, error=f"{type(exc).__name__}: {exc}")
        raise InstallError(f"pip install failed for {meta_id}: {exc}") from exc

    # The venv now lives under the writable root, so the type's
    # authoritative source is the writable root from here on.
    row = {**row, "repo_root": str(repo_dir)}
    _mark_installed(db, meta_id, row, error=None)
    return db.get_item("service_meta", meta_id) or row


def _resolve_package_spec(spec: str, app_root: Path) -> str:
    """Substitute ``${APP_ROOT}`` in a package_spec the same way the
    lifecycle does. Lets package.yml stay environment-agnostic."""
    return spec.replace("${APP_ROOT}", str(app_root))


def _mark_installed(
    db: DatabaseAdapter,
    meta_id: str,
    row: Dict[str, Any],
    error: Optional[str],
) -> None:
    """Record the result of a LOADED→INSTALLED transition.

    Writes the new ``install_phase`` (``installed`` on success, ``failed``
    on error) + ``install_error``, and keeps the deprecated ``installed``
    / ``installation_exception`` mirror in sync for one release so older
    UI keeps working.
    """
    next_row = dict(row)
    ok = error is None
    next_row["install_phase"] = "installed" if ok else "failed"
    next_row["install_error"] = error
    # An install attempt clears any prior load_error — we got the bits.
    next_row["load_error"] = None
    # Deprecated mirror fields, still read by un-migrated callers.
    next_row["installed"] = ok
    next_row["installation_exception"] = error
    next_row["modified"] = datetime.now(timezone.utc).isoformat()
    db.update_item("service_meta", meta_id, next_row, include_nulls=True)


def _mark_phase(db: DatabaseAdapter, meta_id: str, phase: str) -> None:
    """Set just the transient ``install_phase`` (e.g. 'installing') without
    touching the error/mirror fields."""
    row = db.get_item("service_meta", meta_id)
    if not row:
        return
    next_row = dict(row)
    next_row["install_phase"] = phase
    db.update_item("service_meta", meta_id, next_row, include_nulls=True)


# ─── INSTALLED → LOADED ──────────────────────────────────────────────

def uninstall(
    name: str,
    version: str,
    *,
    repo_dir: Path,
    db: DatabaseAdapter,
) -> Dict[str, Any]:
    """INSTALLED → LOADED. Drops the per-type ``.venv/`` and flips the
    installed flag. Files in the type dir stay (a subsequent Install
    rebuilds the venv). For builtins this is essentially just the flag
    flip — they have no venv to drop.

    Returns the updated service_meta row.
    """
    repo_dir = Path(repo_dir).resolve()
    meta_id = f"{name}@{version}"
    row = db.get_item("service_meta", meta_id)
    if not row:
        raise RegistryError(f"{meta_id} not found in service_meta (not LOADED)")

    venv_dir = repo_dir / name / version / ".venv"
    if venv_dir.exists():
        shutil.rmtree(venv_dir)

    # INSTALLED → LOADED: source stays, venv is gone, errors cleared.
    next_row = dict(row)
    next_row["install_phase"] = "loaded"
    next_row["install_error"] = None
    next_row["load_error"] = None
    next_row["installed"] = False
    next_row["installation_exception"] = None
    next_row["modified"] = datetime.now(timezone.utc).isoformat()
    db.update_item("service_meta", meta_id, next_row, include_nulls=True)
    return next_row
