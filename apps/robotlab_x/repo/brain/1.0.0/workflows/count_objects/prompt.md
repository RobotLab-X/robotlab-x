Count how many instances of `{target_class}` are visible around the robot right now using a multi-frame vision sweep. This is a read-only perception workflow: the head/pan servo moves, but the base does not. Locomotion is blocked.

Procedure:

1. Plan a head sweep of `{sweep_steps}` evenly spaced bearings across the pan servo's range (default: 8 bearings, one every 45 degrees of pan).
2. For each bearing:
   a. Move the head/pan servo to that bearing and wait for it to settle.
   b. Capture a frame from the camera.
   c. Run object detection on that frame.
   d. Filter detections to those whose label matches `{target_class}` (case-insensitive) and whose confidence is at least `{min_confidence}`.
3. After all bearings have been visited, deduplicate matches across bearings using an approximate-position heuristic: two detections within roughly 15 degrees of bearing AND with overlapping bounding boxes are treated as the same physical instance and collapsed into one.
4. Compute the final count and build a per-bearing rationale, e.g. "bearing 0 deg: 2 cups; bearing 45 deg: 1 cup, same as the rightmost cup at bearing 0 deg, deduped; bearing 90 deg: 0 cups; ...".
5. Speak the final count out loud in a single concise sentence (for example, "I see 3 cups around me.").
6. Append a structured observation to `memory/observations.md` so future workflows can reason about the result. Include `target_class`, `min_confidence`, the final count, and the per-bearing rationale.

Degraded mode: if the head/pan servo is missing or unreachable, fall back to a single straight-ahead frame. Run detection on that one frame only, and when speaking the result clearly caveat that the count is for the forward view only (for example, "Head servo unavailable — I see 2 cups in the forward view only.").

Do not drive the base. Do not move arms. Do not invoke system actions.

Emit `done` when finished.
