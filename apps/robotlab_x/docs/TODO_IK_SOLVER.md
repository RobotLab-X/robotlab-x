# robotlab_x IK Solver Service — Requirements

A new robotlab_x service that converts a desired end-effector pose
into joint coordinates for a servo-driven robot arm. **Inputs:** a
target `(x, y, z)` in workspace coordinates. **Output:** servo
angles that put the hand there.

The service is **deterministic, stateless, and hardware-free**. It
doesn't drive servos. It doesn't generate PWM. It doesn't watch
cameras. It computes joint angles + publishes them on the bus.
Other robotlab_x services (servo proxies, brain workflows) consume
the output.

This document refines the original PRD draft so it lines up with
how robotlab_x actually works. Items that differ meaningfully from
the original draft are flagged with **▶ delta**.


## Core principle

```
Desired hand location
        │
        ▼
Inverse Kinematics  ── (this service)
        │
        ▼
Joint Angles
        │
        ▼
Motion Controller  ── (existing servo@1.0.0 instances)
        │
        ▼
Servo commands     ── (existing arduino@1.0.0 / firmata)
        │
        ▼
Physical Robot Arm
```

Separation of concerns: planning, kinematics, trajectory generation,
and hardware control stay modular and independently replaceable.


## Where it fits in robotlab_x ▶ delta

| Original PRD | Refined for robotlab_x |
|---|---|
| Standalone FastAPI service with `POST /ik/solve` | A robotlab_x service (`ik_solver@1.0.0`), **subprocess** (numpy/scipy are heavy enough to want venv isolation) |
| HTTP request/response | Bus actions on `/ik_solver/{id}/control`: `solve`, `fk`, `set_model`, `set_calibration`, `set_target`, `send_to_servos` |
| Pydantic models for request/response | Same; we already use Pydantic for `ServiceConfig` |
| Robot description as a top-level config file | Robot description **IS** `ServiceConfig` — persisted via the existing config_patch/config_state machinery, edited via the standard config wizard |
| Servo calibration as a separate yaml block | Calibration is per-servo — discovered from each linked `servo@1.0.0` proxy's config (which already has `min_angle` / `max_angle` / etc) |
| Servo commands "left to a downstream service" | We can **optionally** dispatch the computed joint angles to the linked servo proxies via their existing `write` action — fire-and-forget by default |
| Direct camera / vision integration | Out of scope; brain workflows or a future planner is the consumer that calls `solve` and decides what to do with the answer |

Net effect: about a third of the components in the original PRD
(HTTP server, JSON-schema request/response models, separate config
file loader, separate calibration block) become "use what's already
there" because robotlab_x has those primitives.


## Service shape

```
type:                ik_solver
version:             1.0.0
language:            python
host:                subprocess  (numpy + scipy dependency footprint)
implements:          ik_provider       — abstract capability so future
                                          planners can discover any IK
                                          service by capability instead
                                          of by type name
requires:            [servo_controller] — soft dep; the solver itself
                                          doesn't need servos to RUN
                                          (it's pure math), but the
                                          "send_to_servos" affordance
                                          uses any linked servo proxies
icon.svg
package.yml
pyproject.toml      [numpy, scipy, (optional) ikpy]
src/
  ik_solver_service/
    __init__.py
    __main__.py
    service.py
    model.py        — robot model (DH params, joint limits, link lengths)
    fk.py           — forward kinematics
    ik.py           — inverse kinematics (analytic + numerical fallback)
    calibration.py  — math angle ↔ servo angle mapping
```


## Topics

```
/ik_solver/{id}/state           retained — current model + last solution + last target
/ik_solver/{id}/control         incoming actions
/ik_solver/{id}/solution        non-retained — emitted every time solve() completes (success OR failure)
/ik_solver/{id}/heartbeat       1Hz auto (base class)
/ik_solver/{id}/meta            retained — service-type meta (auto)
```

`/solution` is a stream — every `solve` call produces one event. The
UI subscribes to it for live updates while the operator drags the
target around. `/state` carries the LAST solution as a snapshot for
late subscribers.


## Actions on `/control`

| Action | Payload | Effect |
|---|---|---|
| `solve` | `{target: {x, y, z}, orientation?: {roll, pitch, yaw}}` | Run IK; publish `/solution`; return joint angles in reply. |
| `fk` | `{joint_angles: {base, shoulder, elbow, ...}}` | Run FK; return resulting `(x, y, z, roll, pitch, yaw)`. Useful for verifying `FK(IK(target)) ≈ target`. |
| `set_model` | full robot model (links + joints, see below) | Replace the current model. Persists to config. Republishes `/state`. |
| `set_calibration` | per-joint calibration block | Update calibration. Persists. |
| `link_servo` | `{joint: "shoulder", proxy_id: "servo-1"}` | Bind a logical joint to a live `servo@1.0.0` proxy. |
| `unlink_servo` | `{joint: "shoulder"}` | Detach. |
| `send_to_servos` | optional `{joint_angles: {...}}` — defaults to the last computed solution | For each linked joint, publishes `{action: "write", angle: <calibrated>}` to that servo's `/control`. Fire-and-forget. |


## Robot model — `IKSolverConfig`

Persisted in the standard way (`ServiceConfig`); edited via the
config wizard. **No robot dimensions are hardcoded.**

```python
class JointSpec(BaseModel):
    name: str               # "base", "shoulder", "elbow", "wrist"
    type: Literal["revolute", "prismatic"] = "revolute"
    # Mathematical limits in degrees. Servo calibration applies on top
    # of these (the math may say 0..180 but the physical servo only
    # has 20..160 of safe travel).
    min_deg: float
    max_deg: float

class LinkSpec(BaseModel):
    length_mm: float        # distance to the next joint (DH a-i or d-i)

class JointCalibration(BaseModel):
    """Maps mathematical joint angle → servo command angle.

    A servo mounted upside-down has direction=-1; one offset from
    zero has zero_offset_deg=<the offset>. Computed by the operator
    once during setup; persists with the solver.
    """
    joint: str               # references JointSpec.name
    servo_proxy_id: Optional[str] = None   # linked servo, when bound
    zero_offset_deg: float = 0.0
    direction: Literal[-1, 1] = 1
    # PWM extents stay on the SERVO proxy (it owns the pin); the
    # solver doesn't issue PWM directly.

class IKSolverConfig(ServiceConfig):
    joints: List[JointSpec] = Field(default_factory=list)
    links: List[LinkSpec] = Field(default_factory=list)
    calibration: List[JointCalibration] = Field(default_factory=list)
    # Workspace coordinate convention. Right-handed; +Z up; origin
    # at the robot's mounting point. Documented + non-negotiable so
    # the UI's rendering matches reality.
    coordinate_frame: Literal["right_handed_z_up"] = "right_handed_z_up"
    # Tolerances for "FK(IK(t)) ≈ t" validation.
    position_tolerance_mm: float = 2.0
    angle_tolerance_deg: float = 0.5
```


## Forward kinematics

`fk(joint_angles) → (x, y, z, roll, pitch, yaw)`

Used for:
* simulation
* test verification (`FK(IK(target))` round-trip)
* the UI visualisation (rendering the arm requires FK on the current angles)
* debugging IK failures

Implementation: standard DH chain. Uses numpy. ~50 lines.


## Inverse kinematics

`ik(target_pose) → joint_angles | failure(reason)`

**Strategy:**
1. **Analytic solution** when the geometry permits (planar arms, 3-DOF
   shoulder-elbow-wrist with known offsets). Closed-form, fastest,
   deterministic.
2. **Numerical fallback** when analytic isn't available — Jacobian
   transpose or Levenberg-Marquardt via scipy. Returns the
   lowest-cost branch.

**Failure modes returned cleanly (not raised):**
* `unreachable_workspace` — target outside max-extension sphere or below floor plane
* `joint_limit_violation` — the math has a solution but at least one joint exceeds `min_deg`/`max_deg`
* `singular_configuration` — Jacobian rank-deficient at target
* `solver_did_not_converge` — numerical fallback exhausted iterations

**Per the PRD's tolerances:**
* Positional error: target < 2 mm, accept < 5 mm
* Angular error: ± 0.5°


## Servo calibration layer

The solver always returns BOTH the mathematical joint angle and the
calibrated servo angle so the consumer (brain, planner, UI) sees
both representations. Calibration formula per joint:

```
servo_angle = (joint_angle * direction) + zero_offset_deg
```

`send_to_servos` action applies this conversion before publishing
to each linked servo's `/control`. The servo proxy further clamps
the value to its own `min_angle`/`max_angle` envelope, so two layers
of clamping protect the hardware.


## Solution payload

Success:
```json
{
  "reachable": true,
  "target": {"x": 230, "y": 120, "z": 310},
  "joint_angles": {
    "base":     {"math": 31.2, "servo": 121.2},
    "shoulder": {"math": 42.7, "servo": 137.3},
    "elbow":    {"math": 81.9, "servo":  98.1},
    "wrist":    {"math": -17.4, "servo": 72.6}
  },
  "position_error_mm": 0.4,
  "ts": 1781234567.123
}
```

Failure:
```json
{
  "reachable": false,
  "target": {"x": 1000, "y": 0, "z": 0},
  "reason": "unreachable_workspace",
  "detail": "Target distance 1000mm exceeds max extension 340mm",
  "ts": 1781234567.123
}
```


## Coordinate system

```
          +Z
           │
           │
           │
           │
           O──── +X
         /
      +Y
```

Right-handed, +Z up, origin at the base. All units **mm + radians
internally; degrees + millimetres at the API surface** for
readability. The UI labels axes accordingly.


## Service UI — visualisation + drive ▶ delta (NEW vs PRD)

The PRD didn't specify a UI. robotlab_x services live or die by
their per-instance Composer panel — for IK this is critical because
the math is otherwise invisible. Every service shape (`view_min` /
`view_name_and_type` / `view_full` / optionally `view_basic`) is
registered in `serviceViews/index.ts` and rendered automatically.

### `serviceViews/IKSolver.tsx` — the Full view

Three regions stacked vertically:

```
┌────────────────────────────────────────────────────────────┐
│ ik-solver-1            ● connected · 4 joints              │
│                                  Min/NT/Full kebab + chips │
├────────────────────────────────────────────────────────────┤
│  ┌────────── side view ─────┐  ┌────── top view ───────┐   │
│  │  ↑Z                       │  │  ↑Y                   │   │
│  │                           │  │                       │   │
│  │     ●──●──●  ← current    │  │     ●──●──●           │   │
│  │     │    \  ← target  ✕   │  │     │    \   ✕        │   │
│  │     ●                     │  │     ●                 │   │
│  │  ────────── X →           │  │  ────────── X →       │   │
│  └───────────────────────────┘  └───────────────────────┘   │
├────────────────────────────────────────────────────────────┤
│ TARGET   x [  230] mm    [solve]   ● reachable, err 0.4mm  │
│          y [  120] mm                                      │
│          z [  310] mm    [send to servos]                  │
│                                                            │
│ JOINTS  base       31.2°  → servo  121.2°  ●linked servo-1 │
│         shoulder   42.7°  → servo  137.3°  ●linked servo-2 │
│         elbow      81.9°  → servo   98.1°  ○ unlinked      │
│         wrist     -17.4°  → servo   72.6°  ●linked servo-4 │
└────────────────────────────────────────────────────────────┘
```

**Visualisation:**
* Two synchronised orthographic projections — side (XZ) and top (XY) —
  rendered with SVG. Each joint is a filled circle, each link a
  straight line connecting them. Pixel-per-mm scale derived from the
  arm's `sum(link.length_mm)` so the whole reachable envelope fits.
* The CURRENT arm pose is solid emerald; the TARGET pose (if the
  operator has solved one but not committed) is dashed amber, with
  the target point itself marked with a small `✕`.
* Reachability circle / floor plane drawn as guides.
* SVG is enough — no Three.js dependency for v1. A 3D upgrade is
  reasonable later but adds ~150 KB of bundle.

**Interaction:**
* Numeric inputs for `x`, `y`, `z` (mm). Bound to a draft state;
  pressing **Solve** publishes a `solve` action with `reply_to`. The
  reply or a `/solution` message drives the visual update.
* **Click on either projection** to set the target's X/Z (side) or
  X/Y (top) by canvas position. Convenient for "point and ask".
* **Send to servos** button — visible only when the latest solution
  is reachable AND at least one joint is linked to a servo. Publishes
  `send_to_servos` action.
* **Joint table** — each row shows joint name, current math angle,
  current servo angle, link status. Click a `●linked` row to
  unlink; click `○ unlinked` to open a dropdown of running
  `servo@1.0.0` proxies and bind one.

**Live state:**
* Subscribes to `/ik_solver/{id}/state` (model + last solution).
* Subscribes to `/ik_solver/{id}/solution` (event stream — drives
  the amber→emerald transition when a fresh solve resolves).
* Optional: subscribes to each linked servo's `/state` so the
  rendered arm reflects the ACTUAL servo position (not just the
  last commanded angle). When the operator drags a servo manually
  via its Basic view, the IK panel's emerald arm follows.

### Other view shapes

* `view_min` — pill: icon + name + ● if all joints linked + small "Nj"
  joint count.
* `view_name_and_type` — default card; nothing extra.
* `view_basic` (servo-style compact) — optional v2 polish: three
  sliders (x, y, z) + Solve + Send. Same `shouldOffer` gate as
  Servo's Basic view so it only appears on `ik_solver@*` nodes.


## Workspace validation

The solver rejects requests that violate:
* maximum reach (target distance > `sum(link.length_mm)`)
* minimum reach (target inside the dead-zone the elbow can't reach)
* joint limits (any angle outside `min_deg..max_deg`)
* impossible geometry (links sum to zero, no joints defined, etc.)

Error messages are returned in the `reason` field, not raised, so
the UI can render them as a banner without a stack trace surfacing
in the operator's face.


## Test cases (`tests/test_ik.py`)

1. Reach directly in front of the robot (`(L, 0, 0)`).
2. Reach straight up (`(0, 0, L)`).
3. Reach maximum extension; verify `position_error_mm < 5`.
4. Reach minimum extension; verify `position_error_mm < 5`.
5. Reach outside workspace — expect `reachable: false, reason: unreachable_workspace`.
6. Reach below base plane — expect failure when configured no-go.
7. Reach near singularities — expect either valid solution OR clean failure (never a NaN).
8. **Round-trip:** `FK(IK(target)) ≈ target` within `position_tolerance_mm`.
9. **Joint limits:** every angle in every success path obeys configured limits.
10. **Calibration:** verify `servo_angle = joint_angle * direction + zero_offset_deg` for a few hand-checked configurations.

All run from `tests/` against a fixture robot model — no hardware
needed.


## Effort breakdown

| Phase | Scope | Estimate |
|---|---|---|
| 1 | Service skeleton (package.yml, pyproject, `__main__`, `service.py`), bus actions stubbed | 1 hr |
| 2 | `model.py` + `fk.py` + analytic IK for 3-DOF shoulder-elbow-wrist | 4 hr |
| 3 | Numerical fallback via scipy (Levenberg-Marquardt) | 3 hr |
| 4 | Calibration layer + `send_to_servos` action | 2 hr |
| 5 | `serviceViews/IKSolver.tsx` — side+top SVG views, target inputs, solve/send buttons, joint table | 6 hr |
| 6 | Live integration with linked `servo@1.0.0` proxies (subscribe to their `/state` for real-arm rendering) | 2 hr |
| 7 | Test suite (10 cases above) | 2 hr |
| 8 | Optional: `view_basic` shape; 3D Three.js upgrade | deferred |

Total v1: **~20 hours**.


## Extensibility — what's deliberately not in v1

* Orientation (roll/pitch/yaw constraints) — fields are in the API
  envelope but the v1 solver only honours position.
* 6-DOF manipulators — v1 is for 3-DOF shoulder-elbow-wrist + base.
* Multiple ranked IK solutions — v1 returns the lowest-cost branch.
* Tool-center-point (TCP) offsets — add a virtual extra link in
  the config when needed.
* Trajectory generation — separate concern; brain workflows can call
  `solve` repeatedly along a path.
* Collision detection — out of scope.


## Open questions

1. **Default robot geometry?** The first ship should boot with SOME
   model so a fresh install can `solve` immediately. Pick a generic
   3-DOF arm (e.g. 180 mm + 160 mm + 100 mm links, base + shoulder +
   elbow + wrist) and ship it as the `IKSolverConfig` defaults.
2. **Linking joints to servos — by name or by drag?** The Composer
   already has a "drag a servo proxy onto a target" affordance for
   workspaces. Reusing that gesture for "drag servo onto an IK
   joint row" is consistent but needs a tweak to the drop handler.
   Alternative: dropdown picker in the joint table. Start with
   dropdown for v1.
3. **3D view?** Probably worth it eventually but adds Three.js
   (~150 KB) for what's mostly a debugging surface. v1 side+top
   SVG is enough for `(x, y, z)` work and uses no extra deps.


## High-level principle (restated)

The service transforms high-level spatial intent into robot
configuration:

```
Operator picks a point in space
        │
        ▼
ik_solver computes joint angles
        │
        ▼
servo proxies translate to PWM via firmata
        │
        ▼
arduino writes pins
        │
        ▼
Physical motion
```

The IK service is the planning ↔ kinematics boundary. It owns the
math + the model. It doesn't own the hardware. That separation is
what keeps each layer testable + independently replaceable.
