"""Resolve xacro's ``$(find <pkg>)`` without a sourced ROS workspace.

xacro (ROS2 build) resolves ``$(find pkg)`` via
``ament_index_python.get_package_share_directory`` — which only works
inside an installed/sourced ament workspace. robotlab_x users importing a
robot description (e.g. a plain ``git clone`` of inmoov_ros) have no such
workspace, so we install a SHIM: scan a root directory for ``package.xml``
files, build a ``{package_name: dir}`` map, and inject a fake
``ament_index_python`` module that answers from that map.

Unknown packages (e.g. ``gazebo_ros`` referenced by sim-only includes the
caller doesn't care about) resolve to a throwaway stub path so expansion of
the kinematic parts doesn't crash on an unrelated reference.
"""
from __future__ import annotations

import logging
import os
import sys
import types
import xml.etree.ElementTree as ET
from typing import Dict

logger = logging.getLogger(__name__)

_STUB_PREFIX = "/tmp/_ros_missing_pkg"


def build_package_map(root: str) -> Dict[str, str]:
    """Scan ``root`` recursively for ``package.xml`` and return
    ``{declared_package_name: containing_dir}``. The declared ``<name>``
    is used (falling back to the directory name) so a renamed checkout dir
    still resolves by its real package name."""
    pkgmap: Dict[str, str] = {}
    if not root or not os.path.isdir(root):
        return pkgmap
    for dirpath, _dirs, files in os.walk(root):
        if "package.xml" not in files:
            continue
        pxml = os.path.join(dirpath, "package.xml")
        name = None
        try:
            name = (ET.parse(pxml).getroot().findtext("name") or "").strip()
        except Exception:  # noqa: BLE001 — malformed package.xml shouldn't abort the scan
            logger.warning("ros: could not parse %s", pxml)
        if not name:
            name = os.path.basename(dirpath)
        # First wins on duplicate names (shallower paths come first in walk).
        pkgmap.setdefault(name, dirpath)
    return pkgmap


def install_ament_shim(pkgmap: Dict[str, str]) -> None:
    """Inject a fake ``ament_index_python`` into ``sys.modules`` so xacro's
    ``$(find pkg)`` resolves from ``pkgmap``. Idempotent — the latest call's
    map wins. Safe no-op fields are provided for the bits xacro touches."""

    def get_package_share_directory(pkg: str) -> str:
        path = pkgmap.get(pkg)
        if path is not None:
            return path
        # Unknown package: hand back a stub dir rather than raising, so a
        # stray sim-only $(find gazebo_ros) doesn't kill a kinematics export.
        logger.info("ros: $(find %s) unresolved — using stub path", pkg)
        return os.path.join(_STUB_PREFIX, pkg)

    class PackageNotFoundError(Exception):
        pass

    mod = types.ModuleType("ament_index_python")
    pkgs = types.ModuleType("ament_index_python.packages")
    for m in (mod, pkgs):
        m.get_package_share_directory = get_package_share_directory  # type: ignore[attr-defined]
        m.PackageNotFoundError = PackageNotFoundError  # type: ignore[attr-defined]
    mod.packages = pkgs  # type: ignore[attr-defined]
    sys.modules["ament_index_python"] = mod
    sys.modules["ament_index_python.packages"] = pkgs
