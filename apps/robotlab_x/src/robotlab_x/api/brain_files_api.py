# unmanaged
"""Brain workspace file API — stone A of TODO_BRAIN_VIEWER.md.

Endpoints:
  GET  /v1/service-proxy/{proxy_id}/files          → tree
  GET  /v1/service-proxy/{proxy_id}/files/content  → file body

Stone A is READ-ONLY. Edits land in stone C. The tree merges two roots:

  * Workspace files at ``<data_dir>/brain/<proxy_id>/`` (writable)
  * Bundled workflows at ``<repo_root>/brain/<ver>/workflows/`` (read-only,
    found across every effective repo root — see ``_resolve_brain_roots``)

Same-name local workflows shadow bundled ones (matches the runtime
behavior in ``brain.context_loader.list_workflow_dirs``).

Path safety: every virtual path is sanity-checked + the resolved
filesystem path must stay inside its declared root. ``..``, leading
slashes, NUL bytes, and resolved-paths-that-escape-the-root all
return 400.

Auth: any logged-in user. Write endpoints (stone C) gate on Admin;
read endpoints don't because operators can already see everything
via the bus and shell.
"""
from __future__ import annotations

import logging
import mimetypes
import re
import shutil
from pathlib import Path
from typing import Any, List, Literal, Optional, Tuple

from auth import create_auth_dependencies
from config import create_app_settings, get_settings
from database.factory import get_database_client
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from robotlab_x.models.config import Config
from robotlab_x.runtime.registry import effective_repo_roots
from robotlab_x.runtime.repo import scan_repo


logger = logging.getLogger(__name__)


_settings, _config_provider = create_app_settings("robotlab_x", Config)
_auth_deps = create_auth_dependencies(_config_provider)
_USER_ROLES = ["User", "Admin"]
# Writes (stone C) gate higher than reads — same reasoning as the
# config-sets API: editing files mutates state every operator sees.
_ADMIN_ROLES = ["Admin"]


router = APIRouter()


# Cap on recursive walk depth — guards against pathological symlink
# loops (we strip symlinks too, but defense in depth is cheap) and
# keeps response bodies bounded.
MAX_TREE_DEPTH = 6
# Hard cap on total entries returned in a single tree response.
# Stone A always walks the whole tree; this protects against runaway
# response sizes on workspaces with thousands of run logs.
MAX_TREE_ENTRIES = 2000


# ─── response shapes ──────────────────────────────────────────────────


class FileEntry(BaseModel):
    """One node in the merged workspace+bundled tree. ``path`` is the
    virtual path the operator sees — e.g. ``workflows/observe_room/prompt.md``
    — and is the key passed to ``/files/content`` to read the file."""

    name: str
    path: str
    type: Literal["dir", "file"]
    source: Literal["workspace", "bundled"]
    # True iff this is a bundled entry whose name exists under
    # workspace too (the local one wins at runtime).
    shadowed: bool = False
    # File-only metadata.
    size: Optional[int] = None
    mtime: Optional[float] = None
    children: List["FileEntry"] = Field(default_factory=list)


class FileTreeResponse(BaseModel):
    proxy_id: str
    workspace_dir: str
    bundled_dir: Optional[str]
    entries: List[FileEntry]


class FileContentResponse(BaseModel):
    proxy_id: str
    path: str
    source: Literal["workspace", "bundled"]
    content: str
    mtime: float
    size: int
    writable: bool
    mime: str


class PutFileRequest(BaseModel):
    """Body for PUT /files/content. ``expected_mtime`` powers
    optimistic-concurrency conflict detection — when the disk mtime
    doesn't match what the client last saw, return 409 so the UI can
    surface the conflict instead of blindly overwriting another
    operator's edit (or the brain's own write to memory/)."""
    content: str
    expected_mtime: Optional[float] = Field(
        None,
        description=(
            "mtime of the file at last read. If provided and disk mtime "
            "has moved since, save is rejected with 409. Omit on first "
            "write of a new file, or when the operator explicitly chooses "
            "to force overwrite after a conflict dialog."
        ),
    )


class PutFileResponse(BaseModel):
    proxy_id: str
    path: str
    written: bool
    mtime: float
    size: int


class ConflictResponse(BaseModel):
    """Payload returned with 409 so the UI can render a conflict
    resolution dialog without a follow-up GET."""
    error: Literal["mtime_conflict"]
    expected_mtime: float
    actual_mtime: float
    actual_content: str


class ForkRequest(BaseModel):
    """Fork a bundled workflow directory into the workspace (stone D).

    ``source_path`` is the virtual path to a workflow under bundled —
    typically ``workflows/<name>``. We always fork at the workflow-dir
    granularity (not per-file) because the 5 sibling files are coherent
    as a unit: editing prompt.md alone without its workflow.yaml +
    allowed_tools.yaml leaves the workflow non-bootable.
    """
    source_path: str


class ForkResponse(BaseModel):
    proxy_id: str
    source_path: str
    dest_path: str
    files: List[str]  # workspace-relative paths of every file copied


# ─── stone E shapes ───────────────────────────────────────────────────


class NewWorkflowRequest(BaseModel):
    """Scaffold a new workflow under ``workflows/<name>/`` with the
    five canonical files pre-populated from templates."""
    name: str


class NewWorkflowResponse(BaseModel):
    proxy_id: str
    name: str
    dest_path: str
    files: List[str]


class RenameRequest(BaseModel):
    from_path: str
    to_path: str


class RenameResponse(BaseModel):
    proxy_id: str
    from_path: str
    to_path: str


class DeleteResponse(BaseModel):
    proxy_id: str
    path: str
    deleted_files: int  # >1 if a directory was removed recursively


# ─── path resolution / safety ─────────────────────────────────────────


def _resolve_brain_roots(proxy_id: str) -> Tuple[Path, Optional[Path]]:
    """Return ``(workspace_dir, bundled_workflows_dir)`` for a brain proxy.

    Workspace defaults to ``<data_dir>/brain/<proxy_id>/``. Bundled
    workflows live at ``<repo_root>/brain/<version>/workflows/`` (version
    from the proxy's ``service_meta_id``), searched across every effective
    repo root so they resolve on a deploy where the bundle is in a
    read-only repo_paths root rather than the writable repo_dir.

    Raises 404 if the proxy doesn't exist; 400 if it isn't a brain.
    """
    db = get_database_client()
    if db is None:
        raise HTTPException(503, "database not available")
    proxy = db.get_item("service_proxy", proxy_id)
    if not proxy:
        raise HTTPException(404, f"service_proxy {proxy_id!r} not found")
    meta_id = (proxy.get("service_meta_id") or "")
    if not meta_id.startswith("brain@"):
        raise HTTPException(400, f"{proxy_id!r} isn't a brain (type={meta_id!r})")

    settings = get_settings()
    data_dir = Path(settings.data_dir or "data")
    if not data_dir.is_absolute():
        data_dir = Path.cwd() / data_dir
    # Honor an explicit workspace_path on the row, falling back to the
    # standard layout. Mirrors brain.service._resolve_workspace.
    cfg = proxy.get("service_config") or {}
    if cfg.get("workspace_path"):
        workspace_dir = Path(cfg["workspace_path"]).expanduser().resolve()
    else:
        workspace_dir = (data_dir / "brain" / proxy_id).resolve()

    try:
        version = meta_id.split("@", 1)[1]
    except IndexError:
        version = "1.0.0"
    # Bundled workflows ship inside the brain TYPE bundle. On a deploy that
    # bundle lives in a READ-ONLY repo_paths root (the image's baked-in
    # repo/), NOT the writable repo_dir volume (var/repo on s1, which holds
    # only installed/user state). Resolving against repo_dir alone returns
    # None there, so the UI shows no bundled workflows even though the brain
    # type loads fine. Search every effective root (writable first, then
    # read-only repo_paths) the same way the catalog/runtime do.
    bundled_dir = None
    for root in effective_repo_roots(settings, db):
        cand = (Path(root) / "brain" / version / "workflows").resolve()
        if cand.is_dir():
            bundled_dir = cand
            break

    return workspace_dir, bundled_dir


def _safe_resolve(root: Path, virtual: str) -> Path:
    """Validate + resolve a virtual path against a root dir.

    Rejects empty segments, ``..``, leading slashes, NUL bytes, and
    resolved paths that escape ``root`` (e.g. symlinks). Returns the
    resolved absolute Path; raises HTTPException(400) on violation."""
    if "\x00" in virtual:
        raise HTTPException(400, "null byte in path")
    if virtual.startswith("/") or virtual.startswith("\\"):
        raise HTTPException(400, "absolute paths are not allowed")
    parts = [p for p in virtual.replace("\\", "/").split("/") if p]
    if any(p in (".", "..") for p in parts):
        raise HTTPException(400, "path traversal is not allowed")
    candidate = root.joinpath(*parts) if parts else root
    try:
        resolved = candidate.resolve(strict=False)
    except OSError as exc:
        raise HTTPException(400, f"cannot resolve path: {exc}")
    # On Python 3.12 is_relative_to is canonical; we guard against an
    # OSError-raising parent edge case by using a string-prefix check.
    root_str = str(root.resolve()) + "/"
    if str(resolved) != str(root.resolve()) and not str(resolved).startswith(root_str):
        raise HTTPException(400, f"resolved path escapes root: {virtual!r}")
    return resolved


# ─── tree walk ────────────────────────────────────────────────────────


def _list_dir(real_dir: Path, virtual_prefix: str, source: str, *,
              shadowed_names: Optional[set] = None,
              depth_remaining: int, budget: List[int]) -> List[FileEntry]:
    """One level of children. Recurses depth-first up to depth_remaining.

    ``budget[0]`` is the remaining entry quota — decremented on each
    entry. The walk truncates silently when budget runs out (caller's
    response stays bounded).

    ``shadowed_names`` is consulted at this level only — used when
    listing bundled workflows so we can stamp the ``shadowed`` flag
    on names that the workspace also has.
    """
    out: List[FileEntry] = []
    try:
        children = sorted(real_dir.iterdir())
    except (OSError, PermissionError) as exc:
        logger.warning("files.tree: can't read %s: %s", real_dir, exc)
        return out
    for child in children:
        if budget[0] <= 0:
            break
        if child.name.startswith("."):
            continue  # hide dotfiles (.migrated, .DS_Store, etc.)
        if child.is_symlink():
            # Resolve + verify the link target stays inside the root.
            try:
                target = child.resolve(strict=True)
            except (OSError, RuntimeError):
                continue
            if not str(target).startswith(str(real_dir.parents[0])):
                continue
        budget[0] -= 1
        entry_path = f"{virtual_prefix}/{child.name}" if virtual_prefix else child.name
        if child.is_dir():
            entry = FileEntry(
                name=child.name,
                path=entry_path,
                type="dir",
                source=source,
                shadowed=(shadowed_names is not None and child.name in shadowed_names),
            )
            if depth_remaining > 1 and budget[0] > 0:
                entry.children = _list_dir(
                    child, entry_path, source,
                    depth_remaining=depth_remaining - 1, budget=budget,
                )
            out.append(entry)
        elif child.is_file():
            try:
                stat = child.stat()
            except OSError:
                continue
            out.append(FileEntry(
                name=child.name,
                path=entry_path,
                type="file",
                source=source,
                size=stat.st_size,
                mtime=stat.st_mtime,
            ))
    return out


def _merge_workflows(
    workspace_workflows: Optional[Path],
    bundled_workflows: Optional[Path],
    budget: List[int],
) -> List[FileEntry]:
    """Build the merged ``workflows/`` listing.

    Workspace workflows always come first (they shadow bundled).
    Bundled ones with the same name as a local override get
    shadowed=true so the UI can show a visual indicator without
    pretending the bundled copy doesn't exist.
    """
    out: List[FileEntry] = []
    local_names: set = set()

    if workspace_workflows and workspace_workflows.is_dir():
        local = _list_dir(
            workspace_workflows, "workflows", "workspace",
            depth_remaining=MAX_TREE_DEPTH - 1, budget=budget,
        )
        for entry in local:
            local_names.add(entry.name)
        out.extend(local)

    if bundled_workflows and bundled_workflows.is_dir():
        bundled = _list_dir(
            bundled_workflows, "workflows", "bundled",
            shadowed_names=local_names,
            depth_remaining=MAX_TREE_DEPTH - 1, budget=budget,
        )
        out.extend(bundled)

    # Sort the merged list alphabetically; sources interleave naturally.
    out.sort(key=lambda e: (e.name, 0 if e.source == "workspace" else 1))
    return out


def _build_tree(workspace_dir: Path, bundled_workflows: Optional[Path]) -> List[FileEntry]:
    """Top-level virtual root: workflows (merged) / memory / runs.

    workflows is the merged virtual dir; memory + runs are workspace-only.
    Any workspace dir we don't recognize falls through as a top-level
    workspace entry (forward-compat — if a future feature adds a new
    dir, the operator can still browse it)."""
    budget = [MAX_TREE_ENTRIES]
    entries: List[FileEntry] = []

    # workflows (merged virtual)
    workspace_workflows = workspace_dir / "workflows"
    workflows_entry = FileEntry(
        name="workflows",
        path="workflows",
        type="dir",
        source="workspace" if workspace_workflows.is_dir() else "bundled",
    )
    workflows_entry.children = _merge_workflows(
        workspace_workflows if workspace_workflows.is_dir() else None,
        bundled_workflows,
        budget,
    )
    entries.append(workflows_entry)

    # Workspace-only roots, plus anything else the operator put there.
    if workspace_dir.is_dir():
        try:
            ws_children = sorted(workspace_dir.iterdir())
        except OSError:
            ws_children = []
        for child in ws_children:
            if child.name == "workflows":  # already handled
                continue
            if child.name.startswith("."):
                continue
            if not child.is_dir():
                # Top-level loose files are unusual but legal.
                try:
                    stat = child.stat()
                except OSError:
                    continue
                if budget[0] <= 0: break
                budget[0] -= 1
                entries.append(FileEntry(
                    name=child.name, path=child.name, type="file",
                    source="workspace", size=stat.st_size, mtime=stat.st_mtime,
                ))
                continue
            if budget[0] <= 0: break
            budget[0] -= 1
            entry = FileEntry(
                name=child.name, path=child.name, type="dir", source="workspace",
            )
            entry.children = _list_dir(
                child, child.name, "workspace",
                depth_remaining=MAX_TREE_DEPTH - 1, budget=budget,
            )
            entries.append(entry)

    return entries


# ─── content resolution ──────────────────────────────────────────────


def _resolve_content_file(
    virtual_path: str,
    workspace_dir: Path,
    bundled_workflows: Optional[Path],
    preferred_source: Optional[str],
) -> Tuple[Path, str]:
    """Map a virtual path to (real_filesystem_path, source).

    Resolution rules:
      * ``workflows/<name>/<file>``: workspace wins if present; falls
        back to bundled. ``preferred_source`` forces one or the other.
      * any other top-level path: workspace only.

    Raises 404 if the file doesn't exist; 400 on path traversal.
    """
    parts = [p for p in virtual_path.replace("\\", "/").split("/") if p]
    if not parts:
        raise HTTPException(400, "empty path")

    if parts[0] == "workflows" and len(parts) > 1:
        # Try workspace + bundled in order based on preferred_source.
        ws_path = _safe_resolve(workspace_dir, virtual_path)
        bd_path = (
            _safe_resolve(bundled_workflows, "/".join(parts[1:]))
            if bundled_workflows else None
        )
        if preferred_source == "bundled" and bd_path and bd_path.is_file():
            return bd_path, "bundled"
        if preferred_source == "workspace" and ws_path.is_file():
            return ws_path, "workspace"
        # Auto: workspace first.
        if ws_path.is_file():
            return ws_path, "workspace"
        if bd_path and bd_path.is_file():
            return bd_path, "bundled"
        raise HTTPException(404, f"file not found: {virtual_path}")

    ws_path = _safe_resolve(workspace_dir, virtual_path)
    if ws_path.is_file():
        return ws_path, "workspace"
    raise HTTPException(404, f"file not found: {virtual_path}")


# ─── change events (stone F) ──────────────────────────────────────────


def _publish_file_change(
    proxy_id: str,
    path: str,
    kind: Literal["created", "modified", "deleted"],
    mtime: Optional[float] = None,
) -> None:
    """Emit a ``/brain/{proxy_id}/files/changed`` event for the UI.

    Failures are swallowed — a missed event is annoying (operator hits
    Refresh) but never a correctness problem. The file system is
    authoritative; events are just a hint for live UX.
    """
    try:
        from robotlab_x.runtime.bus import get_bus
        payload: dict = {"path": path, "kind": kind}
        if mtime is not None:
            payload["mtime"] = mtime
        get_bus().publish_sync(f"/brain/{proxy_id}/files/changed", payload)
    except Exception:  # noqa: BLE001
        logger.exception(
            "brain.files: failed to publish change event for %s (%s)",
            path, kind,
        )


def _detect_mime(name: str) -> str:
    """Stable, browser-friendly mime types for the common workspace files."""
    lower = name.lower()
    if lower.endswith(".md") or lower.endswith(".markdown"):
        return "text/markdown"
    if lower.endswith(".yaml") or lower.endswith(".yml"):
        return "application/x-yaml"
    if lower.endswith(".json"):
        return "application/json"
    if lower.endswith(".jsonl"):
        return "application/x-ndjson"
    if lower.endswith(".log"):
        return "text/plain"
    guess, _ = mimetypes.guess_type(name)
    return guess or "text/plain"


# ─── endpoints ────────────────────────────────────────────────────────


@router.get(
    "/service-proxy/{proxy_id}/files",
    response_model=FileTreeResponse,
    summary="List the brain's workspace + bundled-workflows tree (merged)",
)
def list_brain_files(
    proxy_id: str,
    _: Any = Depends(_auth_deps.require_role(_USER_ROLES)),
) -> FileTreeResponse:
    workspace_dir, bundled_dir = _resolve_brain_roots(proxy_id)
    entries = _build_tree(workspace_dir, bundled_dir)
    return FileTreeResponse(
        proxy_id=proxy_id,
        workspace_dir=str(workspace_dir),
        bundled_dir=str(bundled_dir) if bundled_dir else None,
        entries=entries,
    )


@router.get(
    "/service-proxy/{proxy_id}/files/content",
    response_model=FileContentResponse,
    summary="Read one file from the brain workspace or bundled workflows",
)
def get_brain_file_content(
    proxy_id: str,
    path: str = Query(..., description="Virtual path under the brain root."),
    source: Optional[Literal["workspace", "bundled"]] = Query(
        None,
        description="Force which root to read from. Default: workspace wins.",
    ),
    _: Any = Depends(_auth_deps.require_role(_USER_ROLES)),
) -> FileContentResponse:
    workspace_dir, bundled_dir = _resolve_brain_roots(proxy_id)
    real_path, resolved_source = _resolve_content_file(
        path, workspace_dir, bundled_dir, source,
    )
    try:
        raw = real_path.read_bytes()
    except OSError as exc:
        raise HTTPException(500, f"read failed: {exc}")
    # Friendly text-only: ensure UTF-8 + no NUL bytes. Stone A is
    # markdown/yaml/text; binaries return 415 so the UI shows a clean
    # "binary file — open externally" notice rather than rendering bytes.
    if b"\x00" in raw[:8192]:
        raise HTTPException(415, "binary content — viewer is text-only in stone A")
    try:
        content = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(415, "non-utf8 content — viewer is utf-8-only in stone A")
    stat = real_path.stat()
    return FileContentResponse(
        proxy_id=proxy_id,
        path=path,
        source=resolved_source,
        content=content,
        mtime=stat.st_mtime,
        size=stat.st_size,
        writable=(resolved_source == "workspace"),
        mime=_detect_mime(real_path.name),
    )


# ─── pre-save validation ──────────────────────────────────────────────


def _validate_workflow_yaml(text: str) -> Optional[str]:
    """Return an error message string if the text isn't a valid
    workflow.yaml shape, or None if OK."""
    import yaml as _yaml
    try:
        data = _yaml.safe_load(text)
    except _yaml.YAMLError as exc:
        return f"yaml parse error: {exc}"
    if not isinstance(data, dict):
        return "workflow.yaml must be a yaml mapping at the top level"
    if "name" in data and not isinstance(data["name"], str):
        return "name field must be a string"
    if "steps" in data and not isinstance(data["steps"], list):
        return "steps field must be a list"
    if "inputs" in data and not isinstance(data["inputs"], (dict, type(None))):
        return "inputs field must be a mapping (dict)"
    return None


def _validate_allowed_tools_yaml(text: str) -> Optional[str]:
    import yaml as _yaml
    try:
        data = _yaml.safe_load(text)
    except _yaml.YAMLError as exc:
        return f"yaml parse error: {exc}"
    if not isinstance(data, dict):
        return "allowed_tools.yaml must be a yaml mapping at the top level"
    for key in ("allowed", "blocked"):
        v = data.get(key)
        if v is not None and not isinstance(v, list):
            return f"{key} must be a list"
    return None


def _pre_save_check(real_path: Path, content: str) -> None:
    """Per-file validation hook. Raises HTTPException(400) on a
    detectable problem. Only structural — semantic checks (does this
    workflow reference a real type? do the topics resolve?) live in
    the workflow loader itself, not here."""
    if "\x00" in content:
        raise HTTPException(400, "content contains NUL byte")
    # UTF-8 round-trip — Pydantic already gave us a str, this catches
    # invalid sequences that snuck in via some other path (paranoia).
    try:
        content.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise HTTPException(400, f"content not encodable as utf-8: {exc}")

    name = real_path.name
    if name == "workflow.yaml":
        err = _validate_workflow_yaml(content)
        if err:
            raise HTTPException(400, f"workflow.yaml: {err}")
    elif name == "allowed_tools.yaml":
        err = _validate_allowed_tools_yaml(content)
        if err:
            raise HTTPException(400, f"allowed_tools.yaml: {err}")
    elif name.endswith(".yml") or name.endswith(".yaml"):
        import yaml as _yaml
        try:
            _yaml.safe_load(content)
        except _yaml.YAMLError as exc:
            raise HTTPException(400, f"yaml parse error: {exc}")


# ─── write endpoint ───────────────────────────────────────────────────


@router.put(
    "/service-proxy/{proxy_id}/files/content",
    response_model=PutFileResponse,
    summary="Write a file in the brain workspace (stone C: editable mode)",
)
def put_brain_file_content(
    proxy_id: str,
    body: PutFileRequest,
    path: str = Query(..., description="Virtual workspace path."),
    _: Any = Depends(_auth_deps.require_role(_ADMIN_ROLES)),
) -> PutFileResponse:
    """Write to the workspace. Bundled files are read-only by design —
    the operator's edit lands as a workspace override that shadows the
    bundled copy at runtime (matches what stone D's Fork action does
    when copying the whole folder).

    Conflict handling: pass ``expected_mtime`` from the most recent
    GET. If disk has moved since (another tab, the brain itself
    writing to memory/, an external editor) the save returns 409 with
    the on-disk content so the UI can render a merge dialog.
    """
    workspace_dir, _bundled = _resolve_brain_roots(proxy_id)
    real_path = _safe_resolve(workspace_dir, path)

    # mtime conflict check. Skipped if the file doesn't exist yet
    # (first write of a new file) or the caller didn't supply mtime
    # (explicit force-overwrite path post-conflict).
    if body.expected_mtime is not None and real_path.is_file():
        actual = real_path.stat().st_mtime
        # Filesystem mtime resolution varies; we tolerate a tiny float
        # delta to avoid false positives on the round-trip.
        if abs(actual - body.expected_mtime) > 0.001:
            try:
                actual_content = real_path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                actual_content = ""
            from fastapi.responses import JSONResponse
            return JSONResponse(  # type: ignore[return-value]
                status_code=409,
                content=ConflictResponse(
                    error="mtime_conflict",
                    expected_mtime=body.expected_mtime,
                    actual_mtime=actual,
                    actual_content=actual_content,
                ).model_dump(),
            )

    _pre_save_check(real_path, body.content)

    existed_before = real_path.is_file()

    # Atomic write — tmp file in same dir + rename. Same pattern as
    # config_sets.save_proxy_yml: ensures a half-written file never
    # appears at the final path.
    real_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = real_path.with_suffix(real_path.suffix + ".tmp")
    try:
        tmp.write_text(body.content, encoding="utf-8")
        tmp.rename(real_path)
    except OSError as exc:
        raise HTTPException(500, f"write failed: {exc}")
    stat = real_path.stat()
    _publish_file_change(
        proxy_id, path,
        "modified" if existed_before else "created",
        mtime=stat.st_mtime,
    )
    return PutFileResponse(
        proxy_id=proxy_id, path=path, written=True,
        mtime=stat.st_mtime, size=stat.st_size,
    )


# ─── fork (stone D) ───────────────────────────────────────────────────


@router.post(
    "/service-proxy/{proxy_id}/files/fork",
    response_model=ForkResponse,
    summary="Copy a bundled workflow directory into the workspace",
)
def fork_brain_workflow(
    proxy_id: str,
    body: ForkRequest,
    _: Any = Depends(_auth_deps.require_role(_ADMIN_ROLES)),
) -> ForkResponse:
    """Copy a bundled workflow into the operator's workspace so they
    can edit it. After fork, the local copy shadows the bundled
    original at runtime (matches what ``brain.context_loader``
    already does).

    Rules:
      * ``source_path`` must resolve to a directory under bundled
        workflows. Single-file forks aren't supported in stone D — the
        sibling files form a coherent workflow.
      * Refuses if the workspace already has a workflow at the same
        path (no auto-overwrite — the operator must rename or delete
        the existing local copy first).
    """
    workspace_dir, bundled_workflows = _resolve_brain_roots(proxy_id)
    if bundled_workflows is None:
        raise HTTPException(404, "this brain has no bundled workflows directory")

    # Parse the source_path. Accept either ``workflows/<name>`` or
    # ``workflows/<name>/<some_file>`` (we normalize to the workflow
    # directory either way — forking a single file would orphan its
    # siblings).
    raw_parts = [p for p in body.source_path.replace("\\", "/").split("/") if p]
    if any(p in (".", "..") for p in raw_parts):
        raise HTTPException(400, "path traversal is not allowed")
    if len(raw_parts) < 2 or raw_parts[0] != "workflows":
        raise HTTPException(
            400,
            "source_path must be under workflows/ "
            "(e.g. workflows/observe_room)",
        )
    workflow_name = raw_parts[1]

    src = _safe_resolve(bundled_workflows, workflow_name)
    if not src.is_dir():
        raise HTTPException(404, f"bundled workflow not found: {workflow_name}")

    dst = workspace_dir / "workflows" / workflow_name
    if dst.exists():
        raise HTTPException(
            409,
            f"workspace already has a workflow at workflows/{workflow_name}. "
            f"Delete or rename the existing copy first.",
        )

    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copytree(src, dst, symlinks=False)
    except OSError as exc:
        raise HTTPException(500, f"copy failed: {exc}")

    # Enumerate what we copied for the caller (the UI shows a list in
    # the success dialog).
    files: List[str] = []
    for path in sorted(dst.rglob("*")):
        if path.is_file():
            try:
                files.append(str(path.relative_to(workspace_dir)))
            except ValueError:
                continue

    logger.info(
        "brain.fork: %s → %s (%d files)",
        src, dst, len(files),
    )
    # Emit one "created" event for the workflow dir — saves the UI
    # from coalescing N per-file events into a single tree refresh.
    _publish_file_change(proxy_id, f"workflows/{workflow_name}", "created")
    return ForkResponse(
        proxy_id=proxy_id,
        source_path=body.source_path,
        dest_path=f"workflows/{workflow_name}",
        files=files,
    )


class DuplicateRequest(BaseModel):
    """Duplicate a WORKSPACE workflow directory under a new name
    (``workflows/<src>`` → ``workflows/<dest>``). Both stay in the
    workspace — unlike fork, which copies a bundled original in."""
    source_path: str
    dest_name: str


@router.post(
    "/service-proxy/{proxy_id}/files/duplicate",
    response_model=ForkResponse,
    summary="Duplicate a workspace workflow directory under a new name",
)
def duplicate_brain_workflow(
    proxy_id: str,
    body: DuplicateRequest,
    _: Any = Depends(_auth_deps.require_role(_ADMIN_ROLES)),
) -> ForkResponse:
    """Copy a workflow to a NEW name in the workspace. The source may be
    an existing workspace workflow OR a bundled example — both produce an
    independent, editable workspace copy. Refuses if the destination
    already exists (never overwrites)."""
    workspace_dir, bundled_workflows = _resolve_brain_roots(proxy_id)

    # Source — normalize to the workflow dir (accept a file within it too).
    raw_parts = [p for p in body.source_path.replace("\\", "/").split("/") if p]
    if any(p in (".", "..") for p in raw_parts):
        raise HTTPException(400, "path traversal is not allowed")
    if len(raw_parts) < 2 or raw_parts[0] != "workflows":
        raise HTTPException(400, "source_path must be under workflows/ (e.g. workflows/my_flow)")
    src_name = raw_parts[1]
    # Workspace first, then fall back to bundled examples — so duplicating
    # an example produces a workspace copy under the new name.
    src = _safe_resolve(workspace_dir, f"workflows/{src_name}")
    if not src.is_dir() and bundled_workflows is not None:
        cand = _safe_resolve(bundled_workflows, src_name)
        if cand.is_dir():
            src = cand
    if not src.is_dir():
        raise HTTPException(404, f"workflow not found: {src_name}")

    # Dest — a bare workflow name (no slashes / traversal).
    dest_name = (body.dest_name or "").strip()
    if not dest_name or "/" in dest_name or "\\" in dest_name or dest_name in (".", ".."):
        raise HTTPException(400, "dest_name must be a single workflow name (no slashes)")
    dst = _safe_resolve(workspace_dir, f"workflows/{dest_name}")   # also enforces in-root
    if dst.exists():
        raise HTTPException(409, f"workspace already has a workflow at workflows/{dest_name}")

    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copytree(src, dst, symlinks=False)
    except OSError as exc:
        raise HTTPException(500, f"copy failed: {exc}")

    # No need to rewrite any name field: a workflow's identity IS its
    # directory name (context_loader derives it from the dir, ignoring
    # any yaml ``name:``), so the copy is named ``dest_name`` purely by
    # virtue of its folder.
    files: List[str] = []
    for path in sorted(dst.rglob("*")):
        if path.is_file():
            try:
                files.append(str(path.relative_to(workspace_dir)))
            except ValueError:
                continue

    logger.info("brain.duplicate: %s → %s (%d files)", src, dst, len(files))
    _publish_file_change(proxy_id, f"workflows/{dest_name}", "created")
    return ForkResponse(
        proxy_id=proxy_id,
        source_path=body.source_path,
        dest_path=f"workflows/{dest_name}",
        files=files,
    )


# ─── new-workflow scaffold (stone E) ──────────────────────────────────

# Lowercase, start with letter, underscores OK. Matches the convention
# of every bundled workflow (observe_room, inspect_object, etc.).
_WORKFLOW_NAME_RE = re.compile(r"^[a-z][a-z0-9_]*$")


# Templates for the five canonical workflow files. Kept compact + safe
# by default — the new workflow uses the mock adapter so it can be
# started immediately without an LLM backend configured. The blocked
# motion list is the standard safety baseline.

_TPL_WORKFLOW_YAML = """name: {name}
description: |
  A new workflow. Edit prompt.md to describe what the brain should
  do; edit allowed_tools.yaml to grant access to the tools it needs.

model: mock
max_steps: 8
timeout_seconds: 120
requires_human_approval: false

inputs: {{}}

steps:
  - id: default
    prompt: prompt.md
    on_success: success.md
    on_failure: failure.md

context:
  - memory/observations.md
"""

_TPL_PROMPT_MD = """You are an operator-authored workflow. Describe what the brain
should do step by step. Use the tools listed in allowed_tools.yaml.

Emit `done` when the task is complete.
"""

_TPL_ALLOWED_TOOLS_YAML = """# Allowlist of tool calls this workflow may make. Topic patterns use
# `*` for one path segment. Add specific actions the workflow needs.
# Default-deny — nothing is allowed unless listed here.
allowed: []

# Blocklist for safety. Even if a topic matches `allowed`, an entry
# here will block it (blocked wins ties).
blocked:
  - topic: /movement/*/control
    actions: ["*"]
"""

_TPL_SUCCESS_MD = """The workflow completed successfully.
"""

_TPL_FAILURE_MD = """The workflow did not complete. Check the step log for details.
"""


@router.post(
    "/service-proxy/{proxy_id}/files/new-workflow",
    response_model=NewWorkflowResponse,
    summary="Scaffold a new workflow with the five canonical files",
)
def new_workflow(
    proxy_id: str,
    body: NewWorkflowRequest,
    _: Any = Depends(_auth_deps.require_role(_ADMIN_ROLES)),
) -> NewWorkflowResponse:
    name = body.name.strip()
    if not _WORKFLOW_NAME_RE.match(name):
        raise HTTPException(
            400,
            "workflow name must be lowercase, start with a letter, and use "
            "only letters, digits, and underscores (e.g. my_workflow)",
        )
    workspace_dir, _bundled = _resolve_brain_roots(proxy_id)
    dest_dir = workspace_dir / "workflows" / name
    if dest_dir.exists():
        raise HTTPException(
            409,
            f"workflows/{name} already exists in the workspace. "
            f"Choose a different name or delete the existing one first.",
        )

    dest_dir.mkdir(parents=True, exist_ok=False)
    files = []
    templates = {
        "workflow.yaml": _TPL_WORKFLOW_YAML.format(name=name),
        "prompt.md": _TPL_PROMPT_MD,
        "allowed_tools.yaml": _TPL_ALLOWED_TOOLS_YAML,
        "success.md": _TPL_SUCCESS_MD,
        "failure.md": _TPL_FAILURE_MD,
    }
    for filename, content in templates.items():
        (dest_dir / filename).write_text(content, encoding="utf-8")
        files.append(f"workflows/{name}/{filename}")

    logger.info("brain.new_workflow: scaffolded %s (%d files)", dest_dir, len(files))
    _publish_file_change(proxy_id, f"workflows/{name}", "created")
    return NewWorkflowResponse(
        proxy_id=proxy_id,
        name=name,
        dest_path=f"workflows/{name}",
        files=files,
    )


# ─── rename (stone E) ─────────────────────────────────────────────────


@router.post(
    "/service-proxy/{proxy_id}/files/rename",
    response_model=RenameResponse,
    summary="Rename or move a file/directory within the workspace",
)
def rename_file(
    proxy_id: str,
    body: RenameRequest,
    _: Any = Depends(_auth_deps.require_role(_ADMIN_ROLES)),
) -> RenameResponse:
    workspace_dir, _bundled = _resolve_brain_roots(proxy_id)
    src = _safe_resolve(workspace_dir, body.from_path)
    dst = _safe_resolve(workspace_dir, body.to_path)
    if not src.exists():
        raise HTTPException(404, f"source not found: {body.from_path}")
    if dst.exists():
        raise HTTPException(409, f"target already exists: {body.to_path}")
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        src.rename(dst)
    except OSError as exc:
        raise HTTPException(500, f"rename failed: {exc}")
    logger.info("brain.rename: %s → %s", src, dst)
    # Rename is delete + create from the UI's perspective.
    _publish_file_change(proxy_id, body.from_path, "deleted")
    _publish_file_change(proxy_id, body.to_path, "created")
    return RenameResponse(
        proxy_id=proxy_id,
        from_path=body.from_path,
        to_path=body.to_path,
    )


# ─── delete (stone E) ─────────────────────────────────────────────────


@router.delete(
    "/service-proxy/{proxy_id}/files/content",
    response_model=DeleteResponse,
    summary="Delete a file or directory in the workspace",
)
def delete_file(
    proxy_id: str,
    path: str = Query(..., description="Virtual workspace path."),
    recursive: bool = Query(
        False,
        description=(
            "Required for non-empty directories. Operators set this "
            "after a confirm dialog so silent deep deletes can't happen."
        ),
    ),
    _: Any = Depends(_auth_deps.require_role(_ADMIN_ROLES)),
) -> DeleteResponse:
    """Delete a workspace path. Workspace-only by construction — the
    resolver uses ``workspace_dir`` as the root so bundled paths are
    physically unreachable here. Bundled workflows that have been
    forked still live under workspace and can be deleted normally."""
    workspace_dir, _bundled = _resolve_brain_roots(proxy_id)
    real = _safe_resolve(workspace_dir, path)
    if not real.exists():
        raise HTTPException(404, f"not found: {path}")
    count = 0
    if real.is_dir():
        # Try rmdir first — that's the safe path. If non-empty, only
        # proceed when the caller explicitly opted in via recursive.
        try:
            real.rmdir()
            count = 1
        except OSError:
            if not recursive:
                raise HTTPException(
                    409,
                    f"directory not empty: {path}. "
                    f"Pass recursive=true to delete its contents.",
                )
            # Count files first so the response is honest about what
            # got removed.
            count = sum(1 for p in real.rglob("*") if p.is_file())
            shutil.rmtree(real)
    else:
        real.unlink()
        count = 1
    logger.info("brain.delete: %s (%d files)", real, count)
    # One event for the path (file or dir root) — the UI doesn't need
    # per-file events when an entire subtree is gone.
    _publish_file_change(proxy_id, path, "deleted")
    return DeleteResponse(proxy_id=proxy_id, path=path, deleted_files=count)
