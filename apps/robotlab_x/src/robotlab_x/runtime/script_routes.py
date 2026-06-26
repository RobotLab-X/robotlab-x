# unmanaged
"""Custom Script Editor + repo-icon routes.

Registered from robotlab_x.yml api.extend so generation never owns this
file. The script-run path is gated by the Admin role (security model in
runtime/script_runner.py). The repo-icon path is read-only and
constrained to `<repo>/<name>/<version>/icon.svg` so it's safe to leave
behind the same auth as the rest of /v1.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Callable

from config import get_settings
from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.routing import APIRouter

# Re-use the same auth machinery the CRUD router wires up.
from robotlab_x.api.crud_router_factory import auth_deps

from robotlab_x.runtime import script_runner
from robotlab_x.runtime.registry import effective_repo_roots

# Strict patterns prevent traversal — only [A-Za-z0-9._-] in the name
# and version segments. Anything else 404s.
_SAFE_SEGMENT = re.compile(r"^[A-Za-z0-9._-]+$")


logger = logging.getLogger(__name__)


def _find_repo_asset(name: str, version: str, rel_parts, db) -> Path | None:
    """Locate ``<root>/<name>/<version>/<rel...>`` across ALL effective
    repo roots and return the first existing file (None if none has it).

    Static repo assets (icon.svg, ui/dist/ui.js) ship inside a type's
    bundle, which on a deploy lives in a READ-ONLY repo_paths root (the
    image's baked-in ``repo/``) — NOT in the writable ``repo_dir`` volume
    (``var/repo`` on the s1 deploy), which only holds installed / user
    state. Resolving against ``repo_dir`` alone 404s these even though the
    catalog finds the type fine. Mirror ``registry.effective_repo_roots``
    so these assets resolve the same way the catalog does. Each root keeps
    a traversal guard so the ``[A-Za-z0-9._-]`` segments can't escape it
    via symlink trickery the regex missed.
    """
    if not _SAFE_SEGMENT.match(name) or not _SAFE_SEGMENT.match(version):
        raise HTTPException(status_code=404, detail="not found")
    rel = Path(*rel_parts)
    for root in effective_repo_roots(get_settings(), db):
        root = Path(root)
        root = root.resolve() if root.is_absolute() else (Path.cwd() / root).resolve()
        target = (root / name / version / rel).resolve()
        try:
            target.relative_to(root)
        except ValueError:
            continue  # escape attempt under this root — skip it
        if target.is_file():
            return target
    return None


def register_script_routes(app: FastAPI, get_db_provider: Callable) -> None:
    """Attach the repo-icon static-file route.

    Script EXECUTION moved to the script model's standard action endpoint
    (POST /v1/script-request {action:"run"}) — see
    services/script_service.process_script_request. This module now only
    serves the read-only repo icon (a binary file response, not a model
    resource, so it stays an escape-hatch route).

    `get_db_provider` is kept in the signature for call-site compatibility.
    """
    router = APIRouter()

    def _find_repo_file(name: str, version: str, *rel_parts: str) -> Path | None:
        """Closure wrapper over :func:`_find_repo_asset` that supplies the
        request-time db (so DB-edited repo_paths win over env)."""
        try:
            db = get_db_provider()
        except Exception:
            db = None
        return _find_repo_asset(name, version, rel_parts, db)

    @router.get(
        "/repo/{name}/{version}/icon",
        summary="Service-type icon",
    )
    def service_icon(name: str, version: str):
        # Search every effective repo root (the writable repo_dir AND the
        # read-only repo_paths roots — the icon ships in a type's bundle,
        # which on a deploy lives in the image-baked read-only root).
        icon_path = _find_repo_file(name, version, "icon.svg")
        if icon_path is None:
            raise HTTPException(status_code=404, detail="icon not found")
        return FileResponse(
            icon_path,
            media_type="image/svg+xml",
            headers={"Cache-Control": "public, max-age=300"},
        )

    @router.get(
        "/repo/{name}/{version}/ui.js",
        summary="Service-type frontend bundle (modular UI, Option B)",
    )
    def service_ui_js(name: str, version: str):
        """Serve the service's pre-built UI ESM from
        ``<repo>/<name>/<version>/ui/dist/ui.js``. 404 when the service
        ships no bundled UI — the host then falls back to its static
        serviceViews registry / a placeholder. See
        docs/TODO_SERVICE_UI_BUNDLES.md."""
        path = _find_repo_file(name, version, "ui", "dist", "ui.js")
        if path is None:
            raise HTTPException(status_code=404, detail="no ui bundle")
        return FileResponse(
            path,
            media_type="text/javascript",
            # Revalidate every load (FileResponse sets ETag/Last-Modified):
            # a rebuilt bundle is picked up on a normal refresh (304 when
            # unchanged) without a hard-refresh. Prod can switch to hashed
            # URLs + immutable caching later.
            headers={"Cache-Control": "no-cache"},
        )

    @router.get(
        "/repo/{name}/{version}/xr.js",
        summary="Service-type immersive WebXR bundle (full-page, optional)",
    )
    def service_xr_js(name: str, version: str):
        """Serve the service's optional immersive WebXR ESM from
        ``<repo>/<name>/<version>/ui/dist/xr.js`` — the full-page client a
        headset opens at ``/r/<runtime>/xr/<proxy>``. Built from
        ``ui/xr/View.tsx`` by build-service-ui. 404 when the service ships
        no immersive bundle."""
        path = _find_repo_file(name, version, "ui", "dist", "xr.js")
        if path is None:
            raise HTTPException(status_code=404, detail="no xr bundle")
        return FileResponse(
            path,
            media_type="text/javascript",
            headers={"Cache-Control": "no-cache"},
        )

    @router.get(
        "/repo/{name}/{version}/ui.css",
        summary="Service-type frontend bundle stylesheet (optional)",
    )
    def service_ui_css(name: str, version: str):
        """Serve the optional per-bundle stylesheet from
        ``<repo>/<name>/<version>/ui/dist/ui.css`` (e.g. a third-party
        non-Tailwind stylesheet like xterm.css). 404 when absent."""
        path = _find_repo_file(name, version, "ui", "dist", "ui.css")
        if path is None:
            raise HTTPException(status_code=404, detail="no ui stylesheet")
        return FileResponse(
            path,
            media_type="text/css",
            headers={"Cache-Control": "public, max-age=300"},
        )

    # Content types for the generic bundle-asset route below.
    _ASSET_MEDIA = {
        ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
        ".bin": "application/octet-stream", ".png": "image/png",
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml",
        ".json": "application/json", ".stl": "model/stl", ".wasm": "application/wasm",
    }

    @router.get(
        "/repo/{name}/{version}/file/{subpath:path}",
        summary="Serve an arbitrary file shipped in a service bundle",
    )
    def service_file(name: str, version: str, subpath: str):
        """Serve ``<repo>/<name>/<version>/<subpath>`` from any effective repo
        root — for assets a service ships (e.g. a robot_kinematics visual
        GLB). Same multi-root + per-root traversal guard as ui.js/icon; the
        leading 'file/' keeps it from colliding with the named routes above."""
        parts = [p for p in subpath.split("/") if p not in ("", ".")]
        if not parts or any(p == ".." for p in parts):
            raise HTTPException(status_code=404, detail="not found")
        path = _find_repo_file(name, version, *parts)
        if path is None:
            raise HTTPException(status_code=404, detail="file not found")
        import os
        media = _ASSET_MEDIA.get(os.path.splitext(path.name)[1].lower(),
                                 "application/octet-stream")
        return FileResponse(path, media_type=media,
                            headers={"Cache-Control": "public, max-age=300"})

    app.include_router(router)
