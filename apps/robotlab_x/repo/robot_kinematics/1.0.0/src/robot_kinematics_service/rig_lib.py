"""Rig library — browse/load whole-body rigs (bundled + user).

Same two-root pattern as the ik_solver Model Library: bundled rigs ship in
``examples/`` inside the package (resolved via ``__file__``); user rigs live
at ``<data_dir>/robot_kinematics/rigs/`` (absolute data dir injected by the
backend as ``ROBOTLAB_X_DATA_DIR_ABS``). Pure pydantic + IO — no pinocchio —
so it's importable/testable without the solver deps.
"""
from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .rig import RigSpec

logger = logging.getLogger(__name__)
_ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")


def bundled_dir() -> Path:
    return Path(__file__).resolve().parent / "examples"


def user_dir() -> Optional[Path]:
    base = os.environ.get("ROBOTLAB_X_DATA_DIR_ABS", "").strip()
    return Path(base) / "robot_kinematics" / "rigs" if base else None


def _valid_id(rig_id: str) -> bool:
    return bool(rig_id) and bool(_ID_RE.match(rig_id))


def _read(path: Path) -> Optional[RigSpec]:
    try:
        data = json.loads(path.read_text())
        data.setdefault("rig_id", path.stem)
        return RigSpec(**data)
    except Exception:  # noqa: BLE001
        logger.warning("robot_kinematics: skipping unreadable rig %s", path)
        return None


def _scan(root: Optional[Path]) -> Dict[str, RigSpec]:
    out: Dict[str, RigSpec] = {}
    if not root or not root.is_dir():
        return out
    for p in sorted(root.glob("*.json")):
        r = _read(p)
        if r is not None:
            out[r.rig_id] = r
    return out


def list_rigs() -> List[Dict[str, Any]]:
    bundled, user = _scan(bundled_dir()), _scan(user_dir())
    rows: List[Dict[str, Any]] = []
    for root_name, rigs in (("bundled", bundled), ("user", user)):
        for rid, r in rigs.items():
            if root_name == "bundled" and rid in user:
                continue
            rows.append({
                "rig_id": r.rig_id,
                "title": r.title or r.rig_id,
                "source": r.source,
                "root": root_name,
                "end_effectors": [e.name for e in r.end_effectors],
            })
    rows.sort(key=lambda r: (r["root"] != "bundled", r["title"].lower()))
    return rows


def _rig_path(rig_id: str) -> Optional[Tuple[Path, str]]:
    """Return (json_path, root_name) for a rig id — user wins, then bundled."""
    u = user_dir()
    if u is not None and (u / f"{rig_id}.json").is_file():
        return u / f"{rig_id}.json", "user"
    b = bundled_dir() / f"{rig_id}.json"
    if b.is_file():
        return b, "bundled"
    return None


def load(rig_id: str) -> Tuple[RigSpec, str]:
    """Load a rig and resolve its URDF to an absolute path. ``rig.urdf`` is
    resolved beside the rig file when relative. Raises FileNotFoundError."""
    if not _valid_id(rig_id):
        raise ValueError(f"invalid rig id {rig_id!r}")
    found = _rig_path(rig_id)
    if found is None:
        raise FileNotFoundError(f"rig {rig_id!r} not found")
    path, _root = found
    rig = _read(path)
    if rig is None:
        raise FileNotFoundError(f"rig {rig_id!r} unreadable")
    urdf = rig.urdf
    urdf_abs = urdf if os.path.isabs(urdf) else str((path.parent / urdf).resolve())
    return rig, urdf_abs


def save(rig: RigSpec) -> Path:
    if not _valid_id(rig.rig_id):
        raise ValueError(f"invalid rig id {rig.rig_id!r}")
    u = user_dir()
    if u is None:
        raise RuntimeError("no writable rig dir (ROBOTLAB_X_DATA_DIR_ABS unset)")
    u.mkdir(parents=True, exist_ok=True)
    path = u / f"{rig.rig_id}.json"
    path.write_text(json.dumps(rig.model_dump(), indent=2))
    return path


def delete(rig_id: str) -> bool:
    if not _valid_id(rig_id):
        raise ValueError(f"invalid rig id {rig_id!r}")
    u = user_dir()
    if u is None:
        return False
    path = u / f"{rig_id}.json"
    if path.is_file():
        path.unlink()
        return True
    return False
