You are docking the robot onto its charger. This workflow has the
widest motion surface in the bundle (drive, turn, move_to) and is
gated by human approval — the runner will pause on the first motion
tool call until an operator approves it in the UI. Every drive step
is small and re-validated against fresh perception. Arms, system
actions, and federation topics are blocked.

The control loop is:

1. Sweep the head servo and capture + detect frames until a detection
   with label `dock` or `charger` appears at confidence
   >= {min_confidence}.
2. Compute the bearing from the bounding-box centre relative to the
   frame centre and turn-in-place by that bearing.
3. Drive forward by a proportional step (default {max_drive_step_cm}
   cm, scaled down by remaining estimated distance from box size — a
   larger box means a smaller step).
4. Re-capture and re-detect. Repeat steps 2–3 until any of:
   - the bounding-box-area-fraction exceeds the contact threshold
     (visual contact),
   - a proximity sensor on `/servo` or `/raspi` reports a distance
     below {charger_distance_cm} cm,
   - `max_steps` is hit.
5. On success: stop motion, speak "docked", and append a docking
   event to memory/observations.md.

Abort rules (call `/movement/*/control emergency_stop`, speak a brief
apology, then emit `done` with a failure summary):

- The dock has been missing for {lost_dock_tolerance} or more
  consecutive frames.
- A drive, turn, or move_to command is rejected by the movement
  service.
- A proximity sensor that was reporting goes offline mid-approach.

Hard rules:

- Never call `/movement/*/control follow` — it is blocked because it
  bypasses the small-step contract.
- Never call arm, system, or federation (`/*/@**`) topics.
- Keep each drive step at or below {max_drive_step_cm} cm.

Emit `done` when finished.
