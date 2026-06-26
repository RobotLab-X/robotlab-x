# TODO — Service Install Wizard

Drag-and-drop service installation: make the canvas a place to **place**
blocks, **configure** them, and **install** their dependencies through a
structured, transparent wizard — instead of silently pip-installing on drop.

Status legend: ✅ done · 🔜 next · ⬜ planned

---

## Motivation

Today, dropping a repo service → naming it → **Create** fires
`create_service`, which **simultaneously** installs the type's deps
(pip/uv) *and* creates the instance. Dropping `video` therefore kicked off
a uv install with no consent, no config step, no license gate, and only
raw pip lines for progress.

Three concerns are collapsed into one and need separating:

| Concern | Scope | When | Was |
|---|---|---|---|
| **Place** a block on the canvas | per-instance | on drop | conflated into install |
| **Install** the type's deps (one-time) | per **service-type** | first Start | conflated into create |
| **Configure + Start** an instance | per-instance | on Start | start existed; config wizard unwired |

Good news: most of the data model already exists but is **unwired**.
`ServiceMeta` already declares `wizard_steps`, `wizard_schema`,
`install_steps`, `config_steps`, `config_schema`, `ui_schema`
(`models/service_meta.py:32-37`); the scanner populates only two
(`runtime/repo.py:269-308`). Only `license` is greenfield.

---

## Target state model

**Type-level** (service_meta, shared by all instances):
`ABSENT → LOADED → INSTALLED` (+`FAILED`) — already exists (`runtime/registry.py`).

**Instance-level** (`service_proxy.status`) — one new leading state:

```
placeholder ──Start──▶ [type installed?] ──▶ [configured?] ──▶ starting ─▶ running
  (grey, Play)             │ no                   │ no              ▲
                     install wizard          config wizard          │
                     (one-time / type)       (per-instance)   stop ─┘ ⇄ stopped
```

- `placeholder` — dropped, not installed. Grey dot, Play button.
- `installing / installed / starting / running / stopping / stopped / error` — unchanged.

Drop creates a **placeholder proxy row** (survives reload via the workspace),
runs **no install**.

---

## The gated Start flow (framework-generic; details from `package.yml`)

1. **Type installed?** Check `service_meta.installed` for `name@version`
   (builtins always true; a sibling instance may have installed it).
   - Not installed → **Install Wizard** (2).
2. **Install Wizard** (one-time per type):
   1. *Overview* — "one-time install", dependency list, est. size/time.
   2. *License* — render `package.yml: license`; require explicit accept.
   3. *Install-time inputs* — `wizard_schema` + `ui_schema` (RJSF/ajv).
   4. *Execute* — run `install_steps` (default = pip/uv) with milestone
      progress (venv → rlx_bus → deps → custom) + collapsible raw log +
      structured per-step errors + Retry.
3. **Configured?** If `config_steps`/`config_schema` exist and the
   instance's `configured` flag is false → **Config Wizard** (per-instance:
   keys via password widgets, paths, settings) → save `service_config`,
   set `configured=true`. Also openable anytime from the node kebab.
4. **Start** — existing `start_service`.

---

## Milestones

### ✅ M1 — Decouple drop from install  *(implemented; branch `feat/install-wizard-m1-decouple`)*

Drop now creates a **placeholder**; the type's deps install lazily on first
Start. No wizard UI yet — install just runs on Start, not on drop. This
alone fixes the "drop silently pip-installs" surprise.

Backend (`runtime/lifecycle.py`):
- Extracted the venv/pip logic into `_ensure_type_installed(meta, req_id)`
  — idempotent, no-op for builtins, short-circuits when the venv exists.
- `create_service` honours a `placeholder: true` request flag → creates the
  proxy as `status="placeholder"` and returns without installing. Eager
  callers (catalog seeder, programmatic installs) omit the flag and keep
  the original install-now behaviour.
- `start_service` accepts `placeholder` as a startable state and runs
  `_ensure_type_installed` (→ `installing`) before launching; install
  failure lands the proxy in `error` (retryable).

Frontend:
- Canvas drop posts `placeholder: true` (`pages/Composer.tsx` `confirmInstall`).
- `placeholder` added as a grey status (`composerViews/_shared.tsx`
  `STATUS_DOT`/`STATUS_TONE`) and as a startable state (`visibleActions`,
  `RegistryTab.startable`).

Tests: `tests/test_lifecycle.py` — `test_install_placeholder_skips_install`,
`test_start_from_placeholder_installs_then_runs` (25 pass).

**Not in M1:** wizard UI, license, config wizard, structured install engine,
multi-language managers.

### ✅ M2 — Structured install engine + progress/error UI  *(implemented)*
- `runtime/installer.py`: `install_pip` is now a step executor (create_venv
  → install_rlx_bus → install_deps) emitting structured events via
  `on_event` `{step_id, label, index, total, status, detail?, stream?,
  error_code?}`. Per-step timeouts (venv 180s / rlx_bus 120s / deps 600s).
  Failures raise `InstallError(step_id, error_code, returncode)`. Writes a
  `.venv/.install-state.json` marker on success (`read_install_marker`).
- `runtime/lifecycle.py`: `_publish_install_event` forwards events to the
  request's progress topic with `phase:"install"`.
- UI: `components/InstallProgress.tsx` (step list + collapsible raw log +
  Retry) rendered in the inspector. `pages/Composer.tsx` mints the
  service_request id client-side (`genId`, secure-context-safe) and
  subscribes to `/service_request/{id}/progress` BEFORE posting — the POST
  runs the install synchronously, so subscribe-after would miss events.
- Tests: `tests/test_installer.py` (step sequence, skip-existing-venv,
  structured failure, marker). 28 backend tests pass.
- **Note:** the request route is still synchronous
  (`services/service_request_service.py` — "Phase 6 will move long-running
  work into a background task"); progress streams live over the websocket
  during the blocking POST, which is fine for now. Background dispatch is a
  future concern, not part of this wizard work.

### ✅ M3 — Install Wizard (license + install-time inputs)  *(implemented)*
- Added `license` to `ServiceMeta` (`models/service_meta.py`), the
  `PackageManifest` dataclass, `_parse_manifest`, and
  `manifest_to_service_meta` (`runtime/repo.py`). `wizard_steps` already
  flowed from `wizard_install`. Carried `license` + `wizard_install`
  through `tools/build_services.py` + `tools/publish_services.py` into
  `catalog.yml`.
- UI: `components/InstallWizard.tsx` — overview → license accept → install-
  time inputs, rendered from the existing `wizard_steps`
  `{id,title,fields:[{id,type,title,default,…}]}` shape (string / integer /
  number / boolean / select). On confirm it forwards the collected values
  as the start request's `config`. `lifecycle._handle_start` merges request
  `config` into the instance's `service_config` before launch.
- `Composer.dispatchProxyAction` gates the first Start of a placeholder
  whose type isn't installed and declares a license or install-time inputs:
  it opens the wizard instead of installing immediately. Once installed the
  type is skipped (so the license shows ~once per type — per-(type,user)
  persistence is a future refinement, see below).
- Pilot: `repo/video/1.0.0/package.yml` gained a third-party-license notice
  (OpenCV / Ultralytics AGPL) + a `wizard_install` "enable detection" toggle.
- Tests: `tests/test_repo_meta.py` (license/wizard_steps mapping) +
  `test_start_merges_request_config`.
- **Note:** still using the `wizard_steps`/`wizard_config` step+fields shape
  rather than JSON-Schema + RJSF/ajv. The `wizard_schema`/`config_schema`/
  `ui_schema` model columns remain for an eventual RJSF migration; install-
  time license acceptance is gated by install state, not yet persisted
  per-user.

### ✅ M4 — Config Wizard (per-instance)  *(implemented)*
- `components/ConfigWizard.tsx` renders `config_steps` (already flows from
  `wizard_config`) seeded from the proxy's `service_config`; secrets use a
  `password` field type (added to the shared `FieldInput`).
- `Composer.dispatchProxyAction` config gate: first Start of an
  unconfigured instance whose type has per-instance fields opens the config
  wizard → start. An inspector **Configure** button reopens it any time and
  saves without starting (`saveProxyConfig` read-merge-writes the proxy and
  sets `configured`, mirroring `TopicRemapSection`).
- `lifecycle._handle_start` sets `configured=true` when config is applied,
  so the gate won't re-prompt.
- Tests: `test_start_merges_request_config` asserts merge + `configured`.
- **Note:** "Configure" lives on the inspector (not yet the node kebab);
  `config_schema`/`ui_schema` (RJSF) still deferred. Secret values are sent
  as plaintext over the API and encrypted server-side by the service
  `config_class` (`SecretStr`) — same TLS caveat as elsewhere.

### ✅ M5 — Multi-language managers + polish  *(implemented)*
- `installer.install(dependency_manager, …)` dispatches by manager name
  (`SUPPORTED_MANAGERS`). pip is implemented; npm/mvn/docker raise a
  structured `InstallError(error_code="unsupported_manager")` and emit a
  failed milestone, so the progress UI shows exactly which manager is
  missing. Adding one = implement `install_<mgr>()` + register it.
- `lifecycle._ensure_type_installed` now routes through `install()` by
  manager instead of hard-checking `== "pip"`.
- `installer.uninstall_type(slot, repo_dir)` removes a type's venv (+ the
  success marker) for rollback after a partial failure or an explicit
  reinstall. Idempotency marker (`.install-state.json`) from M2 gates clean
  retries.
- Tests: dispatch-to-pip, unsupported-manager (raises + failed event),
  uninstall_type removes venv + idempotent. 34 install/lifecycle/repo tests
  pass.
- **Deferred (genuinely future, not blocking):** actual npm/mvn/docker
  implementations; artifact caching beyond pip/uv's own `~/.cache`;
  per-(type,user) license-acceptance persistence; RJSF/ajr JSON-Schema
  forms; moving the synchronous request route to background dispatch
  (`services/service_request_service.py` "Phase 6").

---

## Status

M1–M5 implemented on branch `feat/install-wizard-m1-decouple` (PR #107).
The canvas is now place → configure → install (wizard) → start, with
structured progress + errors, driven by per-type `package.yml` metadata.
The "Deferred" bullets above are the remaining future work; none are
required for the flow to function end-to-end.

---

## Key references

- Lifecycle / states: `src/robotlab_x/runtime/lifecycle.py`
  (`_handle_install`, `_handle_start`, `_ensure_type_installed`).
- Installer: `src/robotlab_x/runtime/installer.py` (`install_pip`).
- Registry states: `src/robotlab_x/runtime/registry.py`,
  `src/robotlab_x/api/registry_api.py`.
- Models: `src/robotlab_x/models/service_meta.py` (unwired wizard columns),
  `service_proxy.py`, `service_config.py`.
- Manifest → meta: `src/robotlab_x/runtime/repo.py` (`_parse_manifest`,
  `manifest_to_service_meta`); examples `repo/clock/1.0.0/package.yml`
  (builtin), `repo/video/1.0.0/package.yml` (pip).
- Catalog build: `tools/build_services.py`, `tools/publish_services.py`.
- UI: `apps/robotlab_x_ui/src/pages/Composer.tsx` (drop, `confirmInstall`,
  `visibleActions`, `RegistryTab`); `composerViews/_shared.tsx` (status
  colours); `composerViews/view_min.tsx`, `view_full.tsx`.

## Open decisions

1. **Placeholder persistence** — a `placeholder` proxy row (chosen in M1)
   vs a canvas-only node. Row is simpler and survives reload.
2. **License/keys scope** — license acceptance per (type, user); credentials
   per instance (matches `config_steps`).
3. **Form stack** — schema comments assume **RJSF + ajv**; confirm adopting
   that UI dependency.
4. **Install trigger** — auto-launch the wizard on Start (planned) vs a
   separate explicit "Install" button on the placeholder node.
