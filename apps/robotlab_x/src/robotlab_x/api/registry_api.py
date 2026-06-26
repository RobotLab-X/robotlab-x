# unmanaged
"""Remote service registry REST endpoints.

  * ``GET    /v1/registry/catalog``        — fetch + return the catalog
                                              scoped to local install state
                                              (ABSENT / LOADED / INSTALLED).
  * ``POST   /v1/registry/load``           — body ``{name, version}``.
                                              Transitions ABSENT → LOADED.
  * ``POST   /v1/registry/install``        — body ``{name, version}``.
                                              Transitions LOADED → INSTALLED.
  * ``POST   /v1/registry/uninstall``      — body ``{name, version}``.
                                              Transitions INSTALLED → LOADED.

All three mutating endpoints are admin-gated — installing a service
runs arbitrary pip + executes code, not something a regular user role
should be able to trigger. Read-only catalog lookup also requires auth
so the catalog URL (which may be a private mirror) doesn't leak.

The registry URL is read from the running app's config — Config has a
``registry_url`` field that defaults to ``file:///tmp/repo/catalog.yml``
for the local mirror Phase 1 produces.
"""
from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

from auth import create_auth_dependencies
from config import create_app_settings, get_settings
from database.factory import get_database_client
from database.interface import DatabaseAdapter
from fastapi import APIRouter, Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

from robotlab_x.models.config import Config
from robotlab_x.runtime import registry


logger = logging.getLogger(__name__)

settings, config_provider = create_app_settings("robotlab_x", Config)
auth_deps = create_auth_dependencies(config_provider)

_ROLES = ["Admin"]


# ─── request/response models ─────────────────────────────────────────

class TypeStateRequest(BaseModel):
    name: str = Field(..., description="Service type name, e.g. 'video'")
    version: str = Field(..., description="Service version, e.g. '1.0.0'")


class TypeStateResponse(BaseModel):
    name: str
    version: str
    state: str = Field(..., description="absent | loaded | installing | installed | failed")
    archive: Optional[str] = Field(None, description="archive URL if known from catalog")
    sha256: Optional[str] = Field(None, description="archive sha256 if known from catalog")
    description: Optional[str] = None
    load_error: Optional[str] = Field(None, description="detail if the ABSENT→LOADED step failed")
    install_error: Optional[str] = Field(None, description="detail if the LOADED→INSTALLED step failed")
    # Deprecated mirror, kept for one release.
    installation_exception: Optional[str] = None


class CatalogEntry(BaseModel):
    name: str
    description: Optional[str] = None
    tags: List[str] = []
    implements: List[str] = []
    requires: List[str] = []
    versions: List[Dict[str, Any]] = []
    # Which registry URL served this entry (first-wins across the merged
    # registries). Lets the UI show provenance per row.
    source_registry: Optional[str] = None


class RepoRootInfo(BaseModel):
    path: str
    writable: bool = Field(..., description="True for the single root where loads/installs land")
    exists: bool = Field(..., description="Whether the directory currently exists on disk")


class SourcesUpdate(BaseModel):
    """Full replacement of the editable source lists (order preserved)."""
    repo_paths: List[str] = Field(default_factory=list)
    registries: List[str] = Field(default_factory=list)


class SourcesResponse(BaseModel):
    """Where this runtime gets service types from — surfaced so the
    operator/dev can see the actual config at a glance."""
    repo_roots: List[RepoRootInfo] = Field(
        default_factory=list,
        description="Local repo roots scanned in order (writable first, then read-only repo_paths).",
    )
    registries: List[str] = Field(
        default_factory=list,
        description="Remote catalog.yml URLs searched in order for ABSENT types.",
    )


class ReconcileResponse(BaseModel):
    """Result of rescanning the local repo roots into service_meta."""
    inserted: int = Field(0, description="New service types added to the catalog")
    upserted: int = Field(0, description="Existing types refreshed from disk")
    removed: int = Field(0, description="Types whose on-disk package vanished")
    found: int = Field(0, description="Total packages found across all roots")
    roots: List[str] = Field(default_factory=list, description="Repo roots scanned, in order")


class CatalogResponse(BaseModel):
    registry_version: int = 1
    registry_url: str
    services: List[CatalogEntry] = []
    # Per-(name, version) tuple → local state. Lets the UI render the
    # ABSENT / LOADED / INSTALLED chip without a second round-trip.
    local_state: Dict[str, str] = Field(
        default_factory=dict,
        description="Map of '<name>@<version>' → 'absent'|'loaded'|'installed'|'failed'",
    )


# ─── helpers ─────────────────────────────────────────────────────────

def _resolve_registry_urls(db: Optional[DatabaseAdapter] = None) -> List[str]:
    """Ordered registry URLs — DB config/default.registries (user-edited
    in the Catalog UI) wins over env; falls back to the local-mirror
    default."""
    urls = registry.effective_registries(get_settings(), db)
    return urls or ["file:///tmp/repo/catalog.yml"]


def _resolve_repo_dir() -> Path:
    """The WRITABLE repo root — where loads extract + installs build."""
    from robotlab_x.runtime.repo import writable_repo_dir
    return writable_repo_dir(get_settings())


def _resolve_repo_roots(db: Optional[DatabaseAdapter] = None) -> List[Path]:
    """All repo roots (writable first, then the effective read-only
    repo_paths) — DB config/default.repo_paths wins over env."""
    return registry.effective_repo_roots(get_settings(), db)


def _local_state_map(db: DatabaseAdapter) -> Dict[str, str]:
    """Build a ``"<name>@<version>" → 'loaded'|'installing'|'installed'|'failed'``
    map from the current service_meta table. Anything in the catalog
    but missing here is ABSENT (no entry → the UI treats it as absent).

    Reads the explicit ``install_phase`` field, falling back to the
    deprecated ``installed`` / ``installation_exception`` derivation for
    rows written before the field existed."""
    out: Dict[str, str] = {}
    for row in db.get_all_items("service_meta") or []:
        mid = row.get("id")
        if not mid:
            continue
        phase = row.get("install_phase")
        if phase:
            out[mid] = phase
        elif row.get("installation_exception"):
            out[mid] = "failed"
        elif row.get("installed"):
            out[mid] = "installed"
        else:
            out[mid] = "loaded"
    return out


# ─── async install (Phase B) ─────────────────────────────────────────
# pip installs build a venv (tens of seconds) — too long to block the
# POST. We run them on a background thread, stream progress to the bus
# so the UI can show a live log, and return "installing" immediately.
# Builtins are instant and stay synchronous.

# Serialize registry installs across threads — installs are rare and the
# shared DB adapter (TinyDB in dev) isn't built for concurrent writers.
_REGISTRY_INSTALL_LOCK = threading.Lock()


def _install_progress_topic(meta_id: str) -> str:
    return f"/registry/install/{meta_id}/progress"


def _run_install_bg(name: str, version: str, repo_dir: Path) -> None:
    """Background worker: run the venv build for a pip service, streaming
    each line to the bus. Uses a fresh DB client (the request-scoped one
    is gone once the endpoint returned)."""
    from database.factory import get_database_client
    from robotlab_x.runtime.bus import get_bus

    meta_id = f"{name}@{version}"
    topic = _install_progress_topic(meta_id)
    bus = get_bus()
    db = get_database_client()

    # Stream the SAME structured install milestones the canvas
    # (service_request) flow emits, so a single UI component renders both.
    # Each frame is the installer's milestone dict re-enveloped with
    # ``phase:'install'`` + ``meta_id`` (the shape the frontend
    # useInstallProgress parser keys on). Shape per frame:
    #   {phase:'install', meta_id, step_id, label, index, total, status,
    #    detail?, stream?, error_code?}
    def on_event(ev: Dict[str, Any]) -> None:
        try:
            bus.publish_sync(topic, {"meta_id": meta_id, "phase": "install", **ev})
        except Exception:  # noqa: BLE001
            logger.debug("registry.install progress publish failed", exc_info=True)

    with _REGISTRY_INSTALL_LOCK:
        try:
            row = registry.install(name, version, repo_dir=repo_dir, db=db, on_event=on_event)
            state = row.get("install_phase") or ("installed" if row.get("installed") else "failed")
            # Terminal marker for pollers/back-compat. The milestone parser
            # ignores frames without ``step_id``, so this is harmless to it —
            # the install_pip "completed" milestone already drove the UI to
            # done. On a clean failure install_pip emitted its own failed
            # milestone before raising, so the UI already shows the break.
            bus.publish_sync(topic, {"meta_id": meta_id, "phase": "install", "done": True,
                                     "state": state, "install_error": row.get("install_error")})
        except Exception as exc:  # noqa: BLE001
            logger.warning("registry.install background failed for %s: %s", meta_id, exc)
            # Synthetic failed milestone so the UI terminates even if the
            # install threw BEFORE install_pip emitted a failed step (e.g. a
            # pre-flight copytree error). Carries the same schema as a real
            # milestone so the shared parser flips overall → failed.
            bus.publish_sync(topic, {
                "meta_id": meta_id, "phase": "install", "step_id": "install",
                "label": "Install", "index": 1, "total": 1, "status": "failed",
                "detail": str(exc), "error_code": "exception", "done": True, "state": "failed",
            })


# ─── routes ──────────────────────────────────────────────────────────

def register_registry_routes(app: FastAPI, get_db_provider) -> None:
    """Mount the registry endpoints on ``app``. Wired from
    robotlab_x.yml's ``api.extend`` block; pattern matches the other
    register_*_routes calls in there."""
    router = APIRouter()

    @router.get(
        "/registry/sources",
        response_model=SourcesResponse,
        description=(
            "Where this runtime gets service types from: the ordered local "
            "repo roots (writable first, then read-only repo_paths) and the "
            "ordered remote registries. Surfaced so the operator can see the "
            "actual config without reading env vars."
        ),
    )
    def get_sources(
        _: Any = Depends(auth_deps.require_role(_ROLES)),
        db: DatabaseAdapter = Depends(get_db_provider),
    ) -> SourcesResponse:
        # Best-effort + defensive: a hiccup resolving roots/registries
        # (e.g. a mid-write config row) must not 500 the whole sources
        # panel — degrade to whatever we can resolve so the operator
        # still sees the local repo and the catalog stays usable.
        try:
            writable = _resolve_repo_dir()
            roots = []
            for r in _resolve_repo_roots(db):
                roots.append(RepoRootInfo(
                    path=str(r),
                    writable=(r == writable),
                    exists=r.is_dir(),
                ))
            return SourcesResponse(repo_roots=roots, registries=_resolve_registry_urls(db))
        except Exception:  # noqa: BLE001
            logger.exception("registry.sources: resolve failed — returning best-effort")
            try:
                w = _resolve_repo_dir()
                roots = [RepoRootInfo(path=str(w), writable=True, exists=w.is_dir())]
            except Exception:  # noqa: BLE001
                roots = []
            return SourcesResponse(repo_roots=roots, registries=[])

    @router.put(
        "/registry/sources",
        response_model=SourcesResponse,
        description=(
            "Replace the editable source lists — the read-only local "
            "repo_paths and the remote registries — persisting them to the "
            "config/default row so they survive restart and take effect "
            "immediately (no env edit needed). Send the FULL ordered lists; "
            "this supports add / edit / delete / reorder in one call. The "
            "writable repo_dir is not editable here."
        ),
    )
    def put_sources(
        body: SourcesUpdate,
        _: Any = Depends(auth_deps.require_role(_ROLES)),
        db: DatabaseAdapter = Depends(get_db_provider),
    ) -> SourcesResponse:
        row = db.get_item("config", "default") or {"id": "default"}
        row = dict(row)
        # Normalize: trim blanks, drop empties, preserve order.
        row["repo_paths"] = [p.strip() for p in (body.repo_paths or []) if p and p.strip()]
        row["registries"] = [u.strip() for u in (body.registries or []) if u and u.strip()]
        db.update_item("config", "default", row, include_nulls=True)
        # Return the new effective view.
        writable = _resolve_repo_dir()
        roots = [RepoRootInfo(path=str(r), writable=(r == writable), exists=r.is_dir())
                 for r in _resolve_repo_roots(db)]
        return SourcesResponse(repo_roots=roots, registries=_resolve_registry_urls(db))

    @router.get(
        "/registry/catalog",
        response_model=CatalogResponse,
        description=(
            "Fetch the remote catalog + return it annotated with the local "
            "install state per (name, version). The UI Catalog page uses "
            "this to render ABSENT / LOADED / INSTALLED chips next to each "
            "catalog entry, distinguishing 'remote types you could install' "
            "from 'types you already have'."
        ),
    )
    def get_catalog(
        _: Any = Depends(auth_deps.require_role(_ROLES)),
        db: DatabaseAdapter = Depends(get_db_provider),
    ) -> CatalogResponse:
        urls = _resolve_registry_urls(db)
        try:
            cat = registry.fetch_merged_catalog(urls)
        except registry.CatalogError as exc:
            raise HTTPException(status_code=502, detail=f"catalog fetch failed: {exc}")
        local = _local_state_map(db)
        return CatalogResponse(
            registry_version=int(cat.get("registry_version", 1)),
            registry_url=", ".join(urls),
            services=[CatalogEntry(**svc) for svc in (cat.get("services") or [])],
            local_state=local,
        )

    @router.post(
        "/registry/reconcile",
        response_model=ReconcileResponse,
        description=(
            "Rescan the local repo root(s) and refresh the service_meta "
            "catalog to match what's on disk — the same reconcile that "
            "runs at boot, exposed so an operator who just dropped a new "
            "package into repo/ can see it in the Installed (local) view "
            "WITHOUT restarting the backend. Adds new types, refreshes "
            "changed ones, removes rows whose package is gone."
        ),
    )
    def reconcile_local(
        _: Any = Depends(auth_deps.require_role(_ROLES)),
        db: DatabaseAdapter = Depends(get_db_provider),
    ) -> ReconcileResponse:
        from robotlab_x.runtime.catalog import reconcile_catalog
        roots = _resolve_repo_roots(db)
        summary = reconcile_catalog(db, roots)
        return ReconcileResponse(
            inserted=summary.get("inserted", 0),
            upserted=summary.get("upserted", 0),
            removed=summary.get("removed", 0),
            found=summary.get("found", 0),
            roots=[str(r) for r in roots],
        )

    @router.post(
        "/registry/load",
        response_model=TypeStateResponse,
        description=(
            "ABSENT → LOADED. Download the (name, version) archive from "
            "the catalog, verify sha256, extract into the local repo. "
            "The service appears in /v1/service-meta-list afterwards but "
            "isn't yet runnable — call POST /v1/registry/install next."
        ),
    )
    def load_type(
        req: TypeStateRequest,
        _: Any = Depends(auth_deps.require_role(_ROLES)),
        db: DatabaseAdapter = Depends(get_db_provider),
    ) -> TypeStateResponse:
        urls = _resolve_registry_urls(db)
        try:
            row = registry.load(
                req.name, req.version,
                catalog_urls=urls,
                repo_dir=_resolve_repo_dir(),
                db=db,
                reconcile_roots=_resolve_repo_roots(db),
            )
        except registry.NotInCatalogError as exc:
            raise HTTPException(status_code=404, detail=str(exc))
        except registry.IntegrityError as exc:
            raise HTTPException(status_code=409, detail=str(exc))
        except (registry.CatalogError, registry.LoadError) as exc:
            raise HTTPException(status_code=502, detail=str(exc))
        return TypeStateResponse(
            name=req.name,
            version=req.version,
            state="loaded",
            archive=None,
            sha256=row.get("sha256"),
            description=row.get("description"),
        )

    @router.post(
        "/registry/install",
        response_model=TypeStateResponse,
        description=(
            "LOADED → INSTALLED. Builtins flip synchronously and return "
            "state='installed'. pip-based subprocess services build their "
            "per-type venv on a BACKGROUND thread and return "
            "state='installing' immediately; progress lines stream on the "
            "bus topic /registry/install/{name}@{version}/progress, with a "
            "final {done:true, state:'installed'|'failed'} event."
        ),
    )
    def install_type(
        req: TypeStateRequest,
        _: Any = Depends(auth_deps.require_role(_ROLES)),
        db: DatabaseAdapter = Depends(get_db_provider),
    ) -> TypeStateResponse:
        meta_id = f"{req.name}@{req.version}"
        row = db.get_item("service_meta", meta_id)
        if not row:
            raise HTTPException(status_code=409, detail=f"{meta_id} isn't LOADED — load it first")

        dep_mgr = row.get("dependency_manager")
        repo_dir = _resolve_repo_dir()

        # Builtins are instant — run inline and return the terminal state.
        if not dep_mgr or dep_mgr == "builtin":
            try:
                row = registry.install(req.name, req.version, repo_dir=repo_dir, db=db)
            except registry.InstallError as exc:
                raise HTTPException(status_code=409, detail=str(exc))
            return TypeStateResponse(
                name=req.name, version=req.version,
                state=row.get("install_phase") or ("installed" if row.get("installed") else "failed"),
                install_error=row.get("install_error") or row.get("installation_exception"),
                installation_exception=row.get("installation_exception"),
                description=row.get("description"),
            )

        # pip services: build the venv on a background thread, stream
        # progress to /registry/install/{meta_id}/progress on the bus,
        # return "installing" right away. Mark the phase synchronously so
        # a catalog re-fetch in the gap shows the spinner too.
        registry._mark_phase(db, meta_id, "installing")
        threading.Thread(
            target=_run_install_bg,
            args=(req.name, req.version, repo_dir),
            name=f"rlx-install-{meta_id}",
            daemon=True,
        ).start()
        return TypeStateResponse(
            name=req.name, version=req.version, state="installing",
            description=row.get("description"),
        )

    @router.post(
        "/registry/uninstall",
        response_model=TypeStateResponse,
        description=(
            "INSTALLED → LOADED. Drops the per-type venv but keeps the "
            "service's source files. A subsequent Install rebuilds the "
            "venv. For builtins this is just the flag flip."
        ),
    )
    def uninstall_type(
        req: TypeStateRequest,
        _: Any = Depends(auth_deps.require_role(_ROLES)),
        db: DatabaseAdapter = Depends(get_db_provider),
    ) -> TypeStateResponse:
        try:
            row = registry.uninstall(
                req.name, req.version,
                repo_dir=_resolve_repo_dir(),
                db=db,
            )
        except registry.RegistryError as exc:
            raise HTTPException(status_code=404, detail=str(exc))
        return TypeStateResponse(
            name=req.name,
            version=req.version,
            state="loaded",
            description=row.get("description"),
        )

    app.include_router(router, prefix="/v1", tags=["Registry"])
