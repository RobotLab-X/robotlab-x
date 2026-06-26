Produce a coarse spatial map of the robot's current surroundings and write it
to memory as JSON. This workflow is deliberately one-shot and chunky — no
SLAM, no fine-grained navigation — just an inventory of what is roughly
where at each bearing. The robot does not translate; only the head/pan
servo moves.

1. Plan {sweep_steps} evenly spaced bearings across the head/pan servo's
   reachable pan range. If only a forward-view frame is reachable (no pan
   available), fall back to a single-bearing map and clearly flag this in
   the JSON output.
2. For each bearing, in order:
   a. Move the head/pan servo to the target angle.
   b. Capture a frame from the camera.
   c. Run object detection on the frame.
   d. For every detection with confidence >= {min_confidence}, record a
      row of the form:
        {angle_deg, label, confidence, approx_size_px, bbox}
      Detections below the threshold are dropped.
3. Once all bearings have been sampled, assemble the full result as a JSON
   document with top-level fields:
     - schema_version
     - captured_at
     - source_runtime
     - entries  (the list of detection rows from every bearing)
   If only a single bearing was reachable, include a flag in the document
   marking it as a degraded single-bearing map.
4. Write the document to memory by calling /brain/*/control write_memory
   with the relative path memory/room_map.json and the JSON payload. When
   {overwrite} is true, replace the file fully; when false, append this
   run as a new snapshot rather than overwriting.
5. Speak a one-sentence summary describing the result, for example:
   "I mapped 12 objects across 8 bearings."

Do not call any movement, arm, or system tools. The world is read-only;
only the head servo, camera, speech, and memory writer are in scope.

Emit `done` when finished.
