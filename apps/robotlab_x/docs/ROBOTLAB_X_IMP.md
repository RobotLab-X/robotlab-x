# RobotLab-X Implementation Plan

Companion to [ROBOTLAB_X_PRD.md](./ROBOTLAB_X_PRD.md). This document turns the
PRD into a concrete, phased build plan rooted in the actual CloudSeeder repo
layout and the entities already defined in
[`templates/apps/robotlab_x.yml`](../../../templates/apps/robotlab_x.yml).

## 0. Open Decisions (resolve before coding)

These must be locked in first because they change every layer below.

### 0.1 Backend stack: FastAPI (settled)

Backend is **Python / FastAPI**, generated with `create_app.py` from
`templates/apps/robotlab_x.yml`. Server-side TypeScript generation has been
removed from CloudSeeder; the only TypeScript output is the companion model
files emitted into `apps/robotlab_x_ui/src/models/` when `language_types`
includes `typescript`. The yml must **not** declare `stack: "typescript"`.

The TS-model emission path inside `create_app.py` was restored as part of
Phase 1 (it had been deleted along with `create_ts_app.py`). Trigger via
`app.language_types: [..., "typescript"]` + `app.typescript_app: "<ui-app>"`
in the yml, or override at the CLI with `--javascript-models=<ui-app>`.
Templated models (e.g. `user` extending `AuthUser`) currently emit a flat
empty interface — see task #9.

### 0.2 Database backend

`config.database_type` is `Literal["postgres", "lowdb", "filesystem", "none"]`
with a default of `"lowdb"`. CloudSeeder generators assume Postgres for the
managed CRUD path. We have two reasonable shapes:

- **Postgres for catalog/state, filesystem for per-workspace artifacts** — uses
  the generator's default CRUD plumbing for `service_meta`, `service_proxy`,
  `workspace`, etc. Recommended.
- **lowdb / filesystem only** — closer to RobotLab-X's "install light"
  principle but requires custom adapters; generated SQL migrations become dead
  weight.

Default to Postgres; treat `database_type` as a runtime knob, not a build-time
fork.

### 0.3 Frontend location

`apps/robotlab_x_ui/` already exists as an empty directory. When `create_app.py`
runs with `language_types` including `typescript`, it emits the paired
`<app>_ui/` model files automatically. The PRD locks this path in at line 411.

---

## 1. Repository Layout (target state)

```text
cloudseeder/
├── templates/
│   ├── apps/robotlab_x.yml          # source of truth for models + API shape
│   └── tpl/ ...                     # generator templates (do not edit per-app)
├── packages/                        # shared libs (only touch if change is generic)
│   ├── auth/ database/ config/ ...  # Python shared libs used by FastAPI backends
│   └── ts-types/ ts-api-client/ ... # TS shared libs consumed by React frontends
└── apps/
    ├── robotlab_x/                  # FastAPI backend (managed + unmanaged)
    │   ├── src/robotlab_x/
    │   │   ├── api/                 # MANAGED — generated FastAPI routers
    │   │   ├── models/              # MANAGED — generated Pydantic models
    │   │   ├── services/            # UNMANAGED — business logic lives here
    │   │   ├── runtime/             # UNMANAGED — bus, process mgr, installer
    │   │   └── server.py
    │   ├── sql/                     # MANAGED — generated migrations
    │   ├── docs/
    │   │   ├── ROBOTLAB_X_PRD.md
    │   │   └── ROBOTLAB_X_IMP.md    # this file
    │   └── tests/
    └── robotlab_x_ui/               # frontend (managed + unmanaged)
        ├── src/
        │   ├── models/              # MANAGED — generated TS interfaces
        │   ├── api/                 # MANAGED — generated typed fetch clients
        │   ├── components/          # UNMANAGED
        │   ├── pages/               # UNMANAGED
        │   └── runtime/             # UNMANAGED — WS client, message bus
        └── package.json
```

**Rule (from `CLAUDE.md`):** `# managed` files are regenerated and must not be
hand-edited. All custom logic goes in unmanaged service / runtime / component
files. If the **shape** of a model or generated route must change, edit
`robotlab_x.yml` and regenerate — never patch the output.

---

## 2. Domain Model (already in `robotlab_x.yml`)

The yml is already strong. Mapping entities → product role:

| Model              | Product role                                                    | Notes                                                  |
| ------------------ | --------------------------------------------------------------- | ------------------------------------------------------ |
| `config`           | Singleton app config (db type, repo dir, MQTT ports)            | id defaults to `"default"`                             |
| `user`             | Auth identity (extends `AuthUser`)                              | Standard CloudSeeder auth path                         |
| `message`          | Runtime message envelope (`name`/`method`/`data`/`reply_to`)    | `__transport__: none` → bus-only, no CRUD              |
| `service_meta`     | Service catalog entry — wizards, install steps, schemas         | Drives the install/config wizard machinery in the UI   |
| `service_proxy`    | Running instance of a service (pid, host, port, status)         | One service can have many proxies                      |
| `service_config`   | Per-proxy config params                                         | Mirrors `service_proxy.service_config` denormalised    |
| `workspace`        | Composer canvas (proxies, node positions, dashboard, viewport)  | Maps to PRD §UI Areas 1 + 2                            |
| `topic`            | Pub/sub channel scoped to a workspace                           | ROS2-style names                                       |
| `subscription`     | proxy → topic binding with optional filter                      |                                                        |
| `alias`            | Short-name alias for a proxy/topic/subscription                 |                                                        |
| `service_request`  | Lifecycle command queue (install/start/stop/restart/uninstall)  | Async command pattern — UI POSTs, runtime consumes     |

**Likely yml gaps to add as we build (per phase):**

- `package` — installed package record (source, version, kind: pip/npm/git/dockerized)
- `process_event` — append-only log of process lifecycle transitions (for the Event Timeline observability surface)
- `script` — saved user scripts for the Script Editor (Phase 5)
- `dashboard_widget` — currently embedded in `workspace.dashboard` as a free JSON blob; consider promoting to a first-class model only if querying widgets across workspaces becomes useful

Do **not** add these speculatively — let the phase that needs them drive the yml edit.

---

## 3. Phased Build Plan

Each phase ends with something demoable end-to-end. Do not batch phases.

### Phase 1 — Generated skeleton + auth + config

**Goal:** `apps/robotlab_x` and `apps/robotlab_x_ui` exist, generate cleanly,
boot, serve `/health`, authenticate a user, persist `config`.

1. Confirm `robotlab_x.yml` declares `language_types: ["python", "typescript"]`
   and a paired UI app (e.g. `typescript_app: "robotlab_x_ui"`) — see
   `cannamatic_dutchie.yml` for the reference shape.
2. Run the generator:
   `python templates/create_app.py --app_name=robotlab_x --javascript-models=robotlab_x_ui`
3. Wire `.env`, `docker-compose`, Postgres migrations from `sql/`.
4. Smoke test: login flow, `GET /config-list`, `PUT /config/default`.
5. Frontend boots, hits `/v1/...` through the generated typed client and the
   generated `apps/robotlab_x_ui/src/models/` interfaces.

**Exit criteria:** clean `docker compose up`, login works, config round-trips.

### Phase 2 — WebSocket runtime (the "primary bus")

**Goal:** the system has a working pub/sub bus. No services yet — just the
plumbing the PRD calls out as the "primary application bus".

Unmanaged backend code in `services/` + `runtime/`:

- `runtime/bus.py` — in-process asyncio pub/sub keyed by topic, with
  retained-message support per `topic.retained`.
- FastAPI WebSocket endpoint `GET /v1/ws` — JSON frames matching the `message`
  model shape (`name`/`method`/`data`/`reply_to`).
- Frame methods (initial set):
  - `subscribe { topic }` / `unsubscribe { topic }`
  - `publish { topic, payload }`
  - `request { topic, method, data, reply_to }` → routed reply via `reply_to`
- Per-connection auth: JWT on the upgrade (reuse `packages/auth`).
- Backpressure: drop-oldest on slow consumers, log a `bus.slow_consumer` event.

Unmanaged frontend code in `src/runtime/`:

- `wsClient.ts` — single shared connection, reconnect with jitter, typed
  `subscribe<T>(topic, handler)` API.
- React hook `useTopic(topic)` returning the latest message + history slice.

**Why this is Phase 2:** every later feature (lifecycle events, logs,
telemetry, install progress) is implemented as topics on this bus. Getting it
right once removes a class of bespoke streaming code later.

**Exit criteria:** a manual `publish` from one browser tab is received in
another tab subscribed to the same topic, with auth enforced.

### Phase 3 — Service catalog + lifecycle (`service_request` pipeline)

**Goal:** users can install, start, stop, restart, uninstall a service from the
UI. Mock services only — no real ROS2/MQTT yet.

Backend:

- Seed `service_meta` with 2-3 mock services (e.g. `echo@1.0.0`,
  `clock@1.0.0`). Use the existing `wizard_steps`/`install_steps` fields.
- `services/service_request_service.py` (unmanaged) — consume the
  `service_request` queue:
  - `install` → write a `service_proxy` row, run `install_steps` actions,
    publish progress to topic `service_request/{id}/progress`, mark status.
  - `start` / `stop` / `restart` / `uninstall` → transition `service_proxy.status`,
    emit lifecycle events on topic `service_proxy/{id}/lifecycle`.
- `runtime/process_manager.py` (unmanaged) — for Phase 3 this is a stub that
  just simulates `pid`, `started_at`, `stopped_at`. Real subprocess launch
  arrives in Phase 6.

Frontend:

- **Service Catalog page** — list `service_meta`, "Install" button kicks off the
  wizard (RJSF rendered from `wizard_schema` + `ui_schema`).
- **Service Proxies page** — list `service_proxy`, per-row status pill,
  Start/Stop/Restart buttons that POST to `/service-request`.
- Both pages subscribe to lifecycle topics over WS to update without polling.

**Exit criteria:** install → start → stop → uninstall a mock service entirely
through the UI, with real-time status updates over WS.

### Phase 4 — Workspace composer (PRD §UI Area 1)

**Goal:** the graphical composer canvas — drag/drop proxies, draw connections,
inspect routes.

Backend:

- `workspace` CRUD already generated. Add unmanaged
  `services/workspace_activation_service.py` to handle the
  `activate_workspace` / `deactivate_workspace` `service_request` actions:
  starts/stops the proxies referenced in `workspace.service_proxy_ids`.
- Topic/subscription/alias CRUD provides the routing model. Adding a
  connection on the canvas = creating a `topic` + `subscription` row.

Frontend (`apps/robotlab_x_ui/src/pages/Composer.tsx`):

- Canvas library: **React Flow** is the safest default — node graph,
  drag/drop, custom node renderers, pan/zoom, fits PRD's n8n / Node-RED
  reference. Persist canvas state into `workspace.node_positions` and
  `workspace.viewport`.
- Node = `service_proxy`. Edge = `subscription` (with topic shown on the edge).
- Right-rail **Service Inspector** (PRD §UI Area 3) for the selected node:
  metadata, config form (RJSF from `config_schema`/`ui_schema`), logs,
  metrics, current status. All streamed over WS.

**Exit criteria:** create a workspace, drag two proxies onto the canvas,
connect them, hit "Activate", see lifecycle events flow over WS, refresh
the page and the canvas state is restored.

### Phase 5 — Observability: dashboard + message inspector + script editor

**Goal:** PRD §UI Areas 2, 4, 5.

- **Dashboard** (`workspace.dashboard` blob) — react-grid-layout, widget
  catalog (camera feed, log tail, topic stream, metric chart, terminal,
  process status). Each widget subscribes to one or more topics via the
  WS client. Persist widget config + layout into `workspace.dashboard`.
- **Message Inspector** — global page that lists active topics, throughput
  (count + bytes/s computed client-side from the WS stream), publishers
  (`topic.publisher_proxy_id`), subscribers (joined from `subscription`),
  and a tail-able message log. "Replay" requires Phase 7.
- **Script Editor** — Monaco wrapper, file tree backed by a new yml model
  (`script`, see §2 gaps). Run button POSTs to a `script-request` endpoint
  that streams stdout/stderr on a per-run topic.

**Exit criteria:** open a workspace's dashboard, see a live log widget and a
metric chart filling in real time; open the inspector and watch frames
crossing between two proxies.

### Phase 6 — Real process management + package installation

**Goal:** swap Phase 3's stubbed process manager for real subprocess
launches and real package installs. This is where RobotLab-X stops being a
visualiser and becomes an orchestrator.

- **Process manager** — start subprocesses using `service_proxy.pid`/`host`/
  `port`, capture stdout/stderr → bus topics, supervise (crash restart per
  `service_meta.config_schema` rules), graceful stop with SIGTERM → SIGKILL
  escalation.
- **Package installer** — pluggable installer per `service_meta` source kind:
  - `pip` — `uv pip install` (or `pip install`) into a venv under
    `config.repo_dir/<service>/`
  - `npm` — `npm install` into the same per-service workspace
  - `git` — clone + run a declared bootstrap step
  - `docker` — `docker pull` + `docker run` with managed lifecycle
  - `robotlab_x` package — custom format, see PRD §Dynamic Package Installation
- Stream every step on topic `service_request/{id}/progress`.

**Exit criteria:** install a real Python pip-based service (e.g. a tiny
`uvicorn`-served `/echo` endpoint), start it, see its real pid, watch logs
tail in the dashboard, stop it cleanly.

### Phase 7 — Integrations + AI services

**Goal:** the PRD's headline integrations land as first-class services. Each
ships as a `service_meta` entry with proper wizards and a working
implementation under `repo/`:

- **MQTT bridge** — bridges the internal bus to/from an MQTT broker
  (`config.mqtt_broker_url`).
- **ROS2 bridge** — `rclpy`; maps `topic` rows to ROS2 topics bidirectionally.
- **Camera** — V4L2 / OpenCV ingest, publishes frames on a workspace topic.
- **OpenAI / Ollama** — chat completion + embeddings, exposed via a
  generic `llm` topic contract so workflows can swap models.
- **Whisper (STT) / TTS** — speech in/out as topic-driven services.
- Message **replay support** (PRD §Messaging Features) — persistent ring
  buffer per topic in Postgres, exposed via a `replay { topic, from, to }`
  WS frame.

**Exit criteria:** the MVP demo from the PRD's Success Criteria —
"a beginner builds a robotics workflow visually" — runs end-to-end with
real hardware or real cloud LLMs.

---

## 4. Cross-cutting Concerns

### 4.1 Topic naming

Adopt ROS2-style slash paths as the yml already implies (`topic.name`
example: `/camera/rgb/image_raw`). Reserve a few namespaces:

- `service_proxy/{id}/lifecycle` — start/stop/crash events
- `service_proxy/{id}/log` — stdout/stderr lines
- `service_proxy/{id}/metrics` — periodic metric samples
- `service_request/{id}/progress` — install/lifecycle progress
- `bus/{event}` — bus-internal events (slow consumer, dropped frame, etc.)

These are conventions, not generated routes — document them here and in a
runtime README, do not encode them into the yml.

### 4.2 Authentication on the WS

JWT on the upgrade request (`?token=` query for browser clients that can't
set headers on `WebSocket`, or `Authorization` for non-browser clients).
Reject unauth upgrades; never accept anonymous subscribes — the PRD's
"professional grade" requirement implies this.

Per-topic ACLs can come later; for MVP, any authenticated user can
subscribe to any topic in workspaces they own.

### 4.3 Schemas & wizards

`service_meta.wizard_schema` + `ui_schema` and `config_schema` are JSON
Schema Draft-7 + RJSF ui:schema respectively. Standardise on
**react-jsonschema-form (RJSF)** on the frontend and **ajv** on the
backend for validation. This is already implied by the yml docstrings.

### 4.4 Testing strategy

- **Backend unit:** services in isolation, mock the bus.
- **Backend integration:** real Postgres (no mock DB — see
  [[feedback_db_keys_match_payload]]'s sibling rule that integration tests
  must hit real infra), real bus, mock subprocesses.
- **Frontend:** Vitest for hooks (`useTopic`, RJSF schema rendering),
  Playwright smoke for the composer (drag + connect + activate).
- **End-to-end:** one happy-path test per phase exit criterion above.

### 4.5 Generator discipline

Per `CLAUDE.md`: managed files are overwritten. After any
`robotlab_x.yml` edit + regenerate, re-check that unmanaged
`services/`, `runtime/`, `components/`, `pages/` code still compiles
against the regenerated models. The `--dry-run` and `--validate` flags
on the generator (see [[project_generator_refactor]]) are the right
guardrail here — gate yml changes in CI on `--validate` passing.

---

## 5. What's Explicitly Out of Scope for MVP

To keep the cone narrow, the following PRD items defer past the MVP demo:

- Multi-tenant workspace sharing / RBAC beyond owner
- Distributed runtime — second node joining the bus over the network
- Edge/cloud hybrid deploys
- Marketplace UI for `service_meta` (catalog is local-only)
- Visual debugger / breakpoints on the composer canvas
- Workflow templates as a first-class artifact (Phase 5's dashboard layouts
  already cover the common case)

Track these as Phase 8+ once the MVP demo lands.

---

## 6. Immediate Next Actions

1. Verify `robotlab_x.yml` declares `language_types: ["python", "typescript"]`
   and `typescript_app: "robotlab_x_ui"` and does **not** set `stack:`.
2. Run Phase 1 generation; commit the generated skeleton in one commit so
   future regenerations show clean diffs.
3. Stand up Phase 2's WebSocket bus before writing any service-specific code —
   it is a load-bearing primitive and easier to get right with zero callers.
