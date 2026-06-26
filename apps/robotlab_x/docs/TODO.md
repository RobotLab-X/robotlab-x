
What I'd do instead


Auto generate command line interface information for tools for llm

Kinematic service with llm training or ml to learn, input and compute matrices of output

Five cameras pointed at and move in Fab Lab to determine success and to train using the llm and machine learning

Fermata needs good on board speed control and dynamic. Switching of devices for low memory


  Three small, cheap moves that get most of the "uniformity" win without converting anything:

  1. Make in-process services survive a backend restart, OR document explicitly that they don't. Today clocks die on
  restart and reconcile_running_proxies re-spawns them. That's correct but only because clocks are stateless. If we
  later add an in-process service that holds state, this gets surprising. Either accept the rule ("in-process services
  are restartable, not persistent") and document it, or add an in-process equivalent of the subprocess hello so the
  discovery listener can confirm.
  2. Drop the @service_method duplication. Arduino redefines service_method locally because rlx_bus is intentionally
  generic. Move the decorator + MethodInfo to rlx_bus.methods so subprocess services can use the same decorator as
  in-process. The Service base class still imports from framework; the framework re-exports from rlx_bus. Then "how to
  expose a discoverable method" is one paragraph in the docs regardless of transport.
  3. Ship a SubprocessService helper in rlx_bus that mirrors Service's shape (on_start, on_stop, publish, subscribe,
  @service_method discovery). Today arduino does this by hand. With a helper, writing a subprocess service is the same
  code as writing an in-process one — just main() becomes SubprocessService.run(MyService). That's the real ergonomic
  win, and it lets you defer the "convert clock/echo to subprocess" question forever because the cost of doing so when
  you actually need it becomes trivial.

  So: don't normalize transports — normalize the authoring experience. The transport split is fine where it is.

  If at some point one of clock/echo grows real deps or starts owning hardware, you'd convert that one to subprocess in
   isolation. No big-bang migration needed.

---
remove the repo cards "Uninstall" button, and place it on the catalog cards - this looks out of sync, as they should be views on the same thing except one is called repo and the other catalog,
  find the most constant name and normalize on it. Also i notice a difference in status of an "INSTALL" button in the catalog and "Installed" for the same service in the repo ... all actions and
  repo related status (e.g. if a service type is installed) should be in the catalog page
---

## Possible new service types

### `video` (subprocess) + the **stream channel** primitive

The bus is correct for coordination, wrong for media. JSON payloads over WS
mean frames base64-bloat by 33%; per-subscriber bounded queues hold a copy
of every frame in flight; federation forwards bus messages through the same
WS pipe peers use for control. Don't try to make the bus carry video.

**Architecture: streams as a new primitive.** The bus stays the coordination
plane (control + metadata + low-rate thumbnails); a separate **media plane**
carries frames with its own transports. Streams are addressable like topics,
discoverable via the bus, transported separately.

```
Bus (existing)                         Streams (new)
─────────────────                      ─────────────
control:    /video/cam-1/control       media transports:
state:      /video/cam-1/state           • MJPEG over HTTP
thumbnail:  /video/cam-1/thumbnail       • WebRTC
discovery:  /stream/index/cam-1 (R)      • shm (same-host)
                                         • low-rate bus topic
```

**Discovery message** (retained on `/stream/index/<id>`):

```json
{
  "stream_id": "video/cam-1",
  "producer_id": "cam-1@witty-gizmo",
  "kinds": ["mjpeg", "webrtc", "frames_low"],
  "format": "h264",
  "resolution": [1280, 720],
  "fps": 30,
  "endpoints": {
    "mjpeg":      "http://witty-gizmo.local:8998/v1/stream/cam-1/mjpeg",
    "webrtc":     "http://witty-gizmo.local:8998/v1/stream/cam-1/webrtc/offer",
    "frames_low": "/video/cam-1/frame_sample"
  }
}
```

**Transports:**

| Transport | Latency | Browser-native | Multi-consumer | Phase |
|---|---|---|---|---|
| MJPEG over HTTP | 200–500ms | yes (`<img src>`) | yes | **1** |
| Low-rate bus frames | bus latency | yes | yes | **1** |
| WebRTC | 50–150ms | yes (native) | yes (one PC each) | **2** |
| Shared memory | <5ms | no | same-host only | 3 |

- **MJPEG:** `GET /v1/stream/<id>/mjpeg` returns
  `multipart/x-mixed-replace`. Browser-native, no JS, no extra deps beyond
  cv2. Auth via query-param token or Authorization header.
- **Low-rate bus frames:** 320×240 JPEG @ 2Hz on `/video/<id>/frame_sample`,
  base64 in payload. For CV/ML consumers that don't need realtime.
- **WebRTC (Phase 2):** SDP offer/answer over HTTP, ICE candidates over the
  bus. `aiortc` dep. P2P media, no TURN needed for LAN.
- **shm (Phase 3):** same-runtime CV consumers, only if benchmarks demand it.

**Federation:** stream announcements are bus messages → cross-runtime
discovery is free. Endpoint URLs use the producer's mDNS hostname
(`<runtime-id>.local`) so consumer browsers/services resolve them directly.
Shared `JWT_SECRET_KEY` makes the same token work across peers (same trust
model as the multi-runtime UI). For WebRTC across NAT, signaling rides the
bus, media is P2P.

**Why not ROS-style binary on one bus:** redesigning serialization +
federation transport + per-consumer fanout for one use case (media) when a
separate transport sidesteps all of it.

**Why not WebRTC-only:** overkill for thumbnails; hard for CV services that
want `np.ndarray`s not RTP; recording becomes a transcode problem.

**Author API sketch:**

```python
class VideoService(SubprocessService):
    async def on_start(self):
        self.stream = self.register_stream(
            stream_id="cam-1",
            kinds=["mjpeg", "frames_low"],
            resolution=(1280, 720),
            fps=30,
        )
        cap = cv2.VideoCapture(self.config["source"])
        while not self.stopping:
            ok, frame = cap.read()
            if not ok: continue
            self.stream.push(frame)  # framework fans out per kind
```

Framework owns: lazy MJPEG handler spawn, low-rate resampling + JPEG encode
when bus subscriber appears, retained `/stream/index/<id>` discovery
message, backpressure drop (not block) on slow consumers.

**Phased path:**
1. `register_stream` API + MJPEG handler + low-rate bus frames + discovery
   index. opencv-python-headless dep. `video` service in `repo/video/1.0.0/`.
   Dashboard preview via `<img>`. UI serviceView in
   `apps/robotlab_x_ui/src/serviceViews/Video.tsx`.
2. WebRTC transport (aiortc + signaling-over-bus). Canvas video card uses
   it when latency matters.
3. shm transport for same-runtime CV consumers if benchmarks demand it.

**BGR gotcha:** OpenCV returns BGR by default. Document it; downstream
services convert if they expect RGB.


Scope I'm not doing in v1

  - GPU acceleration (cv2 CUDA) — way too much install pain for what's still a Phase-1 capability.
  - WebRTC of the filtered stream — Phase 2 of the streaming work.
  - Filter dependency graphs (DAG instead of linear pipeline) — linear is enough for 95% of use cases and dramatically simpler to author + reason about.
  - Recording filters (write video to disk) — that's a separate "recorder" service, not a filter.


## Reconcile adopted subprocesses on rlx startup

When rlx restarts, `discovery.py` adopts surviving subprocesses via
their `hello` and keeps the existing `service_proxy.pid` pointing at
them. Fine for in-flight traffic, but their internal state (pymata4
threads, bus client, serial port handles) can be stale enough that the
first fresh action — e.g. arduino `connect` after restart — fails with
`BrokenPipeError`. User workaround today is Stop + Start the proxy.

Fix: in the startup reconcile pass, when a surviving subprocess's PPID
no longer matches the current rlx pid (i.e. reparented to init /
systemd-user because the prior rlx died), treat it as "stop + spawn
fresh" instead of adopting. `_scan_service_subprocesses` already
classifies these as orphans for cleanup purposes; this is the same
logic on the lifecycle side.


## Self-hosted ARM64 runner on the Pi 4

Stand up a `cloudseeder-build-arm` runner on the Pi (mirrors the axon
`cloudseeder-build` setup — see `~/.../memory/project_selfhosted_runner.md`)
so the multi-arch matrix in `package_robotlab_x.yml` lands a real
`linux-aarch64` artifact without needing GH-hosted ARM minutes. Steps:
register at `Settings → Actions → Runners → New`, labels
`self-hosted,Linux,ARM64,cloudseeder-build-arm`, install via `svc.sh`,
then set repo var `BUILD_RUNNER_ARM=cloudseeder-build-arm`.
