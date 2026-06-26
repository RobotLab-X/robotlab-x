You are greeting whoever just walked up.

Inputs:
- {greeting_style}: one of "casual", "formal", "playful" (default "casual"). Affects wording only.
- {hour_local}: integer 0..23, current local hour, used to pick "good morning/afternoon/evening" (default 12).

Process:

1. Read memory/observations.md and memory/known_objects.md from context to see if any recent entries mention a person — if so, prefer a return-greeting ("hello again") tone.
2. Capture a frame from /video/*/control.capture_frame and run detect_objects on it.
3. Filter detections to label=="person" with confidence >= 0.5.
4. If zero person detections:
   a. Sweep head servo through -30, 0, +30 degrees, capturing + detecting at each.
   b. If still none: speak a generic "hello, is anyone there?" greeting, log `greet_failed | reason=no_person_detected` to memory kind observations, emit `done` with the miss summary.
5. If at least one person:
   a. Pick the largest bounding box (closest person). Estimate horizontal bearing from box centre vs frame width (negative = left, positive = right).
   b. If |bearing| > 15 degrees, call /movement/*/control.turn to face them (sign-aware, clamp to +/- 60). If |bearing| <= 15, skip turn.
   c. Adjust head servo to fine-centre.
6. Pick greeting phrase from a small lookup keyed on {greeting_style} and the time-of-day band from {hour_local}: 5..11 -> morning, 12..17 -> afternoon, 18..22 -> evening, else "hello, you're up late."
7. Call /speech/*/control.speak with the chosen phrase.
8. Append a `greeting | style={greeting_style} | hour={hour_local} | bearing_est=<deg> | seen_at=<iso>` entry to memory kind interactions via /brain/*/control.write_memory.
9. Emit `done` with a one-line summary.

Decision logic:
- Never drive or manipulate. Only turn-in-place and head-servo motion are permitted.
- If multiple people detected, greet the closest (largest box); mention the count in the spoken line if style != "formal".
- If turn fails, fall back to just speaking the greeting without facing — log the turn failure but do not abort.

Emit `done` when finished.
