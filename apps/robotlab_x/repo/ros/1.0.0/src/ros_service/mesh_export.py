"""Bake a robot's URDF *visual* meshes into a single web-ready GLB.

For "skinning" the IK skeleton in the browser: each link's visual meshes
are loaded, scaled, moved into the link-LOCAL frame (visual origin
applied to the vertices), decimated, and emitted as one GLB node named
after the link. The viewer loads the GLB once and drives each link node
by the live world pose the solver publishes — rigid skinning, exactly
right for a rigid robot.

Pure trimesh + ElementTree (no ROS). Mesh paths (``package://pkg/...``)
resolve through the same package.xml scan as xacro's ``$(find)``.
"""
from __future__ import annotations

import logging
import math
import os
import xml.etree.ElementTree as ET
from typing import Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)


def _vec3(text: Optional[str], default: Tuple[float, float, float]) -> np.ndarray:
    if not text or not text.strip():
        return np.array(default, dtype=float)
    return np.array([float(x) for x in text.split()], dtype=float)


def _rpy_matrix(rpy: np.ndarray) -> np.ndarray:
    r, p, y = rpy
    cx, sx = math.cos(r), math.sin(r); cy, sy = math.cos(p), math.sin(p); cz, sz = math.cos(y), math.sin(y)
    rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return rz @ ry @ rx


def _origin_tf(xyz: np.ndarray, rpy: np.ndarray) -> np.ndarray:
    t = np.eye(4); t[:3, :3] = _rpy_matrix(rpy); t[:3, 3] = xyz
    return t


def _resolve_mesh(uri: str, pkgmap: Dict[str, str]) -> Optional[str]:
    """``package://pkg/rest`` → ``<pkgdir>/rest``; bare/relative/file paths
    pass through. Returns None if a package can't be resolved."""
    if uri.startswith("package://"):
        rest = uri[len("package://"):]
        pkg, _, tail = rest.partition("/")
        base = pkgmap.get(pkg)
        if base is None:
            logger.warning("mesh_export: unresolved package %r", pkg)
            return None
        return os.path.join(base, tail)
    if uri.startswith("file://"):
        return uri[len("file://"):]
    return uri


def _link_meshes(urdf_xml: str):
    """Yield (link_name, geometry_element, scale_vec, origin_tf) for each
    visual on each link."""
    root = ET.fromstring(urdf_xml)
    for link in root.findall("link"):
        name = link.get("name")
        for vis in link.findall("visual"):
            geom = vis.find("geometry")
            if geom is None:
                continue
            origin = vis.find("origin")
            oxyz = _vec3(origin.get("xyz") if origin is not None else None, (0, 0, 0))
            orpy = _vec3(origin.get("rpy") if origin is not None else None, (0, 0, 0))
            yield name, geom, oxyz, orpy


def _geom_to_mesh(geom: ET.Element, pkgmap: Dict[str, str]):
    """Build a trimesh from a URDF <geometry> child (mesh/box/cylinder/sphere)."""
    import trimesh

    mesh_el = geom.find("mesh")
    if mesh_el is not None:
        path = _resolve_mesh(mesh_el.get("filename", ""), pkgmap)
        if not path or not os.path.isfile(path):
            return None
        m = trimesh.load(path, force="mesh")
        scale = _vec3(mesh_el.get("scale"), (1, 1, 1))
        if not np.allclose(scale, 1.0):
            m.apply_scale(scale)
        return m
    box = geom.find("box")
    if box is not None:
        return trimesh.creation.box(extents=_vec3(box.get("size"), (0.1, 0.1, 0.1)))
    cyl = geom.find("cylinder")
    if cyl is not None:
        return trimesh.creation.cylinder(radius=float(cyl.get("radius", 0.05)),
                                          height=float(cyl.get("length", 0.1)))
    sph = geom.find("sphere")
    if sph is not None:
        return trimesh.creation.icosphere(radius=float(sph.get("radius", 0.05)))
    return None


def _decimate(mesh, target_faces: int):
    if target_faces <= 0 or len(mesh.faces) <= target_faces:
        return mesh
    try:
        return mesh.simplify_quadric_decimation(face_count=target_faces)
    except Exception:  # noqa: BLE001 — decimation backend optional; ship full mesh if absent
        logger.info("mesh_export: decimation unavailable; shipping full-res mesh")
        return mesh


def bake_glb(
    urdf_xml: str, pkgmap: Dict[str, str], out_path: str, target_faces: int = 2500,
) -> Dict[str, int]:
    """Bake the URDF's visuals into a node-per-link GLB at ``out_path``.
    Returns {link: face_count}. Each link's meshes are concatenated, moved
    into the link-local frame, and decimated to ~target_faces."""
    import trimesh

    by_link: Dict[str, list] = {}
    for link, geom, oxyz, orpy in _link_meshes(urdf_xml):
        m = _geom_to_mesh(geom, pkgmap)
        if m is None or m.is_empty:
            continue
        m.apply_transform(_origin_tf(oxyz, orpy))  # into link-local coords
        by_link.setdefault(link, []).append(m)

    scene = trimesh.Scene()
    faces: Dict[str, int] = {}
    for link, meshes in by_link.items():
        merged = trimesh.util.concatenate(meshes) if len(meshes) > 1 else meshes[0]
        merged = _decimate(merged, target_faces)
        scene.add_geometry(merged, node_name=link, geom_name=link)
        faces[link] = int(len(merged.faces))

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(scene.export(file_type="glb"))
    return faces
