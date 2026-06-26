"""WebXRService — WebXR (Quest 3) teleop bridge.

Subprocess service. The immersive client (served as this service's
``xr.js`` bundle, opened in the headset browser) reads head + controller
poses each XRFrame and publishes them to ``/webxr/<id>/input``. This
service:

  * frame-converts (WebXR Y-up/m → robot Z-up/mm) + applies the recenter
    origin,
  * republishes normalized topics — ``/webxr/<id>/head``,
    ``/webxr/<id>/controller/{left,right}`` — for any actuator to consume,
  * runs the configured mapping table to drive actuators directly (e.g.
    right-controller ray → robot_kinematics ``set_target``),
  * owns the feed-panel / layout / mapping config and publishes it
    retained on ``/webxr/<id>/panels`` for the immersive client,
  * publishes ``/webxr/<id>/state`` for the desktop control panel.

Bus topics:
  /webxr/<id>/input       incoming — headset telemetry (head/controllers)
  /webxr/<id>/head        retained-ish — normalized head pose (robot frame)
  /webxr/<id>/controller/left|right   normalized controller pose+buttons+axes
  /webxr/<id>/panels      retained — feed config the client renders
  /webxr/<id>/state       retained — session status + summary (desktop UI)
  /webxr/<id>/control     incoming — actions (recenter, set_panel, …)
"""
from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional

from rlx_bus import SubprocessService, service_method

from . import frames
from .model import Mapping, PanelSpec, WebXRConfig

logger = logging.getLogger(__name__)


class WebXRService(SubprocessService):
    type_name = "webxr"
    heartbeat_interval_s = 1.0
    config_class = WebXRConfig
    publishes = ["state", "head", "controller/left", "controller/right", "panels"]

    def __init__(self, proxy_id, bus) -> None:
        super().__init__(proxy_id, bus)
        self._session: Dict[str, Any] = {"active": False, "mode": None, "fps": 0.0}
        self._last_input_ts: float = 0.0
        self._last_state_pub: float = 0.0
        self._last_map_run: float = 0.0
        # Latest normalized signals (for the mapping resolver + state summary).
        self._norm: Dict[str, Any] = {}

    # ─── lifecycle ────────────────────────────────────────────────────
    async def on_start(self) -> None:
        # Headset client publishes telemetry here; we consume it.
        await self.subscribe("input", self._on_input)
        await self._publish_panels()
        await self._publish_state()

    # ─── inbound telemetry ────────────────────────────────────────────
    async def _on_input(self, payload: Any) -> None:
        """Consume one headset telemetry frame, normalize, republish, map."""
        if not isinstance(payload, dict) or not self.config.enabled:
            return
        now = time.time()
        self._last_input_ts = now
        sess = payload.get("session")
        if isinstance(sess, dict):
            self._session = {
                "active": bool(sess.get("active", True)),
                "mode": sess.get("mode"),
                "fps": float(sess.get("fps", 0.0)),
            }

        origin = self.config.origin_mm
        norm: Dict[str, Any] = {}

        head = payload.get("head")
        if isinstance(head, dict):
            h = frames.transform_pose(head, origin)
            norm["head"] = h
            await self.publish("head", {**h, "ts": now})

        controllers = payload.get("controllers") or {}
        norm["controller"] = {}
        for side in ("left", "right"):
            c = controllers.get(side) if isinstance(controllers, dict) else None
            if not isinstance(c, dict):
                continue
            entry: Dict[str, Any] = {
                "buttons": c.get("buttons", {}) or {},
                "axes": c.get("axes", {}) or {},
                # Every gamepad component the device exposes (trigger,
                # squeeze, thumbstick, a/b/x/y, thumbrest, …), each with
                # {state, value, x, y} — so any actuator can map any input.
                "components": c.get("components", {}) or {},
            }
            for space in ("grip", "ray"):
                pose = c.get(space)
                if isinstance(pose, dict):
                    entry[space] = frames.transform_pose(pose, origin)
            norm["controller"][side] = entry
            await self.publish(f"controller/{side}", {**entry, "ts": now})

        self._norm = norm

        # Drive mapped actuators (throttled so we don't flood servo/IK topics).
        if now - self._last_map_run > 1.0 / 30.0:
            self._last_map_run = now
            await self._run_mappings(norm)

        # Status to the desktop panel — throttled to ~10 Hz.
        if now - self._last_state_pub > 0.1:
            await self._publish_state()

    async def _run_mappings(self, norm: Dict[str, Any]) -> None:
        for m in self.config.mappings:
            if not m.enabled or not m.target:
                continue
            val = _resolve_path(norm, m.source)
            if val is None:
                continue
            payload: Dict[str, Any] = dict(m.args)
            if isinstance(val, dict) and "pos" in val:           # pose source
                pos = val["pos"]
                payload.setdefault("x", pos[0])
                payload.setdefault("y", pos[1])
                payload.setdefault("z", pos[2])
            elif isinstance(val, (int, float)):                  # scalar source
                if not m.arg_key:
                    continue
                payload[m.arg_key] = float(val) * m.scale + m.offset
            else:
                continue
            try:
                await self.bus.publish(
                    f"/{m.target}/control", {"action": m.action, **payload}
                )
            except Exception:  # noqa: BLE001 — one bad mapping shouldn't kill the loop
                logger.exception("webxr %s: mapping %s publish failed", self.proxy_id, m.id)

    # ─── actions ──────────────────────────────────────────────────────
    @service_method("recenter", publishes=["state"])
    async def m_recenter(self) -> Dict[str, Any]:
        """Capture the current head position as the origin so the operator
        can stand anywhere. Stores the offset (robot mm) in config."""
        head = self._norm.get("head") if isinstance(self._norm, dict) else None
        if not head:
            raise RuntimeError("recenter: no head pose received yet")
        # head["pos"] already had the OLD origin subtracted; fold it back in
        # so the new origin is absolute.
        old = self.config.origin_mm or [0.0, 0.0, 0.0]
        new_origin = [head["pos"][i] + old[i] for i in range(3)]
        await self.update_config({"origin_mm": new_origin})
        await self._publish_state()
        return {"origin_mm": new_origin}

    @service_method("clear_origin", publishes=["state"])
    async def m_clear_origin(self) -> Dict[str, Any]:
        await self.update_config({"origin_mm": None})
        await self._publish_state()
        return {"origin_mm": None}

    @service_method("set_enabled", publishes=["state"])
    async def m_set_enabled(self, enabled: bool) -> Dict[str, Any]:
        await self.update_config({"enabled": bool(enabled)})
        await self._publish_state()
        return {"enabled": bool(enabled)}

    @service_method("set_panel", publishes=["state"])
    async def m_set_panel(self, panel: Dict[str, Any]) -> Dict[str, Any]:
        """Add or update a feed panel (matched by id)."""
        spec = PanelSpec(**panel)
        panels = [p for p in self.config.panels if p.id != spec.id]
        panels.append(spec)
        await self.update_config({"panels": [p.model_dump() for p in panels]})
        await self._publish_panels()
        await self._publish_state()
        return {"panels": len(panels)}

    @service_method("remove_panel", publishes=["state"])
    async def m_remove_panel(self, id: str) -> Dict[str, Any]:
        panels = [p for p in self.config.panels if p.id != id]
        await self.update_config({"panels": [p.model_dump() for p in panels]})
        await self._publish_panels()
        await self._publish_state()
        return {"panels": len(panels)}

    @service_method("set_mapping", publishes=["state"])
    async def m_set_mapping(self, mapping: Dict[str, Any]) -> Dict[str, Any]:
        """Add or update a controller→actuator mapping (matched by id)."""
        m = Mapping(**mapping)
        maps = [x for x in self.config.mappings if x.id != m.id]
        maps.append(m)
        await self.update_config({"mappings": [x.model_dump() for x in maps]})
        await self._publish_state()
        return {"mappings": len(maps)}

    @service_method("remove_mapping", publishes=["state"])
    async def m_remove_mapping(self, id: str) -> Dict[str, Any]:
        maps = [x for x in self.config.mappings if x.id != id]
        await self.update_config({"mappings": [x.model_dump() for x in maps]})
        await self._publish_state()
        return {"mappings": len(maps)}

    @service_method("set_hand_tracking", publishes=["state"])
    async def m_set_hand_tracking(self, enabled: bool) -> Dict[str, Any]:
        await self.update_config({"hand_tracking": bool(enabled)})
        await self._publish_panels()
        await self._publish_state()
        return {"hand_tracking": bool(enabled)}

    # ─── outbound config + status ─────────────────────────────────────
    async def _publish_panels(self) -> None:
        """Retained config the immersive client renders from."""
        await self.publish("panels", {
            "reference_space": self.config.reference_space,
            "publish_rate_hz": self.config.publish_rate_hz,
            "hand_tracking": self.config.hand_tracking,
            "panels": [p.model_dump() for p in self.config.panels],
        }, retained=True)

    def _snapshot(self) -> Dict[str, Any]:
        head = self._norm.get("head") if isinstance(self._norm, dict) else None
        ctrl = self._norm.get("controller", {}) if isinstance(self._norm, dict) else {}
        # "connected" = we've heard from a headset in the last 2s.
        connected = (time.time() - self._last_input_ts) < 2.0 if self._last_input_ts else False
        return {
            "enabled": self.config.enabled,
            "connected": connected,
            "session": self._session,
            "reference_space": self.config.reference_space,
            "publish_rate_hz": self.config.publish_rate_hz,
            "hand_tracking": self.config.hand_tracking,
            "origin_mm": self.config.origin_mm,
            "head": head,
            "controller": {
                "left": _ctrl_summary(ctrl.get("left")),
                "right": _ctrl_summary(ctrl.get("right")),
            },
            "panels": [p.model_dump() for p in self.config.panels],
            "mappings": [m.model_dump() for m in self.config.mappings],
            "ts": time.time(),
        }

    async def _publish_state(self) -> None:
        self._last_state_pub = time.time()
        await self.publish("state", self._snapshot(), retained=True)


def _ctrl_summary(c: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not isinstance(c, dict):
        return None
    return {
        "ray": c.get("ray"),
        "buttons": c.get("buttons", {}),
        "axes": c.get("axes", {}),
        "components": c.get("components", {}),
    }


def _resolve_path(root: Dict[str, Any], path: str) -> Any:
    """Walk a dotted path into a nested dict; None if any hop is missing."""
    cur: Any = root
    for key in path.split("."):
        if not isinstance(cur, dict) or key not in cur:
            return None
        cur = cur[key]
    return cur
