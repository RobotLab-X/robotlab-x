"""Convert a robot description (URDF, or xacro) into an ik_solver chain.

Pure, bus-agnostic functions so they're trivially unit-testable:

    expand_to_urdf(source, pkgmap)   .xacro → flat URDF xml (or read .urdf)
    parse_urdf(xml)                  → (links, joints)
    extract_chain(joints, base, tip) → ordered base→tip joint list
    chain_to_ik_model(chain, name)   → ik_solver model + rich chain + warnings

Conventions / unit handling:
  * URDF is metres + radians; the ik_solver is millimetres + degrees.
    Link lengths are emitted in mm, joint limits in degrees.
  * A "link length" is the straight-line distance between two consecutive
    ACTUATED joint origins at the home pose, computed by composing the
    fixed origin transforms (xyz + rpy) down the chain. This is exactly the
    scalar the current ik_solver planar model wants.
  * The RICH chain (per-joint origin xyz/rpy + axis + limits) is the
    forward-looking artifact for a general 3-D solver; the flat
    joints/links payload is a planar APPROXIMATION for today's solver and
    is flagged as such in ``warnings`` whenever the geometry isn't planar.
"""
from __future__ import annotations

import math
import os
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import numpy as np

_ACTUATED = ("revolute", "continuous", "prismatic")


@dataclass
class Joint:
    name: str
    jtype: str
    parent: str
    child: str
    xyz: np.ndarray              # origin translation (metres), parent frame
    rpy: np.ndarray              # origin rotation (radians), fixed-axis RPY
    axis: np.ndarray             # joint axis (unit-ish), child frame
    lower: Optional[float] = None  # radians (revolute/prismatic); None otherwise
    upper: Optional[float] = None


# ─── expansion ────────────────────────────────────────────────────────

def expand_to_urdf(source: str, pkgmap: Optional[Dict[str, str]] = None) -> str:
    """Return flat URDF XML for ``source``.

    ``.urdf`` files are read verbatim. ``.xacro`` (or anything else) is run
    through xacro with the ``$(find)`` shim installed from ``pkgmap`` so no
    sourced ROS workspace is needed. Raises on a missing file or an xacro
    error (the message is surfaced to the caller)."""
    if not os.path.isfile(source):
        raise FileNotFoundError(f"source not found: {source}")
    if source.endswith(".urdf"):
        with open(source, "r") as f:
            return f.read()
    # Defer importing xacro/the shim so a plain .urdf path needs neither.
    from .pkg_resolver import install_ament_shim
    install_ament_shim(pkgmap or {})
    import xacro  # noqa: WPS433 — intentional lazy import
    doc = xacro.process_file(source)
    return doc.toprettyxml(indent="  ")


# ─── parsing ──────────────────────────────────────────────────────────

def _vec3(text: Optional[str], default: Tuple[float, float, float]) -> np.ndarray:
    if not text or not text.strip():
        return np.array(default, dtype=float)
    parts = [float(x) for x in text.split()]
    return np.array(parts, dtype=float)


def parse_urdf(xml: str) -> Tuple[List[str], List[Joint]]:
    """Parse URDF XML into (link names, Joints). Tolerant of missing
    origin/axis/limit blocks (URDF defaults applied)."""
    root = ET.fromstring(xml)
    links = [l.get("name") for l in root.findall("link") if l.get("name")]
    joints: List[Joint] = []
    for j in root.findall("joint"):
        name = j.get("name") or ""
        jtype = j.get("type") or "fixed"
        parent = (j.find("parent") is not None and j.find("parent").get("link")) or ""
        child = (j.find("child") is not None and j.find("child").get("link")) or ""
        origin = j.find("origin")
        xyz = _vec3(origin.get("xyz") if origin is not None else None, (0, 0, 0))
        rpy = _vec3(origin.get("rpy") if origin is not None else None, (0, 0, 0))
        axis_el = j.find("axis")
        axis = _vec3(axis_el.get("xyz") if axis_el is not None else None, (1, 0, 0))
        lower = upper = None
        lim = j.find("limit")
        if lim is not None:
            lo, hi = lim.get("lower"), lim.get("upper")
            lower = float(lo) if lo is not None else None
            upper = float(hi) if hi is not None else None
        joints.append(Joint(name, jtype, parent, child, xyz, rpy, axis, lower, upper))
    return links, joints


# ─── chain walking ────────────────────────────────────────────────────

def extract_chain(joints: List[Joint], base_link: str, tip_link: str) -> List[Joint]:
    """Ordered joints from ``base_link`` down to ``tip_link`` (inclusive of
    every joint whose child is on the path). Raises if no path exists."""
    by_child: Dict[str, Joint] = {j.child: j for j in joints}
    rev: List[Joint] = []
    link = tip_link
    seen = set()
    while link in by_child:
        if link in seen:
            raise ValueError(f"cycle detected at link {link!r}")
        seen.add(link)
        j = by_child[link]
        rev.append(j)
        if j.parent == base_link:
            break
        link = j.parent
    else:
        raise ValueError(f"no joint produces tip link {tip_link!r}")
    if rev[-1].parent != base_link:
        raise ValueError(
            f"chain from {tip_link!r} reaches {rev[-1].parent!r}, not base {base_link!r}"
        )
    return list(reversed(rev))


# ─── transforms ───────────────────────────────────────────────────────

def _rpy_to_matrix(rpy: np.ndarray) -> np.ndarray:
    """Fixed-axis RPY (URDF convention) → 3×3 rotation: R = Rz·Ry·Rx."""
    r, p, y = rpy
    cx, sx = math.cos(r), math.sin(r)
    cy, sy = math.cos(p), math.sin(p)
    cz, sz = math.cos(y), math.sin(y)
    rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return rz @ ry @ rx


def _origin_tf(j: Joint) -> np.ndarray:
    t = np.eye(4)
    t[:3, :3] = _rpy_to_matrix(j.rpy)
    t[:3, 3] = j.xyz
    return t


def _home_positions(chain: List[Joint]) -> List[np.ndarray]:
    """World-frame origin of each joint at the home pose (all angles 0),
    by composing the fixed origin transforms down the chain."""
    tf = np.eye(4)
    out: List[np.ndarray] = []
    for j in chain:
        tf = tf @ _origin_tf(j)
        out.append(tf[:3, 3].copy())
    return out


# ─── projection to ik_solver model ──────────────────────────────────────

@dataclass
class IkExport:
    name: str
    joints: List[dict] = field(default_factory=list)        # ik_solver JointSpec
    links: List[dict] = field(default_factory=list)         # ik_solver LinkSpec
    calibration: List[dict] = field(default_factory=list)   # ik_solver JointCalibration stub
    chain: List[dict] = field(default_factory=list)          # RICH per-joint records
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        """Emit the ik_solver Model Library schema (schema_version 1) so an
        export drops straight into the library. ``calibration`` is the
        portable template (servo bindings stay per-rig, added on load).
        ``warnings`` is extra context the ik_solver ignores on load."""
        return {
            "schema_version": 1,
            "id": self.name,
            "title": self.name.replace("_", " ").title(),
            "source": "ROS URDF -> ros.convert",
            "units": {"length": "mm", "angle": "deg"},
            "ik_model": {"joints": self.joints, "links": self.links},
            "chain": self.chain,
            "calibration_template": self.calibration,
            "poses": [],
            "warnings": self.warnings,
        }


def _deg(rad: Optional[float]) -> Optional[float]:
    return None if rad is None else math.degrees(rad)


def chain_to_ik_model(chain: List[Joint], name: str) -> IkExport:
    """Project a base→tip joint chain into an ik_solver export bundle."""
    exp = IkExport(name=name)
    positions = _home_positions(chain)

    actuated_idx = [i for i, j in enumerate(chain) if j.jtype in _ACTUATED]
    if not actuated_idx:
        exp.warnings.append("chain has no actuated joints — nothing to solve")
        return exp

    # Rich per-joint records (every joint, incl. fixed — full fidelity).
    for i, j in enumerate(chain):
        lo, hi = _deg(j.lower), _deg(j.upper)
        mn = mx = None
        if lo is not None and hi is not None:
            mn, mx = (lo, hi) if lo <= hi else (hi, lo)  # URDF sometimes stores lower>upper
        exp.chain.append({
            "name": j.name,
            "type": j.jtype,
            "parent": j.parent,
            "child": j.child,
            "origin_xyz_m": [round(float(v), 6) for v in j.xyz],
            "origin_rpy_rad": [round(float(v), 6) for v in j.rpy],
            "axis": [round(float(v), 4) for v in j.axis],
            "lower_deg": None if mn is None else round(mn, 3),
            "upper_deg": None if mx is None else round(mx, 3),
            "home_pos_mm": [round(float(v) * 1000.0, 2) for v in positions[i]],
        })

    # Flat ik_solver model (planar APPROXIMATION) over actuated joints only.
    for idx in actuated_idx:
        j = chain[idx]
        lo, hi = _deg(j.lower), _deg(j.upper)
        if lo is None or hi is None:
            mn, mx = -180.0, 180.0  # continuous / unlimited
        else:
            mn, mx = (lo, hi) if lo <= hi else (hi, lo)
        if j.jtype != "revolute":
            exp.warnings.append(
                f"joint {j.name!r} is {j.jtype}; ik_solver v1 supports revolute only"
            )
        exp.joints.append({
            "name": j.name,
            "type": "revolute",
            "min_deg": round(mn, 3),
            "max_deg": round(mx, 3),
        })
        exp.calibration.append({
            "joint": j.name,
            "servo_proxy_id": None,
            "zero_offset_deg": 0.0,
            "direction": 1,
            "scale": 1.0,
            "servo_min_deg": round(mn, 3),
            "servo_max_deg": round(mx, 3),
        })

    # Link lengths = home-pose distance between consecutive actuated origins.
    for a, b in zip(actuated_idx, actuated_idx[1:]):
        length_mm = float(np.linalg.norm(positions[b] - positions[a])) * 1000.0
        exp.links.append({"length_mm": round(length_mm, 2)})

    # Planarity check: warn when the actuated axes don't share one plane —
    # the flat model can't represent that faithfully (use the rich chain).
    axes = [chain[i].axis / (np.linalg.norm(chain[i].axis) or 1.0) for i in actuated_idx]
    distinct = {tuple(round(float(v), 2) for v in np.abs(a)) for a in axes}
    if len(distinct) > 1:
        exp.warnings.append(
            f"actuated joints rotate about {len(distinct)} distinct axes "
            f"{sorted(distinct)} — the flat joints/links model is a planar "
            "approximation; use the rich 'chain' with a general 3-D solver "
            "for accurate results."
        )
    if chain[actuated_idx[0]].name != "base":
        exp.warnings.append(
            "ik_solver expects the first joint named 'base'; first actuated "
            f"joint here is {chain[actuated_idx[0]].name!r} — rename on import "
            "or map in the solver config."
        )
    return exp
