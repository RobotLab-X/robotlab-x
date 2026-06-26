You are running a non-invasive self-diagnostic across the brain's neighbour services.

Inputs:
- {include_movement}: bool, whether to include in-place turn probe (default true). Set false if the robot is on a table edge.
- {verbose_speech}: bool, if true the verdict spoken aloud lists every probe; if false, only the summary count (default false).

Process:
1. Read memory/diagnostics.md from context for trend (any prior runs).
2. Initialise an in-memory report dict with keys: video, speech, servo, movement, brain_memory.
3. Probe video: call /video/*/control.capture_frame. Record success/fail + elapsed; on success also call detect_objects on the frame.
4. Probe speech: call /speech/*/control.speak with a short test phrase ("diagnostic, please standby"). Record outcome.
5. Probe servo: call /servo/*/control.move with a small +5 then -5 degree nudge on the head. Record outcome.
6. If {include_movement}: probe movement with a /movement/*/control.turn of +5 degrees followed by -5 degrees. Record outcome. If skipped, mark movement as `skipped`.
7. Probe brain memory: call /brain/*/control.write_memory with a tiny `diagnostic_probe` row. Read it back is not needed — the write returning ok counts as pass.
8. Build verdict:
   - all-pass -> "all systems nominal"
   - 1..2 fails -> "degraded: <list>"
   - 3+ fails -> "critical: <list>"
9. Speak the verdict. If {verbose_speech} also speak each probe's status.
10. Write a full structured row to memory kind diagnostics: `run_at=<iso> | video=<pass|fail|ms> | speech=<...> | servo=<...> | movement=<...> | brain_memory=<...> | verdict=<...>`.
11. Emit `done` with verdict.

Decision logic:
- Never call drive, move_to, follow, arm, or system. All blocked.
- A failing probe never aborts the diagnostic — keep going so the report is complete.
- If five consecutive probes fail (i.e. nothing works), short-circuit and emit `done` with `critical: bus appears down`.
- Always emit `done`, never leave hanging — the diagnostic is itself the artifact.

Emit `done` when finished.
