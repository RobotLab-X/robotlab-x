# TODO — Workspaces (as views) + remote backend restart

Two decisions from the high-level review of the workspace + config-set
concepts.

Status: ✅ Remote restart implemented (M1). ⬜ Workspace narrowing planned (M2).

---

## Mental model (the definitions we're standardizing on)

- **Config set** = the durable, file-defined **inventory** of services + their
  config that boots (`data/config_sets/<name>/`: `runtime.yml` + one
  `<proxy_id>.yml` per service). Switching the active set = **restart** (no
  hot-swap — a deliberate design choice). This is "the installed system."
- **Runtime canvas** (`kind:'runtime'` workspace) = the live view of every
  running service. The primary surface.
- **Workspace** (`kind:'user'`) = a saved, named **view/lens** over the shared
  pool of running services — layout (positions, viewport, edges, dashboard)
  + which subset to show. **Not** a separate inventory and **not** a batch
  start/stop lever. ("Saved camera angles," not folders that own services.)

This resolves the confusion that adding a service to a user workspace also
shows it on the runtime canvas: services are global; a workspace is a view.

---

## ✅ M1 — Remote backend restart  *(implemented)*

The gap: switching a config set says "restart the backend," but there was no
way to restart from the UI/API — no endpoint, no `os.execv`, no supervisor
hook. On a headless remote box the operator was stuck. Restart is also useful
beyond config sets (upgrades, recovery).

- **`runtime/system.py`**
  - `record_start_command()` — at startup, serializes the **exact** launch
    command (`sys.orig_argv`: interpreter + `-m`/script + any args) + cwd to
    `<data_dir>/last_start_command.json` ("simple restart re-runs how I was
    started, including any CLI params").
  - `read_start_command()` — reads it back; falls back to
    `[sys.executable] + sys.argv`.
  - `restart()` — flushes, `os.chdir` to the recorded cwd, then
    `os.execv(cmd[0], cmd)` — replaces the process with a fresh one using the
    same command line. No supervisor required; works headless.
  - `system_info()` — active config set, recorded start command, pid, version,
    started-at.
- **`api/system_api.py`** (registered via `register_admin_routes`, Admin-gated)
  - `GET /v1/system/info`
  - `POST /v1/system/restart` — responds first, then re-execs ~0.5s later so
    the HTTP response flushes before the process is replaced.
- **Startup:** `record_start_command()` runs in `event_handlers.on_startup`.
- **UI**
  - `ConfigSetSwitcher` "restart required" dialog gains **Restart now** →
    `POST /v1/system/restart`, then a "restarting / reconnecting…" state. The
    ws auto-reconnects (see the ws-direct-to-backend dev fix), so the client
    lands on the new active set on its own.
  - `RuntimeNav` user menu gains **Restart backend** (with confirm) for the
    general case.

### Graceful drain (refinement)

A bare `os.execv` orphaned subprocess services and left rows stale-`running`
(the new boot saw "running" with dead/duplicate processes). `on_shutdown`
isn't called on `execv`, so restart now drains explicitly:

- `system.graceful_restart()` → `set_draining(True)` → `lifecycle.drain_services()`
  → `restart()` (execv).
- **Draining state:** `system.is_draining()` is checked at the top of
  `_handle_install` / `_handle_start` — no new services are created/started
  into a shutting-down runtime.
- `drain_services()` stops every **non-singleton** service in
  running/starting/installing/stopping (terminates subprocesses → no
  orphans; force-marks `stopped` if a stop fails). Singletons (runtime /
  security) ride the restart and re-materialize on boot.
- On boot, `boot_from_config_set` / `sync_config_set_to_db` bump the active
  set's `start_order` services from `stopped` → `running` so reconcile
  respawns them **fresh** — so draining never leaves the configured set down.
- `system_info()` exposes `started_at` + `draining`; the UI restart dialog
  polls `started_at` and only closes once a *different* (post-exec) process
  answers — it won't dismiss during the draining-but-still-up window.

Verified end-to-end: with a running clock, `POST /v1/system/restart` logged
`drain: stopped N`, re-exec'd, and the clock read `stopped` (not stale
`running`) on the fresh process.

Caveat: `os.execv` still drops in-flight HTTP requests (acceptable for a
deliberate restart). For supervised prod, run under systemd
(`Restart=always`) — the endpoint exits cleanly and systemd relaunches; the
recorded command stays the source of truth for a manual relaunch.

---

## ✅ M2 — Narrow "workspace" to a saved view  *(core done)*

Made the concept coherent by dropping the batch-lifecycle pretense that
overlapped with config sets:

- **Removed Activate/Deactivate** from the user-workspace UI
  (`pages/Composer.tsx`) — plus the now-dead `dispatchWorkspace`, the
  status pill, and `WORKSPACE_STATUS_TONE`. A user workspace now shows a
  **"saved view"** badge (with a tooltip explaining it's a lens over the
  shared services, not a separate instance). Services run independently
  (start them on the canvas or via the active config set).
- **Re-added a direct "Workspaces" nav entry** (`components/RuntimeNav.tsx`)
  with distinct active-state matching from "Canvas" (which targets
  `workspaces/runtime`). Fixes "no direct path to see workspaces."
- The backend `activate_workspace` / `deactivate_workspace` verbs remain but
  are no longer reachable from the UI; `restore_active_workspaces` is a
  no-op going forward (nothing sets `activated_at` anymore). They can be
  deleted in a later cleanup.

**Deferred (optional polish, larger):** ghost-proxy auto-tidy; making "Save
subset" explicitly a snapshot in the UI; wiring edges to real routing
(topic/subscription) vs labelling them visual-only; the dashboard widget
model. None block the coherent "workspace = saved view" definition.

---

## References

- `runtime/config_sets.py` (active set marker + boot resolution),
  `api/config_sets_api.py` (switch), `docs/TODO_CONFIG_SETS.md`.
- `models/workspace.py`, `runtime/workspaces.py`, `runtime/lifecycle.py`
  (`_handle_activate_workspace` / `_handle_deactivate_workspace`).
- UI: `components/ConfigSetSwitcher.tsx`, `components/RuntimeNav.tsx`,
  `pages/Workspaces.tsx`, `pages/Composer.tsx`.
