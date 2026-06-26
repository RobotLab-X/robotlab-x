# ik_solver — Model Library (browse / load / save / poses)

Enhance ik_solver so operators can **browse and load** robot models, ship
**pre-loaded examples** (InMoov) that are clearly accessible, and **save a
model out with the current (initialized) pose**. One cohesive feature: a
*Model Library*.

## Locked decisions

- **Storage scope:** shared — one user library at
  `<data_dir>/ik_solver/models/*.json` that any ik_solver instance can load,
  plus bundled examples. Servo bindings stay per-instance (merged by joint
  name on load, reusing `set_model`'s existing calibration migration).
- **Poses:** named-pose library per model — `poses: [{name, is_initial,
  angles}]`, one flagged initial and applied on load.
- **API:** ik_solver `@service_method`s (no new REST); state retained so the
  modular UI just renders.
- **Split:** portable geometry/poses vs per-instance servo bindings.

## Model artifact (`schema_version: 1`)

A model is a portable JSON file:

```jsonc
{
  "schema_version": 1,
  "id": "inmoov_right_arm",
  "title": "InMoov — Right Arm",
  "description": "...",
  "source": "inmoov_ros (URDF) -> ros.convert",
  "units": { "length": "mm", "angle": "deg" },
  "ik_model": { "joints": [/*JointSpec*/], "links": [/*LinkSpec*/] },  // today's solver
  "chain":    [ /* rich per-joint origin/axis/limits */ ],            // future 3-D solver
  "calibration_template": [ /* JointCalibration WITHOUT servo_proxy_id */ ],
  "poses": [ { "name": "home", "is_initial": true, "angles": {"base":0,...} } ]
}
```

`ik_model` runs on the current planar solver; `chain` rides along for the
future general 3-D solver. `calibration_template` carries
offsets/direction/scale/servo-range but no `servo_proxy_id` (those are
per-rig and merged in by joint name on load).

## Storage & resolution

| Root | Location | Writable | Notes |
|---|---|---|---|
| Bundled examples | `repo/ik_solver/1.0.0/src/ik_solver_service/examples/*.json` | read-only | ship inside the package → resolved via `__file__` (editable install ⇒ always present, dev + deploy) |
| User models | `<data_dir>/ik_solver/models/*.json` | yes | shared across instances; survives reinstall (persistent volume) |

The subprocess can't resolve the relative `ROBOTLAB_X_DATA_DIR` (its cwd
differs from the backend's), so the process manager injects an absolute
`ROBOTLAB_X_DATA_DIR_ABS` (additive; benefits every subprocess service).
User model id collisions shadow bundled (brain workflow semantics).

## Working state vs library

`IKSolverConfig` holds the **live working model** (joints/links/calibration +
`model_id/title/source`, `chain`, `poses`) and persists across restart.
Library files are snapshots: `load_model` reads file → config; `save_model`
serializes config → user file. `_current_angles` tracks the live pose
(updated by `solve`, `fk`, `apply_pose`, and seeded from the initial pose on
load); `save_pose` captures it.

## Method surface (bus actions on ik_solver)

- `list_models` → `[{id,title,source,root:"bundled"|"user",pose_names:[...]}]`
- `load_model(id)` → resolve across roots → `set_model` + calibration-merge → seed initial pose
- `save_model(id,title?,include_current_pose?)` → write user file from config
- `delete_model(id)` → user root only
- `export_model(id)` → return JSON (UI offers Download)
- `save_pose(name,set_initial?)` / `apply_pose(name)` / `delete_pose(name)`

## Build phases

- [ ] **P1 — schema + library backend**
  - process_manager: inject `ROBOTLAB_X_DATA_DIR_ABS`
  - new `ik_solver_service/models_lib.py`: `RobotModel` schema, bundled/user
    dir resolution, `list/load/save/delete` + JSON IO
  - `IKSolverConfig`: add `model_id`, `model_title`, `model_source`, `chain`,
    `poses`
  - `service.py`: `list_models/load_model/save_model/delete_model/export_model`
  - `ros.convert`: emit the `RobotModel` JSON shape so imports drop into the library
- [ ] **P2 — named-pose library**
  - `Pose` model + `poses[]`; `save_pose/apply_pose/delete_pose`
  - `_current_angles` tracking; initial-pose seeding on load;
    `include_current_pose` on `save_model`
- [ ] **P3 — UI Model Library panel** (`ui/View.tsx`)
  - "Examples" (bundled) vs "Your models" (user); load / save / save-as /
    capture-pose / download; rebuild `ui/dist/ui.js`
- [ ] **P4 — bundled InMoov examples + tests**
  - generate + commit `examples/inmoov_right_arm.json` (and `inmoov_head.json`)
    via the `ros` service
  - backend tests (models_lib round-trip, two-root list/shadow, pose seed);
    full app suite + FE build; restart backends

## Out of scope (later)

- General 3-D solver consuming `chain` (Phase 2 of the IK roadmap) — the
  schema already carries `chain` so models don't need re-importing.
- Pose playback / sequencing.
