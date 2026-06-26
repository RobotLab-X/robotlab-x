"""RosService — ROS/ROS2 bridge + robot-description toolbox.

Subprocess service. v1 exposes the URDF/xacro → ik_solver chain export
only; it holds no live ROS connection. Bus topics:

  /ros/{id}/state      retained — package map + last export summary
  /ros/{id}/control    incoming @service_method actions
  /ros/{id}/heartbeat  1Hz (base class)

Actions:
  scan_packages   (re)scan package_root for package.xml → {pkg: dir}
  list_chain      list links + actuated joints of a description (pick base/tip)
  convert         URDF/xacro + base/tip → ik_solver model + rich chain JSON
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional

from rlx_bus import ServiceConfig, SubprocessService, service_method

from .pkg_resolver import build_package_map
from .urdf_export import (
    chain_to_ik_model,
    expand_to_urdf,
    extract_chain,
    parse_urdf,
)

logger = logging.getLogger(__name__)


class RosConfig(ServiceConfig):
    """Persisted config — see package.yml wizard_config for field help."""
    package_root: str = ""   # scanned for package.xml so $(find) resolves
    output_dir: str = ""     # where expanded URDF / chain JSON is written ("" = bus only)


class RosService(SubprocessService):
    type_name = "ros"
    heartbeat_interval_s = 1.0
    config_class = RosConfig
    publishes = ["state"]

    def __init__(self, proxy_id: str, bus) -> None:
        super().__init__(proxy_id, bus)
        self._pkgmap: Dict[str, str] = {}
        self._last_export: Optional[Dict[str, Any]] = None

    # ─── lifecycle ───────────────────────────────────────────────────
    async def on_start(self) -> None:
        self._refresh_pkgmap()
        await self.publish_state()

    # ─── state ───────────────────────────────────────────────────────
    def _refresh_pkgmap(self) -> None:
        root = (self.config.package_root or "").strip()
        self._pkgmap = build_package_map(root) if root else {}
        if root and not self._pkgmap:
            logger.warning("ros %s: no package.xml found under %r", self.proxy_id, root)

    def _snapshot(self) -> Dict[str, Any]:
        return {
            "package_root": self.config.package_root or None,
            "output_dir": self.config.output_dir or None,
            "packages": dict(sorted(self._pkgmap.items())),
            "last_export": self._last_export,
        }

    async def publish_state(self) -> None:
        await self.publish("state", self._snapshot(), retained=True)

    def _maybe_write(self, filename: str, text: str) -> Optional[str]:
        """Write ``text`` to output_dir/filename when output_dir is set;
        return the path written (or None when bus-only)."""
        out = (self.config.output_dir or "").strip()
        if not out:
            return None
        out = os.path.expanduser(out)
        os.makedirs(out, exist_ok=True)
        path = os.path.join(out, filename)
        with open(path, "w") as f:
            f.write(text)
        return path

    # ─── actions ─────────────────────────────────────────────────────
    @service_method("scan_packages", publishes=["state"])
    async def m_scan_packages(self, package_root: Optional[str] = None) -> Dict[str, Any]:
        """Rescan for package.xml. Optionally update + persist package_root
        first, so xacro's $(find) resolves for subsequent calls."""
        if package_root is not None:
            await self.update_config({"package_root": str(package_root)})
        self._refresh_pkgmap()
        await self.publish_state()
        return {"package_root": self.config.package_root or None, "packages": self._pkgmap}

    @service_method("list_chain")
    async def m_list_chain(
        self,
        source: str,
        tip_link: str,
        base_link: str = "world",
    ) -> Dict[str, Any]:
        """Expand+parse ``source`` (a .urdf or .xacro path) and report the
        ordered base→tip chain — names, types, and which joints are
        actuated — so the operator can pick the right base/tip for convert."""
        urdf = expand_to_urdf(source, self._pkgmap)
        links, joints = parse_urdf(urdf)
        chain = extract_chain(joints, base_link, tip_link)
        return {
            "source": source,
            "base_link": base_link,
            "tip_link": tip_link,
            "link_count": len(links),
            "joint_count": len(joints),
            "chain": [
                {"name": j.name, "type": j.jtype, "parent": j.parent, "child": j.child}
                for j in chain
            ],
        }

    @service_method("bake_visual_glb", publishes=["state"])
    async def m_bake_visual_glb(
        self, source: str, out_path: str, target_faces: int = 2500,
    ) -> Dict[str, Any]:
        """Bake a robot's URDF/xacro visual meshes into a single node-per-link
        GLB at ``out_path`` (for the robot_kinematics 'skinned' 3-D viewer).
        Each link's meshes are scaled, moved into the link-local frame, and
        decimated. Returns per-link face counts."""
        from .mesh_export import bake_glb
        urdf = expand_to_urdf(source, self._pkgmap)
        faces = bake_glb(urdf, self._pkgmap, out_path, target_faces=int(target_faces))
        summary = {"out_path": out_path, "links": len(faces),
                   "total_faces": sum(faces.values())}
        self._last_export = {"glb": summary}
        await self.publish_state()
        return {**summary, "faces": faces}

    @service_method("convert", publishes=["state"], publish_return="last")
    async def m_convert(
        self,
        source: str,
        tip_link: str,
        base_link: str = "world",
        name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Convert a robot description into an ik_solver export bundle.

        ``source`` is a path to a .urdf or .xacro. Returns
        ``{name, ik_model:{joints,links}, calibration, chain, warnings, ...}``
        — feed ``ik_model`` to an ik_solver via its ``set_model`` action; the
        rich ``chain`` is the forward-looking artifact for a general 3-D
        solver. When ``output_dir`` is set, the flat URDF and the export JSON
        are also written there."""
        export_name = name or os.path.splitext(os.path.basename(source))[0]
        urdf = expand_to_urdf(source, self._pkgmap)
        urdf_path = self._maybe_write(f"{export_name}.urdf", urdf)
        _links, joints = parse_urdf(urdf)
        chain = extract_chain(joints, base_link, tip_link)
        export = chain_to_ik_model(chain, export_name).to_dict()
        export["source"] = source
        export["base_link"] = base_link
        export["tip_link"] = tip_link
        json_path = self._maybe_write(f"{export_name}.ik_chain.json",
                                      json.dumps(export, indent=2))
        summary = {
            "name": export_name,
            "joints": len(export["ik_model"]["joints"]),
            "links": len(export["ik_model"]["links"]),
            "warnings": export["warnings"],
            "urdf_path": urdf_path,
            "json_path": json_path,
        }
        self._last_export = summary
        await self.publish_state()
        return export
