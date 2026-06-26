"""Whole-body IK — Pinocchio model + Pink task-based differential IK.

Pure, bus-agnostic. Loads a URDF once, then drives multiple end-effectors
(arms reach, head look-at) by per-EE weighted FrameTasks solved together,
so shared joints (the waist) are coordinated and joint limits respected.

Two InMoov realities handled at load (proven in the P0 spike):
  * reversed joint limits (lower>upper) are normalised by swapping,
  * the neutral pose is clamped into [lower, upper] before solving.

The heavy deps (pinocchio, pink, qpsolvers/quadprog) live in this service's
own venv; importing this module requires them.
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional, Tuple

import numpy as np
import pinocchio as pin
from pink import Configuration, solve_ik
from pink.barriers import Barrier
from pink.tasks import FrameTask, PostureTask

from .rig import EndEffector

_QP = "quadprog"
_FINGER_NAMES = ("thumb", "index", "middle", "ring", "pinky")


class TableBarrier(Barrier):
    """Control-barrier-function obstacle: keeps a set of arm collision
    spheres outside a vertical capped cylinder (a bar table — radius R,
    top at z=zt, standing on the floor). Each sphere contributes one
    barrier h = exterior_distance(center, cylinder) - radius - margin;
    the QP keeps h >= 0, so the solve avoids driving the arm through the
    table. Spheres are small on the hand (so it can reach a cup sitting
    on the surface) and larger on the elbow/upper arm (which must stay
    clear). Approximation, not full mesh collision — robust for tabletop
    picking; reactive, so it can hit local minima on big cold-start jumps
    (the service solves incrementally, which avoids that)."""

    def __init__(self, specs, cx: float, cy: float, R: float, zt: float, gain: float = 1.0):
        # specs: list of (frame_name, sphere_radius_m, margin_m)
        super().__init__(dim=len(specs), gain=gain)
        self.specs = specs
        self.cx, self.cy, self.R, self.zt = cx, cy, R, zt

    def _sd_normal(self, p: np.ndarray):
        """Exterior signed distance + outward unit normal from point p to
        the capped cylinder. Negative inside the solid."""
        dx, dy = p[0] - self.cx, p[1] - self.cy
        rr = math.hypot(dx, dy)
        dr, dz = rr - self.R, p[2] - self.zt
        if dr <= 0 and dz <= 0:                               # inside the solid
            if -dz <= -dr:                                    # closer to the top → push up
                return dz, np.array([0.0, 0.0, 1.0])
            n = np.array([dx / rr, dy / rr, 0.0]) if rr > 1e-9 else np.array([1.0, 0.0, 0.0])
            return dr, n                                      # push out radially
        if dr > 0 and dz <= 0:                                # beside, below the top
            n = np.array([dx / rr, dy / rr, 0.0]) if rr > 1e-9 else np.array([1.0, 0.0, 0.0])
            return dr, n
        if dr <= 0 and dz > 0:                                # above, within the radius
            return dz, np.array([0.0, 0.0, 1.0])
        rim = np.array([self.cx + self.R * dx / rr, self.cy + self.R * dy / rr, self.zt])
        d = p - rim
        dist = float(np.linalg.norm(d))                       # nearest point is the top rim
        return dist, (d / dist if dist > 1e-9 else np.array([0.0, 0.0, 1.0]))

    def compute_barrier(self, cfg) -> np.ndarray:
        return np.array([
            self._sd_normal(cfg.get_transform_frame_to_world(f).translation)[0] - r - m
            for f, r, m in self.specs
        ])

    def compute_jacobian(self, cfg) -> np.ndarray:
        rows = []
        for f, _r, _m in self.specs:
            T = cfg.get_transform_frame_to_world(f)
            _d, n = self._sd_normal(T.translation)
            rows.append(n @ (T.rotation @ cfg.get_frame_jacobian(f)[:3]))
        return np.array(rows)


def _look_at_rotation(eye: np.ndarray, target: np.ndarray, forward: np.ndarray) -> np.ndarray:
    """Rotation that aims ``forward`` (link-local unit axis) at ``target``
    from ``eye``, keeping world +Z up as much as possible. Returns 3×3."""
    d = target - eye
    n = np.linalg.norm(d)
    if n < 1e-9:
        return np.eye(3)
    z = d / n                                  # desired world direction of `forward`
    up = np.array([0.0, 0.0, 1.0])
    if abs(float(z @ up)) > 0.99:              # looking near-vertical → pick another up
        up = np.array([1.0, 0.0, 0.0])
    x = np.cross(up, z); x /= (np.linalg.norm(x) or 1.0)
    y = np.cross(z, x)
    # Basis mapping link-forward→z. Compose so the link's `forward` axis lands on z.
    basis = np.column_stack((x, y, z))         # maps +Z(local)→z(world)
    f = forward / (np.linalg.norm(forward) or 1.0)
    # rotation taking local `forward` to local +Z, then basis to world.
    align = _rot_between(np.array([0.0, 0.0, 1.0]), f).T
    return basis @ align


def _rot_between(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Minimal rotation taking unit vector a→b."""
    a = a / (np.linalg.norm(a) or 1.0); b = b / (np.linalg.norm(b) or 1.0)
    v = np.cross(a, b); c = float(a @ b)
    if np.linalg.norm(v) < 1e-9:
        return np.eye(3) if c > 0 else np.diag([1.0, -1.0, -1.0])
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * (1.0 / (1.0 + c))


class WholeBodySolver:
    def __init__(self, urdf_path: str) -> None:
        self.model = pin.buildModelFromUrdf(urdf_path)
        # Normalise reversed limits (InMoov encodes some lower>upper).
        lo, hi = self.model.lowerPositionLimit.copy(), self.model.upperPositionLimit.copy()
        swap = lo > hi
        self.model.lowerPositionLimit = np.where(swap, hi, lo)
        self.model.upperPositionLimit = np.where(swap, lo, hi)
        self.n_limit_fixes = int(swap.sum())
        self.data = self.model.createData()
        # Clamp the neutral pose into limits — the start must be valid.
        self._q0 = np.clip(pin.neutral(self.model),
                           self.model.lowerPositionLimit, self.model.upperPositionLimit)
        self.cfg = Configuration(self.model, self.data, self._q0.copy())
        self.tasks: Dict[str, FrameTask] = {}
        self.ee: Dict[str, EndEffector] = {}
        self.posture = PostureTask(cost=1e-2)
        self.posture.set_target(self._q0)
        self._barriers: List[TableBarrier] = []   # obstacle CBFs (the table)
        self._obstacle_enabled: bool = True
        # Posture target vector (the pose the posture task regularises toward).
        # Finger curl writes into its finger entries so a solve HOLDS the curl
        # (fingers have no IK task; the posture task is all that drives them).
        self._posture_q = self._q0.copy()
        self._finger_curl: Dict[str, float] = {"r": 0.0, "l": 0.0}
        # joint_name → q index, for actuated (1-DOF) joints.
        self._q_index: Dict[str, int] = {}
        for jid in range(1, self.model.njoints):
            jname = self.model.names[jid]
            joint = self.model.joints[jid]
            if joint.nq == 1:
                self._q_index[jname] = joint.idx_q

    # ─── configuration ────────────────────────────────────────────────
    def set_end_effectors(self, ees: List[EndEffector], posture_cost: float = 1e-2) -> List[str]:
        """Build a FrameTask per enabled EE. Returns names of any EE whose
        link is missing from the model (skipped)."""
        self.tasks.clear(); self.ee.clear()
        missing: List[str] = []
        for ee in ees:
            if not ee.enabled:
                continue
            if not self.model.existFrame(ee.link):
                missing.append(ee.name); continue
            t = FrameTask(ee.link, position_cost=ee.position_cost,
                          orientation_cost=ee.orientation_cost)
            t.set_target(self.cfg.get_transform_frame_to_world(ee.link))  # hold current
            self.tasks[ee.name] = t
            self.ee[ee.name] = ee
        self.posture = PostureTask(cost=float(posture_cost))
        self._posture_q = self.cfg.q.copy()
        self.posture.set_target(self._posture_q)
        # Re-apply any finger curl into the fresh posture target.
        for side, amt in self._finger_curl.items():
            if amt > 0:
                self.set_finger_curl(side, amt)
        return missing

    def set_obstacles(self, obstacles: List[Dict[str, float]], ee_links: List[str],
                      enabled: bool = True) -> None:
        """Build collision-avoidance barriers. ``obstacles`` are capped
        cylinders {cx, cy, R, zt} (metres). Arm collision spheres are placed
        on each hand end-effector link + its two ancestors (hand small so it
        can reach a cup on the surface; elbow/upper-arm larger to stay clear)."""
        self._obstacle_enabled = enabled
        self._barriers = []
        if not obstacles or not ee_links:
            return
        parents = self.link_parents()
        specs = []
        seen = set()
        for link in ee_links:
            chain, cur = [link], link
            for _ in range(2):
                p = parents.get(cur)
                if not p:
                    break
                chain.append(p); cur = p
            for i, l in enumerate(chain):
                if l in seen or not self.model.existFrame(l):
                    continue
                seen.add(l)
                radius, margin = (0.02, 0.005) if i == 0 else (0.045, 0.01)
                specs.append((l, radius, margin))
        for o in obstacles:
            self._barriers.append(TableBarrier(
                specs, cx=o["cx"], cy=o["cy"], R=o["R"], zt=o["zt"]))

    def _active_barriers(self) -> List[TableBarrier]:
        return self._barriers if self._obstacle_enabled else []

    def _finger_joints(self, side: str) -> List[Tuple[str, int]]:
        """Actuated finger joints for a hand side ('r'/'l') — every phalanx
        of every finger (the tendon-coupled set)."""
        pre = f"{side}_"
        return [
            (jname, idx) for jname, idx in self._q_index.items()
            if jname.startswith(pre) and any(f in jname for f in _FINGER_NAMES)
        ]

    def set_finger_curl(self, side: str, amount: float) -> List[str]:
        """Curl/uncurl a hand. ``amount`` 0=open (fingers extended) → 1=closed
        (fully curled). Every phalanx joint lerps from its open limit to its
        closed limit proportionally — mirroring one servo + tendon driving all
        joints of a finger. Writes the posture target so a solve holds it, and
        the live config so it shows immediately. Returns the joints moved."""
        amount = max(0.0, min(1.0, float(amount)))
        self._finger_curl[side] = amount
        joints = self._finger_joints(side)
        if not joints:
            return []
        q = self.cfg.q.copy()
        pq = self._posture_q.copy()
        for jname, idx in joints:
            lo = self.model.lowerPositionLimit[idx]
            hi = self.model.upperPositionLimit[idx]
            ang = lo + amount * (hi - lo)   # open limit → closed limit
            q[idx] = ang
            pq[idx] = ang
        self._posture_q = pq
        self.posture.set_target(pq)
        self.cfg = Configuration(self.model, self.data, q)
        return [j for j, _ in joints]

    def finger_curl(self) -> Dict[str, float]:
        return dict(self._finger_curl)

    def set_target(self, ee_name: str, xyz_mm: Tuple[float, float, float]) -> None:
        """Aim an end-effector's pendant at a world point (mm)."""
        ee = self.ee.get(ee_name); task = self.tasks.get(ee_name)
        if ee is None or task is None:
            raise KeyError(f"unknown end-effector {ee_name!r}")
        target_m = np.asarray(xyz_mm, dtype=float) / 1000.0
        cur = self.cfg.get_transform_frame_to_world(ee.link)
        if ee.mode == "look_at":
            rot = _look_at_rotation(cur.translation, target_m, np.asarray(ee.forward_axis, float))
            task.set_target(pin.SE3(rot, cur.translation.copy()))  # rotate in place
        else:  # position / pose — keep current orientation (orientation_cost gates it)
            task.set_target(pin.SE3(cur.rotation.copy(), target_m))

    # ─── solving ───────────────────────────────────────────────────────
    def step(self, dt: float = 0.05) -> None:
        tasks = list(self.tasks.values()) + [self.posture]
        v = solve_ik(self.cfg, tasks, dt, solver=_QP, safety_break=False,
                     barriers=self._active_barriers())
        self.cfg.integrate_inplace(v, dt)

    def solve(self, iters: int = 200, dt: float = 0.05) -> None:
        for _ in range(int(iters)):
            self.step(dt)

    def reset(self) -> None:
        self.cfg = Configuration(self.model, self.data, self._q0.copy())
        for side, amt in self._finger_curl.items():   # keep the hands as posed
            if amt > 0:
                self.set_finger_curl(side, amt)

    # ─── readouts ──────────────────────────────────────────────────────
    def joint_angles_deg(self) -> Dict[str, float]:
        q = self.cfg.q
        return {name: math.degrees(float(q[idx])) for name, idx in self._q_index.items()}

    def joint_limits_deg(self) -> Dict[str, List[float]]:
        """``{joint: [lower_deg, upper_deg]}`` for every actuated joint —
        limits already normalised (reversed lower>upper swapped) in
        __init__. Used to auto-fit servo calibration onto a joint's range
        and to show the range in the UI."""
        out: Dict[str, List[float]] = {}
        for name, idx in self._q_index.items():
            lo = math.degrees(float(self.model.lowerPositionLimit[idx]))
            hi = math.degrees(float(self.model.upperPositionLimit[idx]))
            out[name] = [round(lo, 3), round(hi, 3)]
        return out

    def set_joint_angles_deg(self, angles: Dict[str, float]) -> None:
        q = self.cfg.q.copy()
        for name, deg in angles.items():
            idx = self._q_index.get(name)
            if idx is not None:
                q[idx] = math.radians(float(deg))
        q = np.clip(q, self.model.lowerPositionLimit, self.model.upperPositionLimit)
        self.cfg = Configuration(self.model, self.data, q)

    def link_world_positions(self) -> Dict[str, List[float]]:
        """World-frame origin (mm) of every body/link frame — for rendering."""
        out: Dict[str, List[float]] = {}
        for f in self.model.frames:
            if f.type == pin.FrameType.BODY:
                p = self.cfg.get_transform_frame_to_world(f.name).translation
                out[f.name] = [round(float(c) * 1000.0, 2) for c in p]
        return out

    def link_world_poses(self) -> Dict[str, Dict[str, List[float]]]:
        """Full world pose per body/link — position (mm) + quaternion
        [x,y,z,w] — for rigidly skinning the GLB in the 3-D viewer."""
        out: Dict[str, Dict[str, List[float]]] = {}
        for f in self.model.frames:
            if f.type != pin.FrameType.BODY:
                continue
            T = self.cfg.get_transform_frame_to_world(f.name)
            q = pin.Quaternion(T.rotation)
            out[f.name] = {
                "pos": [round(float(c) * 1000.0, 2) for c in T.translation],
                "quat": [round(float(q.x), 6), round(float(q.y), 6),
                         round(float(q.z), 6), round(float(q.w), 6)],
            }
        return out

    def link_parents(self) -> Dict[str, str]:
        """{link: nearest-ancestor link} — static bone list for rendering a
        skeleton in the UI. Computed by walking each BODY frame up to its
        nearest BODY ancestor."""
        frames = self.model.frames
        out: Dict[str, str] = {}
        for f in frames:
            if f.type != pin.FrameType.BODY:
                continue
            p = f.parentFrame
            while p > 0 and frames[p].type != pin.FrameType.BODY:
                p = frames[p].parentFrame
            if p > 0 and frames[p].type == pin.FrameType.BODY and frames[p].name != f.name:
                out[f.name] = frames[p].name
        return out

    def ee_world_pos(self, ee_name: str) -> Optional[List[float]]:
        ee = self.ee.get(ee_name)
        if ee is None:
            return None
        p = self.cfg.get_transform_frame_to_world(ee.link).translation
        return [round(float(c) * 1000.0, 2) for c in p]

    def reach_error_mm(self, ee_name: str) -> Optional[float]:
        task = self.tasks.get(ee_name); ee = self.ee.get(ee_name)
        if task is None or ee is None or ee.mode == "look_at":
            return None
        cur = self.cfg.get_transform_frame_to_world(ee.link).translation
        tgt = task.transform_target_to_world.translation
        return round(float(np.linalg.norm(cur - tgt)) * 1000.0, 2)

    def colliding_links(self) -> List[str]:
        """Links whose collision sphere is currently penetrating an obstacle
        (barrier h < 0). Empty when the arm is clear of the table."""
        bad: List[str] = []
        for bar in self._barriers:
            h = bar.compute_barrier(self.cfg)
            for (frame, _r, _m), hv in zip(bar.specs, h):
                if hv < 0 and frame not in bad:
                    bad.append(frame)
        return bad

    def obstacle_clearance_mm(self) -> Optional[float]:
        """Smallest barrier value across all obstacles (mm) — negative means
        penetration. None when there are no obstacles."""
        vals = [float(bar.compute_barrier(self.cfg).min()) for bar in self._barriers]
        return round(min(vals) * 1000.0, 1) if vals else None

    def limit_violations(self) -> List[str]:
        q = self.cfg.q
        bad = []
        for name, idx in self._q_index.items():
            if not (self.model.lowerPositionLimit[idx] - 1e-6 <= q[idx]
                    <= self.model.upperPositionLimit[idx] + 1e-6):
                bad.append(name)
        return bad
