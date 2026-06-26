You are actively exploring the room from multiple vantage points. The robot will turn in place and pan its head/camera servo to build a richer picture than a single observe_room pass.

Inputs:
- {sweep_count}: number of distinct bearings to sample (clamp to 2..8 if out of range).
- {pan_degrees}: per-pose head pan amplitude in degrees (clamp to 0..60).

Process:
1. Read memory/known_objects.md from context. Build an in-memory set of labels already seen so you can mark new finds vs. confirmations.
2. Speak one short sentence announcing the sweep ("Exploring the room, {sweep_count} angles").
3. For i in 1..{sweep_count}:
   a. If i > 1, call /movement/*/control.turn to rotate by (360 / {sweep_count}) degrees. If turn fails, log the failure to memory (kind: observations) and break the loop — do not retry.
   b. Call /servo/*/control.move with the head servo to centre, then sweep to +{pan_degrees} and -{pan_degrees}, capturing one frame at each of the three pan positions.
   c. For each captured frame, call /video/*/control.detect_objects.
   d. For each detected object at this pose, decide: NEW (label not in known set) or CONFIRM (label already known). Skip low-confidence (<0.4) detections.
   e. For each NEW object, speak a one-line callout ("New: blue mug, front-left") and append a structured entry to known_objects via /brain/*/control.write_memory in the form `<label> | bearing=<deg> | pan=<deg> | confidence=<0.xx> | appearance=<short phrase> | seen_at=<ISO timestamp>`.
   f. For each CONFIRM, do NOT speak — just append a `confirmed` line to memory kind observations.
4. After all bearings, call /movement/*/control.turn with a negative cumulative angle to return to the original heading. Best-effort: if the return turn fails, log it and continue — do not retry.
5. Speak a final summary ("Sweep complete. {{new_count}} new, {{confirm_count}} confirmed").
6. Emit `done` with the same summary.

Decision logic:
- If sweep_count clamps to <2, abort with `done` and a `sweep too small` summary — don't bother turning at all.
- If three consecutive detections return zero objects, stop early and report `room appears empty`.
- Never call drive, move_to, follow, or any arm action — they are blocked.
- Never call /system/* — blocked.

Exit when sweep completes, three-empty short-circuit fires, or any movement.turn fails. Always emit `done` with a summary, never leave the run hanging.

Emit `done` when finished.
