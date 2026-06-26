"""IKSolverService — subprocess service that converts target poses
into joint angles.

Subclasses ``rlx_bus.SubprocessService`` so the boilerplate (env
loading, bus client, hello, control dispatch, heartbeat, signals,
consume loop, graceful shutdown) lives in the framework. This
module defines only what's IK-specific: the @service_method
actions, the state publish, and the model/FK/IK integration.

Wire contract
-------------
Topics published:

  /ik_solver/{id}/state           retained — model + last solution snapshot
  /ik_solver/{id}/control         incoming actions (see below)
  /ik_solver/{id}/solution        non-retained — every solve() emits one event here
  /ik_solver/{id}/heartbeat       1Hz auto (base class)
  /ik_solver/{id}/meta            retained — service-type meta (auto)

Actions accepted on /control:

  {"action":"solve",         "target": {"x":..., "y":..., "z":...}}
  {"action":"fk",            "joint_angles": {"base":..., "shoulder":..., "elbow":...}}
  {"action":"set_model",     "joints":[...], "links":[...]}
  {"action":"set_calibration","joint":"shoulder", "zero_offset_deg":0, "direction":1, "servo_proxy_id":"servo-1"}
  {"action":"link_servo",    "joint":"shoulder", "proxy_id":"servo-1"}
  {"action":"unlink_servo",  "joint":"shoulder"}
  {"action":"send_to_servos","joint_angles":{...}?}    # optional — defaults to last solution
"""
from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional

from rlx_bus import ServiceConfig, SubprocessService, service_method

from . import models_lib
from .calibration import auto_calibrate, calibrate_all, calibration_for, math_to_servo, servo_to_math
from .fk import forward_kinematics, joint_world_positions
from .ik import inverse_kinematics
from .model import (
    IKSolverConfig,
    JointCalibration,
    JointSpec,
    LinkSpec,
    max_reach_mm,
    min_reach_mm,
)
from .models_lib import Pose, RobotModel, SCHEMA_VERSION


logger = logging.getLogger(__name__)


def _iso_now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


class IKSolverService(SubprocessService):
    """IK microservice. See module docstring for the wire contract."""

    type_name = "ik_solver"
    heartbeat_interval_s = 1.0
    config_class = IKSolverConfig
    publishes = ["state", "solution"]

    def __init__(self, proxy_id, bus) -> None:
        super().__init__(proxy_id, bus)
        # Last solution — kept around for state snapshots and as
        # the default payload for ``send_to_servos`` when called
        # without explicit angles. None until the first solve().
        self._last_solution: Optional[Dict[str, Any]] = None
        self._last_target: Optional[Dict[str, float]] = None
        # Live joint configuration in math degrees — updated by solve / fk /
        # apply_pose, seeded from a model's initial pose on load. save_pose
        # snapshots this; the analytic solver also uses it to bias branch
        # selection toward the pose the arm is actually in.
        self._current_angles: Dict[str, float] = {}

    # ─── lifecycle ───────────────────────────────────────────────────

    async def on_start(self) -> None:
        await self._publish_state()

    async def on_stop(self) -> None:
        # Stateless; nothing to clean up. State + solution are
        # ephemeral, config persists via the framework.
        pass

    # ─── @service_method actions ────────────────────────────────────

    @service_method("solve", publishes=["solution", "state"])
    async def m_solve(
        self,
        target: Dict[str, float],
        current_angles: Optional[Dict[str, float]] = None,
    ) -> Dict[str, Any]:
        """Solve IK for ``target = {x, y, z}``. Returns the result
        envelope verbatim (see ``ik.inverse_kinematics``). Publishes
        the same envelope on ``/solution`` for subscribers.

        ``current_angles`` (optional) is the operator's live joint
        configuration in math degrees. When supplied, the solver
        biases its branch selection (analytic) + initial seed
        (numerical) toward this pose so a solve for "the point I'm
        already at" returns a result close to where the arm IS —
        rather than picking a mirror configuration that teleports
        the servos."""
        if not isinstance(target, dict):
            raise ValueError("solve: target must be an object {x, y, z}")
        try:
            x = float(target.get("x", 0.0))
            y = float(target.get("y", 0.0))
            z = float(target.get("z", 0.0))
        except (TypeError, ValueError):
            raise ValueError("solve: target.x/y/z must be numbers")
        clean_current: Optional[Dict[str, float]] = None
        if isinstance(current_angles, dict) and current_angles:
            clean_current = {}
            for k, v in current_angles.items():
                try:
                    clean_current[str(k)] = float(v)
                except (TypeError, ValueError):
                    # Skip any non-numeric entry rather than failing the
                    # whole solve — the operator may have sent a
                    # partially-populated map.
                    continue
            if not clean_current:
                clean_current = None
        result = inverse_kinematics(
            self.config, (x, y, z), current_angles=clean_current,
        )
        envelope: Dict[str, Any] = {
            "target": {"x": x, "y": y, "z": z},
            "ts": time.time(),
            **result,
        }
        if envelope.get("reachable"):
            # Enrich with calibrated servo angles so consumers
            # don't have to compute them.
            envelope["joint_angles"] = calibrate_all(self.config, envelope["joint_angles"])  # type: ignore[arg-type]
            # Track the solved pose as the live configuration (math degrees).
            self._current_angles = {
                name: float(entry["math"]) if isinstance(entry, dict) else float(entry)
                for name, entry in envelope["joint_angles"].items()
            }
        self._last_solution = envelope
        self._last_target = {"x": x, "y": y, "z": z}
        await self._publish_solution(envelope)
        await self._publish_state()
        return envelope

    @service_method("fk", publishes=["state"])
    async def m_fk(self, joint_angles: Dict[str, float]) -> Dict[str, Any]:
        """Forward kinematics — joint angles → end-effector pose.
        Useful for verifying that the inverse + forward
        transformations round-trip cleanly."""
        if not isinstance(joint_angles, dict):
            raise ValueError("fk: joint_angles must be an object")
        clean = {str(k): float(v) for k, v in joint_angles.items()}
        pose = forward_kinematics(self.config, clean)
        self._current_angles = dict(clean)
        return {"pose": pose, "joint_angles": clean, "ts": time.time()}

    # ─── servo_controller interface (VIRTUAL controller) ──────────────
    # ik_solver declares ``implements: [servo_controller]`` so a servo can
    # attach to it. The servo pushes ``servo_write`` here; we inverse-map
    # the angle to the joint(s) linked to that servo (calibration), merge
    # into the current joint state, recompute FK and re-render. Identified
    # by ``servo_id`` (no pins on a virtual controller). We never write
    # back to servos — no feedback loop.
    @service_method("servo_write", publishes=["state"])
    async def m_servo_write(
        self, angle: float, servo_id: Optional[str] = None, pin: Optional[int] = None,
    ) -> Dict[str, Any]:
        if not servo_id:
            return {"applied": 0}
        updates = {
            c.joint: servo_to_math(c, float(angle))
            for c in self.config.calibration if c.servo_proxy_id == servo_id
        }
        if not updates:
            return {"applied": 0}
        merged = dict(getattr(self, "_current_angles", {}) or {})
        merged.update(updates)
        forward_kinematics(self.config, merged)
        self._current_angles = merged
        await self._publish_state()
        return {"applied": len(updates), "joints": list(updates)}

    @service_method("servo_attach")
    async def m_servo_attach(
        self, servo_id: Optional[str] = None, pin: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Virtual attach — no pin. Mapping comes from calibration
        (link_servo / set_calibration)."""
        bound = bool(servo_id) and any(
            c.servo_proxy_id == servo_id for c in self.config.calibration
        )
        if servo_id and not bound:
            logger.warning(
                "ik_solver %s: servo %r attached as a virtual controller but "
                "isn't linked to any joint — use link_servo", self.proxy_id, servo_id,
            )
        return {"ok": True, "virtual": True, "linked": bound}

    @service_method("servo_detach")
    async def m_servo_detach(
        self, servo_id: Optional[str] = None, pin: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Virtual detach — no pin to release; calibration link kept."""
        return {"ok": True, "virtual": True}

    @service_method("set_model", publishes=["state"])
    async def m_set_model(
        self,
        joints: List[Dict[str, Any]],
        links: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Replace the entire robot model. Validates first so a
        malformed payload doesn't corrupt persisted state."""
        try:
            new_joints = [JointSpec(**j) for j in joints]
            new_links = [LinkSpec(**l) for l in links]
        except Exception as exc:  # noqa: BLE001 — pydantic ValidationError + bad-shape coercions
            raise ValueError(f"set_model: invalid model — {exc}")
        # Preserve calibration entries for joints that survived the
        # rename; drop ones whose joint name disappeared.
        new_names = {j.name for j in new_joints}
        kept_cal = [c for c in self.config.calibration if c.joint in new_names]
        # Add identity calibration for any new joint.
        existing_cal_joints = {c.joint for c in kept_cal}
        for j in new_joints:
            if j.name not in existing_cal_joints:
                kept_cal.append(JointCalibration(joint=j.name))
        await self.update_config({
            "joints": [j.model_dump() for j in new_joints],
            "links": [l.model_dump() for l in new_links],
            "calibration": [c.model_dump() for c in kept_cal],
        })
        await self._publish_state()
        return self._snapshot()

    @service_method("set_calibration", publishes=["state"])
    async def m_set_calibration(
        self,
        joint: str,
        zero_offset_deg: Optional[float] = None,
        direction: Optional[int] = None,
        servo_proxy_id: Optional[str] = None,
        scale: Optional[float] = None,
        servo_min_deg: Optional[float] = None,
        servo_max_deg: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Update one joint's calibration. Unspecified fields keep
        their existing value. ``servo_proxy_id="-"`` (a single dash)
        is the explicit unlink sentinel — JSON has no clean way to
        express "delete this field" so we use a magic value.

        ``scale`` is the math→servo gear ratio (1.0 = direct drive).
        ``servo_min_deg`` / ``servo_max_deg`` bound the physical
        servo range — the IK validator rejects solutions whose
        commanded servo angle falls outside this window."""
        existing = list(self.config.calibration)
        found_idx = next((i for i, c in enumerate(existing) if c.joint == joint), -1)
        if found_idx == -1:
            existing.append(JointCalibration(joint=joint))
            found_idx = len(existing) - 1
        cur = existing[found_idx].model_copy()
        if zero_offset_deg is not None:
            cur.zero_offset_deg = float(zero_offset_deg)
        if direction is not None:
            cur.direction = -1 if int(direction) < 0 else 1
        if servo_proxy_id is not None:
            cur.servo_proxy_id = None if servo_proxy_id == "-" else str(servo_proxy_id)
        if scale is not None:
            try:
                s = float(scale)
            except (TypeError, ValueError):
                raise ValueError("set_calibration: scale must be a number")
            if s == 0:
                raise ValueError("set_calibration: scale must be non-zero")
            cur.scale = s
        if servo_min_deg is not None:
            cur.servo_min_deg = float(servo_min_deg)
        if servo_max_deg is not None:
            cur.servo_max_deg = float(servo_max_deg)
        if cur.servo_min_deg > cur.servo_max_deg:
            raise ValueError(
                f"set_calibration: servo_min_deg ({cur.servo_min_deg}) > "
                f"servo_max_deg ({cur.servo_max_deg})"
            )
        existing[found_idx] = cur
        await self.update_config({"calibration": [c.model_dump() for c in existing]})
        await self._publish_state()
        return self._snapshot()

    @service_method("link_servo", publishes=["state"])
    async def m_link_servo(
        self, joint: str, proxy_id: str, auto_fit: bool = True,
    ) -> Dict[str, Any]:
        """Bind a joint to a live servo proxy and (by default) auto-fit
        the calibration so the servo's full travel maps onto the joint's
        full math range — servo centre on the joint's neutral. Without
        this the identity map (servo°==math°) hits the joint limit
        halfway through the servo's travel. ``auto_fit=False`` binds with
        the existing/identity knobs untouched."""
        existing = list(self.config.calibration)
        idx = next((i for i, c in enumerate(existing) if c.joint == joint), -1)
        base = existing[idx].model_copy() if idx != -1 else JointCalibration(joint=joint)
        base.servo_proxy_id = str(proxy_id)
        if auto_fit:
            base = self._auto_fit(base, joint)
        if idx == -1:
            existing.append(base)
        else:
            existing[idx] = base
        await self.update_config({"calibration": [c.model_dump() for c in existing]})
        await self._publish_state()
        return self._snapshot()

    @service_method("unlink_servo", publishes=["state"])
    async def m_unlink_servo(self, joint: str) -> Dict[str, Any]:
        """Unbind a joint from its linked servo."""
        return await self.m_set_calibration(joint=joint, servo_proxy_id="-")

    @service_method("auto_calibrate", publishes=["state"])
    async def m_auto_calibrate(
        self, joint: str, direction: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Re-fit one joint's calibration to its math range ↔ servo range
        (the same fit link_servo does). ``direction`` flips the mapping;
        omitted keeps the current one."""
        existing = list(self.config.calibration)
        idx = next((i for i, c in enumerate(existing) if c.joint == joint), -1)
        if idx == -1:
            raise ValueError(f"auto_calibrate: no calibration for joint {joint}")
        cur = existing[idx].model_copy()
        if direction is not None:
            cur.direction = -1 if int(direction) < 0 else 1
        existing[idx] = self._auto_fit(cur, joint)
        await self.update_config({"calibration": [c.model_dump() for c in existing]})
        await self._publish_state()
        return self._snapshot()

    def _auto_fit(self, cal: JointCalibration, joint: str) -> JointCalibration:
        """Fit ``cal`` so the joint's math range (its JointSpec
        min_deg/max_deg) maps onto the servo's range (cal.servo_min_deg/
        servo_max_deg, default 0..180). Keeps the joint's current
        direction so a prior manual flip survives a re-link."""
        spec = next((j for j in self.config.joints if j.name == joint), None)
        if spec is None:
            return cal
        return auto_calibrate(
            cal, spec.min_deg, spec.max_deg,
            cal.servo_min_deg, cal.servo_max_deg, direction=cal.direction,
        )

    @service_method("send_to_servos")
    async def m_send_to_servos(
        self, joint_angles: Optional[Dict[str, float]] = None,
    ) -> Dict[str, Any]:
        """For every joint with a calibrated servo binding, publish a
        ``{action: write, angle: <calibrated>}`` payload to that
        servo's ``/control`` topic. Fire-and-forget — we don't wait
        for the servos to confirm. ``joint_angles`` defaults to the
        last solution; if there's no last solution and no override,
        nothing is dispatched."""
        if joint_angles is None:
            if self._last_solution is None or not self._last_solution.get("reachable"):
                return {"dispatched": 0, "reason": "no last solution to send"}
            # The last solution stores per-joint {math, servo}; use math.
            angles_payload = self._last_solution.get("joint_angles") or {}
            angles = {
                name: float(entry["math"]) if isinstance(entry, dict) else float(entry)
                for name, entry in angles_payload.items()
            }
        else:
            angles = {str(k): float(v) for k, v in joint_angles.items()}

        dispatched: List[str] = []
        for joint in self.config.joints:
            math_a = angles.get(joint.name)
            if math_a is None:
                continue
            cal = calibration_for(self.config, joint.name)
            if cal is None or not cal.servo_proxy_id:
                continue
            servo_a = math_to_servo(cal, math_a)
            # The servo's /control topic — the standard
            # ``{action: write, angle: N}`` shape used by Servo's
            # own UI. We don't reply_to (fire-and-forget).
            await self.bus.publish(
                f"/servo/{cal.servo_proxy_id}/control",
                {"action": "write", "angle": int(round(servo_a))},
            )
            dispatched.append(f"{joint.name}→{cal.servo_proxy_id}@{servo_a:.1f}°")
        return {"dispatched": len(dispatched), "fanout": dispatched}

    # ─── model library ───────────────────────────────────────────────

    @service_method("list_models")
    async def m_list_models(self) -> Dict[str, Any]:
        """Browse the merged model library — bundled examples + shared user
        models (user shadows bundled by id). Returns lightweight rows; load
        a model to get its full body."""
        return {"models": models_lib.list_models()}

    @service_method("load_model", publishes=["state"])
    async def m_load_model(self, id: str) -> Dict[str, Any]:
        """Load a library model into the live config: applies geometry +
        calibration (preserving any existing per-joint servo bindings by
        name), carries the rich chain, and seeds the initial pose."""
        model = models_lib.load(str(id))
        await self._apply_model(model)
        await self._publish_state()
        return self._snapshot()

    @service_method("save_model", publishes=["state"])
    async def m_save_model(
        self,
        id: str,
        title: Optional[str] = None,
        include_current_pose: bool = False,
    ) -> Dict[str, Any]:
        """Save the live model to the shared user library. When
        ``include_current_pose`` is set, the current joint configuration is
        captured as the initial 'home' pose so the model reloads to this
        state."""
        model = self._config_to_model(str(id), title, bool(include_current_pose))
        path = models_lib.save(model)
        await self.update_config({
            "model_id": model.id,
            "model_title": model.title,
            "poses": [p.model_dump() for p in model.poses],
        })
        await self._publish_state()
        return {"saved": True, "id": model.id, "path": str(path)}

    @service_method("delete_model", publishes=["state"])
    async def m_delete_model(self, id: str) -> Dict[str, Any]:
        """Delete a USER model (bundled examples are read-only)."""
        deleted = models_lib.delete(str(id))
        await self._publish_state()
        return {"deleted": deleted, "id": str(id)}

    @service_method("export_model")
    async def m_export_model(self, id: Optional[str] = None) -> Dict[str, Any]:
        """Return a model's full JSON for download. No id → export the live
        working model."""
        if id:
            return models_lib.load(str(id)).model_dump()
        return self._config_to_model(
            self.config.model_id or "model", self.config.model_title, False
        ).model_dump()

    # ─── poses ────────────────────────────────────────────────────────

    @service_method("save_pose", publishes=["state"])
    async def m_save_pose(
        self,
        name: str,
        set_initial: bool = False,
        angles: Optional[Dict[str, float]] = None,
    ) -> Dict[str, Any]:
        """Capture a named pose. ``angles`` defaults to the current joint
        configuration; ``set_initial`` makes it the pose applied on load."""
        if isinstance(angles, dict) and angles:
            captured = {str(k): float(v) for k, v in angles.items()}
        else:
            captured = dict(self._current_angles)
        poses = self._upsert_pose(
            list(self.config.poses),
            Pose(name=str(name), is_initial=bool(set_initial), angles=captured),
        )
        await self.update_config({"poses": [p.model_dump() for p in poses]})
        await self._publish_state()
        return {"saved": str(name), "poses": [p.name for p in poses]}

    @service_method("apply_pose", publishes=["state"])
    async def m_apply_pose(self, name: str) -> Dict[str, Any]:
        """Set the live joint configuration to a named pose (does not drive
        servos — call send_to_servos for that)."""
        pose = next((p for p in self.config.poses if p.name == name), None)
        if pose is None:
            raise ValueError(f"apply_pose: pose {name!r} not found")
        self._current_angles = dict(pose.angles)
        await self._publish_state()
        return {"applied": name, "angles": self._current_angles}

    @service_method("delete_pose", publishes=["state"])
    async def m_delete_pose(self, name: str) -> Dict[str, Any]:
        """Remove a named pose from the live model."""
        poses = [p for p in self.config.poses if p.name != name]
        await self.update_config({"poses": [p.model_dump() for p in poses]})
        await self._publish_state()
        return {"deleted": name, "poses": [p.name for p in poses]}

    # ─── library helpers ──────────────────────────────────────────────

    @staticmethod
    def _upsert_pose(poses: List[Pose], new: Pose) -> List[Pose]:
        """Replace any pose of the same name; if the new pose is initial,
        clear the flag on the others (exactly one initial)."""
        out = [p for p in poses if p.name != new.name]
        if new.is_initial:
            out = [p.model_copy(update={"is_initial": False}) for p in out]
        out.append(new)
        return out

    def _config_to_model(
        self, model_id: str, title: Optional[str], include_current_pose: bool,
    ) -> RobotModel:
        """Serialize the live config into a portable RobotModel. Strips
        per-instance servo bindings from the calibration template."""
        cfg = self.config
        poses = list(cfg.poses)
        if include_current_pose and self._current_angles:
            poses = self._upsert_pose(
                poses, Pose(name="home", is_initial=True, angles=dict(self._current_angles)),
            )
        cal_template: List[Dict[str, Any]] = []
        for c in cfg.calibration:
            d = c.model_dump()
            d.pop("servo_proxy_id", None)  # bindings are per-rig, not portable
            cal_template.append(d)
        return RobotModel(
            schema_version=SCHEMA_VERSION,
            id=model_id,
            title=title or cfg.model_title or model_id,
            source=cfg.model_source or "",
            ik_model={
                "joints": [j.model_dump() for j in cfg.joints],
                "links": [l.model_dump() for l in cfg.links],
            },
            chain=list(cfg.chain or []),
            calibration_template=cal_template,
            poses=poses,
        )

    async def _apply_model(self, model: RobotModel) -> None:
        """Apply a RobotModel to the live config. Preserves existing per-joint
        servo bindings by name; seeds current angles from the initial pose."""
        new_joints = [JointSpec(**j) for j in model.ik_model.get("joints", [])]
        new_links = [LinkSpec(**l) for l in model.ik_model.get("links", [])]
        existing = {c.joint: c for c in self.config.calibration}
        tmpl = {c.get("joint"): c for c in model.calibration_template}
        merged: List[JointCalibration] = []
        for j in new_joints:
            base = dict(tmpl.get(j.name, {}))
            base["joint"] = j.name
            base.pop("servo_proxy_id", None)
            cal = JointCalibration(**base)
            prev = existing.get(j.name)
            if prev is not None and prev.servo_proxy_id:
                cal.servo_proxy_id = prev.servo_proxy_id  # keep the live binding
            merged.append(cal)
        await self.update_config({
            "joints": [j.model_dump() for j in new_joints],
            "links": [l.model_dump() for l in new_links],
            "calibration": [c.model_dump() for c in merged],
            "chain": list(model.chain or []),
            "poses": [p.model_dump() for p in model.poses],
            "model_id": model.id,
            "model_title": model.title,
            "model_source": model.source,
        })
        init = model.initial_pose()
        self._current_angles = dict(init.angles) if init else {}

    # ─── internals ──────────────────────────────────────────────────

    def _snapshot(self) -> Dict[str, Any]:
        return {
            "joints": [j.model_dump() for j in self.config.joints],
            "links": [l.model_dump() for l in self.config.links],
            "calibration": [c.model_dump() for c in self.config.calibration],
            "max_reach_mm": max_reach_mm(self.config),
            "min_reach_mm": min_reach_mm(self.config),
            "last_target": self._last_target,
            "last_solution": self._last_solution,
            "position_tolerance_mm": self.config.position_tolerance_mm,
            # Model Library working state.
            "model_id": self.config.model_id,
            "model_title": self.config.model_title,
            "model_source": self.config.model_source,
            "poses": [p.model_dump() for p in self.config.poses],
            "current_angles": dict(self._current_angles),
            "ts": _iso_now(),
        }

    async def _publish_state(self) -> None:
        await self.publish("state", self._snapshot(), retained=True)

    async def _publish_solution(self, envelope: Dict[str, Any]) -> None:
        try:
            await self.publish("solution", envelope, retained=False)
        except Exception:  # noqa: BLE001
            logger.exception("ik_solver %s: solution publish failed", self.proxy_id)
