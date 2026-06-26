# robot_kinematics — whole-body multi-chain IK (full InMoov)

ik_solver handles ONE planar chain. A full robot like InMoov is a **tree**:
a common base/torso → waist (shared) → {right arm, left arm}, and torso →
neck → head → eyes. Multiple end-effectors, **shared waist joints**, and
mixed goals (arms reach a pose; head/eyes look-at). This service solves the
whole model at once.

## Engine decision (researched)

**Pinocchio + Pink** (task-based differential IK via QP). The standard
Python stack for multi-chain humanoid IK: Pinocchio loads the URDF and does
the kinematics/Jacobians; Pink expresses goals as **weighted tasks** solved
**simultaneously**, so shared joints are coordinated and joint limits are
respected. Pip-installable wheels, **no ROS**. (InMoov's own community went
single-arm Jacobian → multi-limb → ROS/MoveIt for exactly the limits-handling
reason; Pink gives us that without ROS.)

- ikpy was considered: multiple independent chains, but won't coordinate the
  shared waist and has weak orientation/look-at → not whole-body.
- Keep **ik_solver** as the simple single-arm tool. This is a separate
  service; both share the `ros` URDF importer + the Model Library concept.

### P0 spike result (DONE — validated on the real InMoov URDF)

- `pip install pin-pink quadprog typing_extensions` → imports, no ROS.
- `pin.buildModelFromUrdf(inmoov.urdf)` → nq=53.
- Whole-body solve with `FrameTask(r_hand)` + `FrameTask(l_hand)` +
  `FrameTask(head, orientation)` + `PostureTask` → converges **0.00 mm** on
  reachable targets; shared waist moves to serve both arms; all joints stay
  within limits.
- **Two InMoov gotchas the service must handle:**
  1. **Reversed limits** — 10 joints store `lower>upper` (direction
     encoding). Normalize (swap) on model load or limits are nonsensical.
  2. **Neutral pose violates limits** — clamp the start configuration into
     `[lower, upper]` before solving.

## Architecture

```
ros (URDF/xacro -> flat URDF + rig spec)
        │
        ▼
robot_kinematics  ──load──▶ Pinocchio model ──Pink tasks──▶ joint angles (all joints)
   targets (pendants) per end-effector            │
                                                   ▼
                                          servo fan-out (per-joint calibration)
```

A **rig spec** names the end-effectors and servo map over one URDF:

```jsonc
{
  "rig_id": "inmoov_wholebody",
  "title": "InMoov — Whole Body",
  "urdf": "inmoov.urdf",            // bundled beside the rig, or an abs path
  "base_link": "world",
  "end_effectors": [
    { "name": "right_hand", "link": "r_hand_link", "mode": "position", "position_cost": 1.0, "orientation_cost": 0.0 },
    { "name": "left_hand",  "link": "l_hand_link", "mode": "position", "position_cost": 1.0, "orientation_cost": 0.0 },
    { "name": "head",       "link": "head_link",   "mode": "look_at",  "position_cost": 0.0, "orientation_cost": 0.5 }
  ],
  "posture_cost": 1e-2,
  "calibration": [ /* JointCalibration per actuated joint, pre-filled from ros config.yaml */ ]
}
```

## The pendant (interactive target)

One draggable 3-D target per end-effector (RViz interactive-marker analog).
Drag → publish target → **differential solve each tick** (Pink is built for
this, like MoveIt Servo) → render + optionally drive servos. Modes per EE:
`position` (3-DOF point — right for InMoov's <6-DOF arms), `pose` (6-DOF),
`look_at` (orientation aimed at the point — head/eyes tracking). Signature
demo: point the head's look-at AND a hand's reach at the **same** target —
"look at what you're grabbing." Caveat: <6-DOF arms can't hit arbitrary
orientation → position-primary weighting (the MoveIt "approximate IK"
lesson).

## Wire contract (bus actions)

- `load_rig(id|urdf_path)` → build model, normalize limits, clamp start
- `list_end_effectors` / `set_end_effectors`
- `set_target(ee, x, y, z, mode?)` → update a pendant
- `solve(iters?)` → solve to convergence; publish joint angles + EE poses
- `step(dt?)` → one differential step (smooth dragging)
- `send_to_servos` → fan out calibrated angles to bound `servo@1.0.0` proxies
- state: joint angles, per-joint world positions (for rendering), EE poses,
  targets, per-EE reach error, limit/violation flags

## Build phases

- [x] **P0** — pin-pink spike on real InMoov (validated above)
- [ ] **P1** — service scaffold + solver (`solver.py` Pinocchio+Pink wrapper:
      load, normalize limits, clamp, build tasks, solve/step, FK positions;
      `rig.py` schema; `service.py` SubprocessService)
- [ ] **P2** — targets/pendant API + `look_at` (rotation aiming a link's
      forward axis at the target); continuous `step` solve
- [ ] **P3** — servo fan-out: per-joint `JointCalibration` (pre-filled from
      the ros `config.yaml` servo pins/limits), `send_to_servos`
- [ ] **P4** — modular UI: whole-robot 3-D (iso) view from per-joint world
      positions, draggable per-EE target gizmos, mode toggles, head-tracks-
      hand demo; build bundle
- [ ] **P5** — ship the InMoov whole-body rig (flat URDF + rig spec) as a
      bundled example; backend tests; full suite + FE build; restart

## Caveats / scope

- Arms ~4–5 DOF < 6 → position-primary, approximate orientation.
- Self-collision (arms vs torso/each other) → Pinocchio collision, v2.
- Fingers aren't IK → grasp presets, out of scope.
- Eyes-gaze chain → optional second look-at EE.
