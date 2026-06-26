"""Model Library — browse / load / save portable robot models.

A *model* is a portable JSON artifact (geometry + limits + named poses +
a calibration template, plus the rich kinematic ``chain`` for the future
3-D solver). Two roots, merged like brain's bundled+workspace pattern:

  * BUNDLED examples — ``<this package>/examples/*.json`` — ship inside the
    pip package, so an editable install resolves them via ``__file__`` on
    both dev and deploy regardless of where the source tree lives.
  * USER models — ``<data_dir>/ik_solver/models/*.json`` — writable, shared
    across every ik_solver instance, on the persistent data volume. The
    backend hands us the absolute data dir via ``ROBOTLAB_X_DATA_DIR_ABS``
    (the relative ``ROBOTLAB_X_DATA_DIR`` can't be resolved from the
    subprocess's cwd).

A user model shadows a bundled one with the same id (brain semantics).
This module is pure IO + schema; the service wires it to bus actions.
"""
from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1
_ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")  # safe filename / no traversal


# ─── schema ────────────────────────────────────────────────────────────

class Pose(BaseModel):
    """A named joint configuration (degrees, by joint name)."""
    name: str
    is_initial: bool = False
    angles: Dict[str, float] = Field(default_factory=dict)


class RobotModel(BaseModel):
    """Portable robot model. ``ik_model`` feeds today's planar solver;
    ``chain`` is carried verbatim for the future general 3-D solver."""
    model_config = {"protected_namespaces": ()}  # allow a field literally named model_*

    schema_version: int = SCHEMA_VERSION
    id: str
    title: str = ""
    description: str = ""
    source: str = ""
    units: Dict[str, str] = Field(default_factory=lambda: {"length": "mm", "angle": "deg"})
    ik_model: Dict[str, Any] = Field(default_factory=lambda: {"joints": [], "links": []})
    chain: List[Dict[str, Any]] = Field(default_factory=list)
    calibration_template: List[Dict[str, Any]] = Field(default_factory=list)
    poses: List[Pose] = Field(default_factory=list)

    def initial_pose(self) -> Optional[Pose]:
        for p in self.poses:
            if p.is_initial:
                return p
        return self.poses[0] if self.poses else None


# ─── roots ───────────────────────────────────────────────────────────

def bundled_dir() -> Path:
    """``examples/`` shipped inside this package (read-only)."""
    return Path(__file__).resolve().parent / "examples"


def user_dir() -> Optional[Path]:
    """Shared, writable user model dir under the absolute data dir, or
    None when the backend didn't hand one over (e.g. unit tests)."""
    base = os.environ.get("ROBOTLAB_X_DATA_DIR_ABS", "").strip()
    if not base:
        return None
    return Path(base) / "ik_solver" / "models"


# ─── helpers ───────────────────────────────────────────────────────────

def _valid_id(model_id: str) -> bool:
    return bool(model_id) and bool(_ID_RE.match(model_id))


def _read(path: Path) -> Optional[RobotModel]:
    try:
        data = json.loads(path.read_text())
        data.setdefault("id", path.stem)
        return RobotModel(**data)
    except Exception:  # noqa: BLE001 — a malformed file shouldn't break the whole list
        logger.warning("ik_solver: skipping unreadable model %s", path)
        return None


def _scan(root: Optional[Path]) -> Dict[str, RobotModel]:
    out: Dict[str, RobotModel] = {}
    if not root or not root.is_dir():
        return out
    for p in sorted(root.glob("*.json")):
        m = _read(p)
        if m is not None:
            out[m.id] = m
    return out


# ─── public API ─────────────────────────────────────────────────────────

def list_models() -> List[Dict[str, Any]]:
    """Merged catalog (user shadows bundled by id). One dict per model with
    just the browse-relevant fields; full bodies come from ``load``."""
    bundled = _scan(bundled_dir())
    user = _scan(user_dir())
    rows: List[Dict[str, Any]] = []
    for root_name, models in (("bundled", bundled), ("user", user)):
        for mid, m in models.items():
            if root_name == "bundled" and mid in user:
                continue  # shadowed by a user model of the same id
            rows.append({
                "id": m.id,
                "title": m.title or m.id,
                "source": m.source,
                "root": root_name,
                "joints": len((m.ik_model or {}).get("joints", [])),
                "pose_names": [p.name for p in m.poses],
            })
    rows.sort(key=lambda r: (r["root"] != "bundled", r["title"].lower()))
    return rows


def load(model_id: str) -> RobotModel:
    """Resolve a model by id — user root wins, then bundled. Raises
    FileNotFoundError if absent, ValueError on a bad id."""
    if not _valid_id(model_id):
        raise ValueError(f"invalid model id {model_id!r}")
    u = user_dir()
    if u is not None:
        p = u / f"{model_id}.json"
        if p.is_file():
            m = _read(p)
            if m is not None:
                return m
    p = bundled_dir() / f"{model_id}.json"
    if p.is_file():
        m = _read(p)
        if m is not None:
            return m
    raise FileNotFoundError(f"model {model_id!r} not found")


def save(model: RobotModel) -> Path:
    """Write ``model`` to the USER dir (the only writable root). Raises if
    no user dir is available or the id is unsafe."""
    if not _valid_id(model.id):
        raise ValueError(f"invalid model id {model.id!r}")
    u = user_dir()
    if u is None:
        raise RuntimeError("no writable model dir (ROBOTLAB_X_DATA_DIR_ABS unset)")
    u.mkdir(parents=True, exist_ok=True)
    path = u / f"{model.id}.json"
    path.write_text(json.dumps(model.model_dump(), indent=2))
    return path


def delete(model_id: str) -> bool:
    """Delete a USER model. Returns True if a file was removed. Bundled
    examples are read-only and never deleted."""
    if not _valid_id(model_id):
        raise ValueError(f"invalid model id {model_id!r}")
    u = user_dir()
    if u is None:
        return False
    path = u / f"{model_id}.json"
    if path.is_file():
        path.unlink()
        return True
    return False
