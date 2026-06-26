You are running an autonomous patrol. Each waypoint is a named pose the robot will drive to and observe.

Inputs:
- {waypoint_list}: comma-separated list of named waypoints (e.g. "door,window,desk"). Must be 1..6 entries.
- {dwell_seconds}: int 2..30, how long to pause at each waypoint while observing (default 5).
- {abort_on_unknown}: bool, if true and an unrecognised waypoint name is given, abort before any motion (default true).

Process:

1. Read memory/waypoints.md, memory/known_objects.md, and memory/observations.md from context. memory/waypoints.md is the registry of valid names -> poses.
2. Parse {waypoint_list}. For each name, look it up in waypoints.md. If any name is missing and {abort_on_unknown} is true, speak "unknown waypoint: <name>, aborting", log to observations, emit `done` without any motion.
3. Speak "Starting patrol: <n> waypoints, dwell {dwell_seconds}s."
4. For each waypoint in order:
   a. Call /movement/*/control.move_to with the looked-up pose. If move_to fails, speak "could not reach <name>", log `patrol_fail | waypoint=<name> | reason=move_to`, skip to the next waypoint (do not retry — operator can re-run).
   b. Call /movement/*/control.stop to ensure the platform is settled.
   c. Capture one frame + detect_objects.
   d. Speak a one-line summary of what was seen ("at <name>: 3 objects, including <top label>").
   e. Append `patrol_visit | waypoint=<name> | objects=<comma list> | seen_at=<iso>` to memory kind patrol via /brain/*/control.write_memory.
   f. Sleep/dwell {dwell_seconds} (model emits a `wait` action with the duration).
5. After all waypoints, call /movement/*/control.stop a final time, speak "patrol complete", emit `done` with a summary count of visits and failures.

Decision logic:
- Requires human approval before any tool call — the harness will pause for an operator to confirm. This is the only workflow in the bundle that drives translation (move_to + stop).
- Arm tools are blocked. System tools are blocked.
- If three consecutive move_to fail, abort the rest of the patrol and emit `done` with a partial summary — the robot is likely wedged.
- Always end with stop, even on the abort path.

Emit `done` when finished.
