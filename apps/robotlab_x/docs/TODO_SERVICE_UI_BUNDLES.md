# robotlab_x Modular Service UIs — Design Spec

Make a service's **frontend** as modular as its backend. Today every
service-type UI (`apps/robotlab_x_ui/src/serviceViews/*.tsx`) is compiled
into the one monolithic SPA build, so adding/altering a service UI means
rebuilding and redeploying the whole frontend. Meanwhile the *backend*
half is already modular: a service ships as a `repo/<type>/<version>/`
bundle that can be installed (and even remotely installed) at runtime.
This spec closes that gap — let a service bundle **ship its own UI** in
its repo dir and have the running frontend load it dynamically.

Status: **implemented — 16 of 17 service views migrated** (echo, video,
cli, joystick, motor_control, chat, clock, cron, raspi, runtime, servo,
arduino, sabertooth, serial, ik_solver, brain). Only `python` remains
static — it uses `react-router-dom` (host router context), the legitimate
"stays base-bundled" escape-hatch case. The sections below are the design;
"As-built (implemented)" at the end records where the implementation
differs from the original plan (CSS inlining, ETag cache-bust, lucide +
heavy deps bundled per-view, the type-check gate, etc.).


## Core principles

```
A service owns its UI, shipped in its own repo/<type>/<version>/ bundle.
The UI artifact is a pre-built JS module (ui.js) — committed, like icon.svg.
The host loads it dynamically (import() + import map); never rebuilt for it.
React + the host SDK are externalized → exactly one instance, no version skew.
@rlx/ui is the contract: the only sanctioned import surface for a view.
Publishing is gated to vetted devs through CI; CI is the build AND the vet.
Low friction: a dev writes View.tsx; the framework owns the build.
The static registry stays as the override / escape hatch.
```


## The decision: Option B (ship a pre-built JS module)

Three options were weighed:

- **A — declarative spec (ship data, not code).** A service ships a
  JSON/YAML description of its view; one generic renderer in the host
  interprets it. *Rejected:* not expressive enough for the hard views
  (video's MJPEG overlay + spatial pickers, joystick's dynamic
  axis/button/hat grid). The spec would grow into a programming language.

- **B — ship a pre-built JS module (micro-frontend).** Each service
  bundles a compiled ES module; the host `import()`s it at runtime and
  registers the component. **Chosen.**

- **C — iframe / web-component isolation.** *Rejected:* the usual iframe
  problems — sizing, theming, and bridging the bus over `postMessage`.

### Why B's trust concern is acceptable here

B runs **service-authored JS in the operator's authenticated browser
session** — normally a serious escalation (it's effectively stored XSS
with the operator's privileges). It is acceptable **only because
publishing is gated to vetted developers through a controlled CI/build
pipeline**: the artifact that ships is exactly the one CI produced and
blessed. That puts service UIs on the same trust basis as the service's
Python (which already runs in the runtime). This is NOT an "anyone can
publish" model. The design goal alongside it is **low friction** for a
vetted dev to add a component.


## Architecture

### Bundle layout
```
repo/<type>/<version>/
  package.yml          # gains a `ui:` block (below)
  icon.svg
  src/<svc>/...         # the Python service (unchanged)
  ui/
    View.tsx            # the ONLY file a service author writes
    package.json        # pins the build toolchain (committed)
    package-lock.json   # reproducible vetted builds (committed)
    dist/ui.js          # BUILT ARTIFACT, committed (like the YOLO .pt weights)
    dist/ui.css         # optional — only if the view needs bespoke styling
```
`node_modules/` is gitignored. The host never runs npm — `ui.js` is a
committed artifact, produced + vetted in CI, and travels with the bundle
on (remote) install exactly like `icon.svg`.

### Manifest (`package.yml`)
```yaml
ui:
  entry: ui/dist/ui.js     # served + dynamically imported
  css: ui/dist/ui.css      # optional
  sdk: "^1.0"              # @rlx/ui semver range this view was built against
```
Surfaced through `ServiceMeta` / `/v1/service-meta-list` so the host
knows which services carry a UI bundle and at what SDK range.

### Serving
A `GET /repo/{name}/{version}/ui.js` (and `/ui.css`) route, cloned from
the existing icon route (`runtime/script_routes.py`, which already streams
`repo/<n>/<v>/icon.svg` to the browser with path-traversal guards). The
UI is single-origin (the backend serves the SPA), so `import()` of a
same-origin module Just Works and shares the host import map.

### Loading
- The host injects an **import map** mapping `react`, `react-dom`, and
  `@rlx/ui` to its own instances.
- `getFullView(metaId)` becomes: static registry → else dynamic
  `import('/repo/<n>/<v>/ui.js?v=<hash>')`, register, memoize. Wrapped in
  `React.lazy` + an error boundary so a bad/incompatible bundle degrades
  to a placeholder instead of taking down the canvas.
- `?v=<contentHash>` busts the cache when a bundle updates.

### Externals → one React, one SDK (no version skew)
The view's build marks `react`, `react-dom`, and `@rlx/ui` as **externals**
(NOT bundled). At runtime the import map resolves them to the *host's*
single instances. This is what prevents "invalid hook call" (two React
copies) and eliminates per-bundle version drift — the host dictates
versions. Residual risk is API compat, handled by the `sdk` semver range:
the host refuses to load a view built against an incompatible `@rlx/ui`.

**Third-party libraries are the OPPOSITE — bundled (inlined), not
externalized.** Only the shared-singleton trio (react / react-dom /
@rlx/ui) is external. A view's own npm deps — e.g. CLI's `@xterm/xterm` +
`@xterm/addon-fit` — are bundled into its `ui.js` so the bundle is
self-contained. That's the point of B's modularity, but it has costs the
SDK-only views (video, joystick) never exercise: bundle size grows, and
**a dep that ships its own CSS** (`@xterm/xterm/css/xterm.css`) must be
emitted into the bundle's `ui.css` — the "inherit the host's Tailwind"
path does nothing for a non-Tailwind third-party stylesheet. CLI is the
test case for this whole dimension (see Phased plan).


## The `@rlx/ui` SDK surface

`@rlx/ui` is carved out of the host as the **only** sanctioned import
surface for a view — everything a view is allowed to depend on, externalized
and versioned. Anything outside it the view bundles itself.

Validated against the hardest view (`serviceViews/Video.tsx`, ~1750 lines),
whose real imports are: `react`, `react-dom` (`createPortal`),
`useWsClient`, `useActiveRuntime` (→ `connection.url` + `connection.getAccessToken()`),
and the `ServiceProxy` / `InboundFrame` types — plus browser globals
(`crypto`, `window`, `document`). So the minimum surface is:

```ts
// bus
useWsClient(): WsClient            // subscribe(topic, cb) → off; publish(topic, payload)
// runtime connection — video needs this for its tokened MJPEG <img> URL:
//   `${connection.url}/v1/stream/<id>/mjpeg?token=${connection.getAccessToken()}`
useActiveRuntime(): { connection: { url: string; getAccessToken(): string | null } }
useApiFetch(): <T>(path, init?) => Promise<T>   // REST
// types
type ServiceProxy; type InboundFrame
// component kit (grows over time) — Panel, Section, Button, Slider,
// Toggle, StatusDot/Light, Cell, ConfirmDialog, NumberField, …
```

`react` / `react-dom` themselves are externalized too (the view imports
them normally; the import map points at the host copy). Browser globals
need no SDK. **The exact surface is an open question** — it determines how
expressive views can be and how often the SDK must rev; pin it by
porting Video, Joystick, CLI, and MotorControl against it.


## Styling — inherit the host build (answers "can't it inherit?")

**Yes, and that's the primary mechanism.** CSS is global and the UI is
single-origin, so the host's already-compiled stylesheet **automatically
styles dynamically-mounted remote DOM** — a remote `<div className="bg-slate-900">`
is styled by the host's CSS *iff* `bg-slate-900` is present in the host's
compiled bundle. So a remote view that stays within the **utility
vocabulary the host already ships** inherits styling for free, with no
per-bundle CSS.

The one catch: Tailwind compiles by scanning source at the *host's* build
time (`content: ['./src/**/*.{ts,tsx}']`). A remotely-installed bundle
isn't present then, so a **new/arbitrary** class only that bundle uses
(e.g. a one-off `bg-fuchsia-300`, or an arbitrary `text-[13.5px]`) won't
be in the host CSS → it'd render unstyled. Two mechanisms make inheritance
robust:

1. **A `@rlx/ui` component kit.** Views compose `<Panel>`, `<Button>`,
   `<Slider>`, etc. from the kit; the kit's classes are in the host build
   because the kit *is* part of the host. Views then use almost no raw
   utilities → fully inherited.
2. **A safelisted utility vocabulary.** Document the sanctioned utility
   set and add it to the host Tailwind `safelist` so those classes are
   always compiled regardless of host-view churn. Remote views built
   against that vocabulary always inherit.

**Escape hatch:** a view that genuinely needs classes outside the
vocabulary ships its own compiled `ui/dist/ui.css` (Tailwind run over its
own source in CI), loaded alongside `ui.js`. Tailwind utilities are
deterministic, so overlap with the host CSS is harmless duplication, not
conflict. This is the exception, not the rule.

(Note: pointing the host's Tailwind `content` glob at the service bundles
does NOT solve this — it only covers bundles present at host-build time,
not remotely-installed ones. Hence inherit-vocabulary + kit, not scanning.)


## Build & low-friction publishing

The lever for "low friction" is a **framework-owned, uniform build**: a
vetted dev writes only `View.tsx` against `@rlx/ui` and nothing else.

- The framework provides one shared build config (Vite/Rollup lib mode)
  with `react`, `react-dom`, `@rlx/ui` pre-declared as externals. The dev
  never configures bundling.
- The generator scaffolds `ui/` (View.tsx stub + package.json + lock)
  when a service opts into a UI.
- **CI is the build AND the vetting gate**: it compiles every service's
  `ui/`, runs lint/type/security checks, and records the artifact hash in
  the manifest. "Vetting" and "the build" are the same step — the artifact
  that ships is the one CI blessed.

Mirrors the backend ergonomics: a service is "just `service.py` +
`package.yml`"; with this, its UI is "just `View.tsx`".

### Dev experience (don't lose HMR)
A dev path: when a service is flagged dev (or a local dev server is
reachable), the loader imports from the local Vite dev server (HMR)
instead of the committed `ui.js`. Prod loads the hashed artifact.


## Escape hatch: the static registry stays

`serviceViews/index.ts` remains, and `getFullView` resolves
**static-first, then dynamic** — so a base-bundled view automatically
*shadows* any dynamic one for the same `service_meta_id`. Use it for views
that are genuinely host-coupled or too complex to externalize cleanly.
But reaching for it should prompt the question: *is this really
host-coupled, or is the `@rlx/ui` SDK just missing something?* — because
**growing the SDK** is the better escape hatch when the answer is "the SDK
isn't expressive enough yet" (it fixes it for every future view, not just
this one).


## Existing seams this builds on

- Backend already serves a per-service file to the browser:
  `GET /repo/{name}/{version}/icon` (`runtime/script_routes.py`).
- The frontend is single-origin (backend serves the compiled SPA via a
  StaticFiles mount + SPA fallback in `server.py`) → `import()` and import
  maps work with no CORS.
- `wsClient` / `apiFetch` are per-runtime, provided via React context
  (`useWsClient` / `useApiFetch` / `useActiveRuntime`) — reusable by a
  dynamically-loaded view through the host's context tree.
- `repo/video/1.0.0/` already commits large binary build artifacts (YOLO
  `.pt` weights) — precedent for committing `ui.js`.


## Phased plan

- **Phase 1 — SDK + loader skeleton.** Carve `@rlx/ui` out of the host
  (bus hooks, runtime connection, types, initial component kit). Add the
  `/repo/.../ui.js` route, the import map, and the dynamic loader with
  static-first resolution + error boundary. Add the `ui:` manifest field.
- **Phase 2 — first target: `video`.** Port `Video.tsx` to a bundle
  (`repo/video/1.0.0/ui/View.tsx`) against `@rlx/ui`. Video is the hardest
  (MJPEG + token + bespoke layout + needs the runtime connection from the
  SDK) — if it ports cleanly, the surface is right. Establishes the
  framework build + CI vetting gate.
- **Phase 3 — `cli` (the dependency-axis probe).** Deliberately ahead of
  joystick: CLI is the only service view that exercises the parts B's
  build story video can't. It bundles real third-party npm deps
  (`@xterm/xterm` + `@xterm/addon-fit`, inlined into `ui.js`), **requires
  a non-Tailwind third-party stylesheet** (`xterm.css` → forces the
  per-bundle `ui.css` path, mandatory here not optional), and leans on a
  **host-internal subsystem** (`src/cli/{interpreter,discovery,verbs}`) —
  so it forces the decision of whether that engine moves into the bundle
  or gets promoted to a shared package / `@rlx/ui`. Video proves the
  SDK + layout + runtime-connection axis; CLI proves the third-party-dep +
  third-party-CSS + host-subsystem axis. Together they cover B.
- **Phase 4 — joystick + motor_control.** Dependency-light (like video);
  mostly confirm the SDK surface generalizes. Each port that needs a
  capability the SDK lacks → grow the SDK (don't base-bundle).
- **Phase 5 — generator + dev HMR path.** Scaffold `ui/` for new services;
  wire the local-dev-server loader.

## Open questions (nail before coding)

1. **The exact `@rlx/ui` surface** — pressure-test by porting Video,
   Joystick, CLI, MotorControl. Make-or-break for B.
2. **Styling coverage** — settle the safelisted vocabulary + how much the
   component kit covers vs. raw utilities (i.e. how often the per-bundle
   `ui.css` escape hatch is actually needed).
3. **Host-internal subsystems** — CLI's `src/cli/{interpreter,discovery,
   verbs}` (and similar shared host code a view leans on) must go
   *somewhere*: bundled into the view, or promoted to a shared package
   (possibly under `@rlx/ui`). Decide the rule for "view-private vs.
   shared host code" — it determines how much more than React+SDK the
   import map has to expose.


## As-built (Phases 1–3 implemented)

Status: **implemented and working** for echo (spike) + video, cli, joystick,
motor_control. A few details landed differently from the plan above:

- **Singleton sharing = `window.__RLX__` + import map (not bundling).**
  `main.tsx` exposes `{react, reactDOM, jsxRuntime, rlxUi}`; `index.html`
  maps `react`, `react-dom`, `react/jsx-runtime`, `@rlx/ui` to shims in
  `public/rlx/*.js` that re-export from the global. Bundles externalize
  exactly those four; their own deps (cli's xterm) bundle in.
- **CSS is inlined into `ui.js`, not shipped as a separate `ui.css`.**
  `build-service-ui.mjs` folds any emitted CSS (e.g. xterm.css) into the
  JS as a `<style>` injected at load → each bundle is a single
  self-contained file. The `/repo/.../ui.css` route exists but is unused.
- **Cache-busting = `Cache-Control: no-cache` + ETag revalidation** on the
  `ui.js` route (FileResponse sets the ETag). A rebuilt bundle loads on a
  normal refresh; no content-hash URL needed. (Prod could switch to hashed
  URLs + immutable caching.)
- **`@rlx/ui` surface (sufficient for all migrated views):** hooks
  `useWsClient` / `useApiFetch` / `useActiveRuntime`; component `Panel`;
  types `ServiceProxy`, `ServiceMeta`, `InboundFrame`, `WsClient`. Video
  needed only `react-dom`; motor_control needed `ServiceMeta`. No deeper
  expansion required.
- **Host-subsystem rule (open question #3) resolved for cli: bundle it in.**
  `src/cli/{interpreter,discovery,verbs}` were copied into
  `repo/cli/1.0.0/ui/cli/`, with only their `WsClient` *type* externalized
  via `@rlx/ui`.
- **Type-check vetting gate:** `tsconfig.service-ui.json` maps `@rlx/ui` →
  the host SDK and `react`/`react-dom` → `@types`, then type-checks every
  `repo/*/*/ui/View.tsx`. `npm run check:service-ui`. (The vite build only
  esbuild-transpiles — this is the gate that catches type errors AND
  validates the SDK surface is complete.)
- **Build commands:** `node scripts/build-service-ui.mjs <ui-dir>` (one);
  `npm run build:service-ui` (all — installs each bundle's own deps then
  builds). Committed `ui.js` is the shipped artifact (like the YOLO `.pt`
  weights); `node_modules` per bundle is gitignored.
- **Migrated host views deleted** (no stale duplicates): serviceViews/
  {Video,Cli,Joystick,MotorControl}.tsx + src/cli/*. The static registry
  keeps only not-yet-migrated views.

### Remaining
- **Wire into CI:** run `npm run build:service-ui && npm run check:service-ui`
  in the FULL-checkout phase (NOT the Docker ui-builder, which only copies
  robotlab_x_ui/ — the bundles live under robotlab_x/repo/). Ideally with
  `git diff --exit-code` on the bundles to catch a View.tsx edited without a
  rebuild. Needs network for per-service deps (cli's xterm, the lucide
  group). Per-bundle package-lock.json is committed; node_modules gitignored.
- **`brain`** — DONE. Its shared host components (ConfirmDialog,
  ContextMenu, CopyButton, PromptDialog) were promoted into the `@rlx/ui`
  kit; its `brain/` subtree (incl. CodeMirror + react-markdown) bundles in
  (~1.7 MB; biggest bundle, lazy-loaded). Per-bundle install uses
  `--legacy-peer-deps` since React is an external (its version is moot for
  peer resolution).
- **`python`** — left static intentionally: `react-router-dom` (host router
  context) is the legitimate "stays base-bundled" escape-hatch case. Could
  migrate only by externalizing react-router for one view — not worth it.
