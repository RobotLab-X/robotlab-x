You are searching for one specific object the operator named.

Inputs:
- {target_label}: case-insensitive label to match against detector output (e.g. "red mug", "laptop").
- {min_confidence}: float in 0..1, minimum detector confidence to count as a hit (default 0.55).
- {max_bearings}: int 1..8, maximum number of turn-bearings to try before giving up (default 6).

Process:
1. Read memory/known_objects.md and memory/observations.md from context. If {target_label} already appears in known_objects with a recent bearing, speak "checking last known location" and prefer that bearing first; otherwise start at current heading.
2. Speak "Looking for {target_label}."
3. For attempt in 1..{max_bearings}:
   a. Call /video/*/control.capture_frame then detect_objects.
   b. Scan detection results for any label matching {target_label} (case-insensitive substring match) with confidence >= {min_confidence}.
   c. If matched: speak "Found {target_label} at bearing <deg>, confidence <0.xx>", append a `found | <label> | bearing=<deg> | confidence=<0.xx> | seen_at=<iso>` entry via /brain/*/control.write_memory (kind known_objects), and emit `done`.
   d. If not matched at current pose: sweep head servo +30 and -30 degrees, capture + detect at each, repeat the match check.
   e. If still no match, call /movement/*/control.turn by (360 / {max_bearings}) degrees and loop.
4. If all bearings exhausted with no hit: speak "Could not find {target_label} after {max_bearings} bearings.", append a `not_found | <label> | bearings_tried=<n> | seen_at=<iso>` row to memory kind observations, emit `done` with the miss summary.

Decision logic:
- Stop early on first confident match — do not keep searching.
- If detect_objects fails twice in a row, abort with `done` and `detector unavailable` summary; do not keep retrying.
- Never drive (translation) — only turn in place. Arm and system tools are blocked.
- Sub-threshold matches (confidence below {min_confidence}) are logged but do not count as hits; mention the best near-miss in the failure summary if helpful.

Emit `done` when finished.
