# RobotLab-X

**Open-source real-time robotics framework: compose, wire, and run robot
services visually. Python + React, offline, cross-platform.**

RobotLab-X is a robotics-orchestration runtime. You compose *services* on a
canvas, wire them together with message routes, and the runtime starts, stops,
and monitors them in real time. Services range from hardware adapters (servos,
motors, Arduino, GPIO, cameras) to higher-level capabilities (text-to-speech,
speech-to-text, an LLM "brain", inverse kinematics) — all talking over a single
JSON-over-WebSocket message bus.

It runs fully offline and cross-platform (Linux / macOS / Windows / Raspberry
Pi). RobotLab-X is the modern successor to **myrobotlab**.

---

## Highlights

- **Visual service runtime** — drag services onto a canvas, connect them with
  routes, start/stop/monitor live.
- **One message bus** — every service publishes/subscribes JSON over an
  in-process pub/sub exposed to browsers + subprocess services over WebSocket.
- **Capabilities, not concrete types** — a consumer binds to a *capability*
  (e.g. `servo_controller`, `speech`, `transcription`) and any implementor
  fits. Swap an Arduino for a Telemetrix board without touching the consumer.
- **Batteries included** — servos, motors, Arduino/Telemetrix, GPIO (Raspberry
  Pi), serial, joystick, keyboard, microphone/speaker, video + object
  detection, TTS (`speech_local`, Piper), STT (`stt_local`, sherpa-onnx), an
  LLM-workflow `brain`, IK + robot kinematics, cron, and more.
- **Federation** — multiple runtimes discover each other and address services
  across machines.
- **Self-describing** — every service advertises its config/state/method JSON
  Schemas on retained discovery topics, so tools and UIs introspect at runtime.
- **Modular UIs** — a service ships its own React view bundle; the host loads it
  dynamically.

---

## Quick start (run from source)

Requirements: **Python 3.12+**, [**uv**](https://docs.astral.sh/uv/), and
**Node.js 20+** for the UI.

### Backend

```bash
cd apps/robotlab_x
cp .env.example .env            # dev defaults (set a real ROBOTLAB_X_JWT_SECRET for anything public)
uv sync                         # creates .venv and installs deps (incl. the vendored packages/)
uv run python -m robotlab_x.main
# → http://localhost:8998   (GET /v1/version to confirm it's up)
```

On first launch you establish the admin account interactively (first-user
claim) — there is no seeded password.

### Frontend (dev)

```bash
cd apps/robotlab_x_ui
npm install
npm run dev                     # Vite dev server, proxied to the backend on :8998
```

The backend also serves a production build of the UI, so for a single-process
run you can `npm run build` the UI and just run the backend.

---

## Repository layout

```
robotlab-x/
├── apps/
│   ├── robotlab_x/             # Python backend (FastAPI) + the service runtime
│   │   ├── src/robotlab_x/     #   runtime, framework, API, services
│   │   ├── repo/<name>/<ver>/  #   bundled service types (each a package.yml + code [+ ui/])
│   │   └── docs/               #   PRD, implementation notes, design docs
│   └── robotlab_x_ui/          # React + Vite frontend (canvas, service views)
└── packages/                   # shared libraries the backend depends on
                                #   (rlx_bus, rlx_audio, rlx_input, auth, config, …)
```

A **service type** lives in `apps/robotlab_x/repo/<name>/<version>/` as a
`package.yml` manifest plus its code (in-process `Service` subclass or a
pip-installed subprocess), an `icon.svg`, and optionally a modular `ui/` view.

---

## Adding a service

Copy the heavily-commented reference at
`apps/robotlab_x/repo/master_template/1.0.0/` to `repo/<your-name>/1.0.0/`,
fill in the `package.yml`, and implement your `Service`. The runtime discovers
it on the next boot. See `apps/robotlab_x/docs/` for the architecture and the
PRD.

---

## Contributing

Contributions are welcome — please read [CONTRIBUTING.md](./CONTRIBUTING.md)
first. A few files are marked `# managed` / `// managed`: those are generated
by an upstream tool, so changes to them are handled specially (the CONTRIBUTING
guide explains how).

## License

[MIT](./LICENSE) © RobotLab-X. Some optional service dependencies and
downloaded models carry their own licenses (e.g. the `speech_local` TTS engine
is GPL-3.0, installed into that service's own isolated environment) — see each
service's `package.yml` / `pyproject.toml`.
