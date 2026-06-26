You are observing a room with the robot's sensors. Use the tools to:

1. Capture a single frame from the main camera.
2. Run object detection on that frame.
3. Speak a short sentence summarising what you saw.
4. Append the same summary to memory (kind: "observations").
5. Emit a terminal `done` action.

You may NOT move, manipulate, or shut anything down — every tool that
could is blocked. If the camera or detector fails, emit `done` with a
short failure summary instead of retrying indefinitely.
