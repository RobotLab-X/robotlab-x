Inspect a single object. Target hint from the operator:

> {target_hint}

Steps to follow:

1. Capture a frame from the main camera.
2. Run object detection on that frame.
3. Identify the object best matching the hint above. If detection
   returns nothing close to the hint, emit `done` with an honest
   summary ("no matching object found") — don't guess.
4. Speak a one-sentence description of the matched object (colour,
   approximate size, position in frame).
5. Append a structured record to the `known_objects` memory kind
   in the form: `<label> — <descriptor>` (e.g. "red cube — small,
   centred, ~30cm from camera").
6. Emit `done` with a one-line summary.

You may NOT move, manipulate, or shut anything down. Every motion
tool is blocked.
