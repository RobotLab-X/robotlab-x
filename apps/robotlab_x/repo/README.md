# robotlab_x service repo

This directory is the **source repo** for every robotlab_x service.
Each service lives at `<type>/<version>/` with a `package.yml` plus
its source — that layout is the same one a running rlx reads from at
`<install>/repo/`. The contents here are the canonical "everything we
know about" set; what actually ships in a bundle vs is available
remotely is decided per-service (see Vocabulary below).

For the design rationale + roadmap, see `../docs/TODO_REPO.md`. This
README is the working dev's reference — how to make a new service,
how to build + publish the registry.


## Vocabulary

Used consistently across the codebase, the build tools, and the UI:

| Term | Meaning |
|---|---|
| **repo** | THIS directory (`apps/robotlab_x/repo/`). The monorepo source of every service. Where you edit. |
| **service** | A versioned directory under repo: `repo/<type>/<version>/`. |
| **service type** / **version** | `clock`, `1.0.0` — the two coordinates that identify a service. |
| **registry root** | A directory containing BUILT artifacts (tarballs + `catalog.yml`). Layout mirrors `repo/` but with archives instead of source. Default `/tmp/repo`, override via `REGISTRY_ROOT` env var. |
| **registry** | A registry root that's been published to a remote target (GH Releases, S3, HTTP server). A running rlx points `registry_url` at the registry's `catalog.yml`. |
| **local mirror** | A registry root that hasn't been published anywhere — but rlx can still consume it via `file:///path/to/catalog.yml`. The dev/CI workflow. |
| **build** | Walk `repo/`, package every `publish: true` `<type>/<version>/` into `<type>-<version>.tar.gz` + sha256 + metadata.json, into the registry root. Pure local, no network. |
| **publish** | Take a registry root and either leave it in place (`--kind file`, the default) or upload it (`--kind gh_release` / `--kind http`). Regenerates `catalog.yml`. |
| **bundled** | `bundled: true|false` in each `package.yml`. Whether the service's source ships inside the rlx binary download. **Independent of** `publish`. |
| **publish** (field) | `publish: true|false` in each `package.yml`. Whether the service is built + shipped to a remote registry. The single source of truth — there is no `registry.yml`. |
| **loaded** / **installed** | Two distinct states for a service on a running rlx. See `../docs/TODO_REPO.md` "Loaded vs Installed". |

**Quick mental model:**
- *repo* = source. *registry root* = built artifacts. *registry* = built artifacts hosted remotely.
- `bundled: true` = "ships inside the binary?" — a per-service `package.yml` flag.
- `publish: true` = "available remotely?" — a per-service `package.yml` flag. WHERE it ships is a `publish_services.py` transport flag, not a per-service setting.
- These are independent. A service can be both, either, or neither.
- **Two source kinds, two axes** — *exploded* local roots (`repo_dir`
  writable + read-only `repo_paths`) vs *archived* registries
  (`catalog.yml` + tgz + sha). The runtime only ever runs the exploded
  form; a registry archive is downloaded + sha-verified + extracted into
  the writable root on load. See `../docs/TODO_REPO.md` "Two kinds of
  repo source (format vs access)".


## TL;DR — make a new service in 4 commands

```bash
cd apps/robotlab_x/repo
cp -r master_template/1.0.0 my_service/1.0.0
mv my_service/1.0.0/master_template.py my_service/1.0.0/my_service.py
$EDITOR my_service/1.0.0/package.yml my_service/1.0.0/my_service.py
```

Edit `name`, `description`, `bundled` in `package.yml`. Rename the
Python class. Refresh teh catalog — your service shows up in the type catalog
at `/runtime/runtime/types/my_service`. That's it for local dev.


## Making a new service — step by step

### 1. Copy `master_template`

```bash
cd apps/robotlab_x/repo
cp -r master_template/1.0.0 my_service/1.0.0
```

`master_template/1.0.0/` is the canonical heavily-commented example
of every package.yml field + framework hook. It IS a working
in-process service (does nothing useful when started, but loads
cleanly). Trim the commentary down to what your service needs.

### 2. Edit `package.yml`

Mandatory:
- `name: my_service` — lowercase, alphanumeric + underscore, unique
  across the catalog.
- `description: |` — one short paragraph in the catalog UI.
- `bundled: false` — almost always (see below).

For an in-process service (no install step, runs inside the rlx
process — the simplest case):
- `language: builtin`
- `install.kind: builtin`
- `entry.in_process.module:` matches your `.py` filename
- `entry.in_process.class:` matches your service class name

For a subprocess service (its own venv + child process — see
`echo_http/1.0.0/` for the canonical example):
- `language: python`
- `install.kind: pip` with `package_spec: "-e ${APP_ROOT}/repo/<name>/<version>"`
- `entry.argv:` (instead of `entry.in_process`)
- Add `pyproject.toml` + `src/<name>_service/` alongside `package.yml`

### 3. Adjust the Python module

In-process variant:
- Rename `master_template.py` → `my_service.py`
- Rename `MasterTemplateConfig` → `MyServiceConfig`
- Rename `MasterTemplateService` → `MyServiceService`
- Update package.yml's `entry.in_process.module/class` to match

Subprocess variant:
- Use `repo/echo_http/1.0.0/` as the structural template.
- Your `__main__.py` uses `rlx_bus` to publish a hello, subscribe to
  control, etc. (no inheritance from `framework.Service` because
  you're in a child process).

### 4. Should `bundled` be true or false?

**`bundled: false` is the typical answer.** The rlx binary stays
small + universal that way, and operators pull services on demand
from the registry. Use `bundled: false` for:
- Anything with heavy native deps (opencv, ML models)
- Hardware-specific code (raspi, arduino)
- Anything that isn't a "must-have for every install"
- Private / WIP services you're not ready to publish

Set `bundled: true` ONLY for:
- Core utilities every operator needs (cli, clock, runtime, echo,
  cron, python)
- Common hardware adapters worth pre-shipping

`bundled: true` and "in the registry" are independent. A service can
be both — bundled in the standard download AND available in the
catalog so a stripped bundle can install it. The `bundled` flag
just answers "does `packaging/build.sh` copy this into the binary
artifact?".

### 5. Test locally

Restart rlx (`./tools/start-rlx.sh` or just rerun the backends).
Your service appears in:
- `/runtime/runtime/types/my_service` on the bus
- `/v1/service-meta-list` REST endpoint
- The Catalog page in the UI

If it doesn't, check the rlx log for package.yml parse errors or
module/class lookup failures. The framework logs both clearly.

### 6. Set `publish: true` (only if publishing)

Services in this repo are NEVER published automatically. To make one
available remotely, set the flag in its own `package.yml`:

```yaml
publish: true
```

That's the whole opt-in — there is no `registry.yml`. The build/publish
tooling walks `repo/` and acts on every version flagged `publish: true`.
Default is false (omit the field), so a service can sit in `repo/`
indefinitely without publication — normal for in-development services.
`publish` is independent of `bundled` (ships-in-the-binary) and of
`status` (maturity); WHERE a published registry ships is chosen at
publish time, not here.


## Adding a UI (Option B — modular service UIs)

A service can ship its own frontend, dynamically loaded by the host with
no host rebuild. Full design: `docs/TODO_SERVICE_UI_BUNDLES.md`.

`cp -r master_template/1.0.0 …` already brought a `ui/` template along:

```
my_service/1.0.0/ui/
  View.tsx        # the ONLY file you write — default-export React
                  #   component taking { proxy }
  package.json    # declare any THIRD-PARTY deps your view bundles
  dist/ui.js      # BUILT artifact (committed; the shipped UI)
```

1. Edit `ui/View.tsx`. Import React + everything host-provided from
   `@rlx/ui` — the only sanctioned external:
   - hooks: `useWsClient`, `useApiFetch`, `useActiveRuntime`,
     `useServiceRequest`
   - kit: `Panel`, `NumberInput`, `ConfirmDialog`, `PromptDialog`,
     `CopyButton`, `ContextMenu`
   - types: `ServiceProxy`, `ServiceMeta`, `InboundFrame`, `WsClient`

   `react` / `react-dom` / `@rlx/ui` are EXTERNALS — resolved at runtime to
   the host's single instances (one React, one bus, one auth). Never bundle
   your own React. Your OWN third-party libs (charts, editors, xterm) DO
   bundle in, tree-shaken.

2. Keep the `ui:` block in `package.yml`:

   ```yaml
   ui:
     entry: ui/dist/ui.js
     sdk: "^1.0"
   ```

3. If your view uses third-party libs, add them to `ui/package.json`
   `dependencies` (NOT react / @rlx/ui).

4. Build + vet from `apps/robotlab_x_ui/`:

   ```bash
   node scripts/build-service-ui.mjs ../robotlab_x/repo/my_service/1.0.0/ui
   npm run check:service-ui     # type-checks View.tsx against the real SDK
   # or rebuild every bundle:  npm run build:service-ui
   ```

   Commit the produced `ui/dist/ui.js` (the shipped artifact);
   `ui/node_modules` is gitignored.

5. Restart the backend so the catalog reads `ui:`; refresh the UI. The host
   loads the bundle dynamically (`serviceViews/DynamicServiceView.tsx`) —
   no host rebuild, no redeploy of the SPA.

Styling is inherited from the host's compiled Tailwind, so stick to the
utility vocabulary the host already uses (or compose `@rlx/ui` kit
components). A dependency's own CSS (e.g. xterm.css) is inlined into ui.js
automatically at build.

**Escape hatch:** to keep a view compiled into the host SPA instead (e.g.
it needs `react-router-dom`, like `python`), omit `ui:` and register the
component in `apps/robotlab_x_ui/src/serviceViews/index.ts` — the static
registry wins over the dynamic loader.


## Building + publishing

Two tools live at `apps/robotlab_x/tools/`:

- `build_services.py` — local + pure. Walks `repo/` and packages every
  `publish: true` (type, version) into the registry root.
- `publish_services.py` — assembles `catalog.yml` from the build output
  and ships it. `--kind file` (default) leaves it in place; `--kind
  gh_release` / `--kind http` upload.

**What `REGISTRY_ROOT` is — and what the default does.** Both tools
write into a single output directory, the *registry root*. It defaults
to **`/tmp/repo`** when you set nothing:

- `build_services.py` (no args) writes each archive + sha + metadata
  under `/tmp/repo/<type>/…`.
- `publish_services.py` (no args → `--kind file`) writes
  `/tmp/repo/catalog.yml` alongside them.
- A running rlx then consumes it via `file:///tmp/repo/catalog.yml`
  (which is also `registry_url`'s built-in default), OR you serve the
  `/tmp/repo` directory over HTTP and point a registry at
  `http://<host>/catalog.yml` (see "Serving over HTTP" below).

So with **zero configuration** the whole loop targets `/tmp/repo`.
Override the directory with `REGISTRY_ROOT=<dir>` (env) or `--out <dir>`
on either tool. Note `/tmp` is ephemeral — see "Where to set the
default" if you want it to survive a reboot.

### Build

```bash
cd apps/robotlab_x

# Build every publish:true service into the default REGISTRY_ROOT
./tools/build_services.py

# Custom output dir
REGISTRY_ROOT=~/my-mirror ./tools/build_services.py

# Build just one service type (ignores its publish flag — handy for testing)
./tools/build_services.py --type my_service

# Only publish:true services at >= a maturity level
./tools/build_services.py --status released
```

Produces, for each (type, version):

```
$REGISTRY_ROOT/
  catalog.yml                          # not written by build, just publish
  my_service/
    my_service-1.0.0.tar.gz            # deterministic sorted tar
    my_service-1.0.0.sha256            # one line: <hex>  <archive>
    my_service-1.0.0.metadata.json     # package.yml summary + size + sha256
```

Deterministic by design — same input → identical archive bytes →
identical sha256. No network, no side effects beyond the registry
root. Re-run as often as you want.

**Ships source, not droppings.** The archive excludes the obvious build
artifacts (`.venv/`, `__pycache__/`, `*.egg-info`, …) AND anything a
`.gitignore` covers — so a service's local venv and downloaded assets
(e.g. `video`'s large `*.pt` model weights, which it fetches at runtime)
never bloat the registry. A small *tracked* default asset (like
`video`'s `yolov8n.pt`) does ship, because it's committed source. The
walk prunes excluded dirs, so packaging a service whose local `.venv`
holds gigabytes of torch/CUDA stays fast.

### Publish to a local mirror (typical dev flow)

```bash
./tools/publish_services.py            # --kind file is the default
```

Generates `$REGISTRY_ROOT/catalog.yml` from the per-version
`metadata.json` files left by `build_services.py`. After this the
registry root is a fully-formed registry — point a running rlx at it
to exercise the install path without ever leaving disk:

```bash
ROBOTLAB_X_REGISTRY_URL=file:///tmp/repo/catalog.yml ./robotlab_x
```

This is the loop CI integration tests use — no public host required.

### Publish to a remote target

```bash
# GitHub Releases (default repo: supertick/robotlab_x-services)
./tools/publish_services.py --kind gh_release --tag services-v1
./tools/publish_services.py --kind gh_release --repo myorg/my-services --tag v1

# Any PUT-capable HTTP host (WebDAV / S3-compatible)
./tools/publish_services.py --kind http --base-url https://host/registry/
```

The transport + its config are flags (with sensible defaults), not a
`registry.yml`. `gh_release` needs the `gh` CLI authenticated; `http`
optionally takes `ROBOTLAB_X_PUBLISH_AUTH=user:pass`. Re-publishing the
same version is idempotent (gh assets use `--clobber`); shipping a new
version requires bumping it in the service's `package.yml`. Add
`--dry-run` to print the catalog + upload plan without touching anything.

### Where to set the default

If `/tmp/repo` is the wrong default for you (ephemeral, lost on
reboot), set `REGISTRY_ROOT` in your shell once:

```bash
export REGISTRY_ROOT=~/rlx-registry
```

Both scripts pick it up. No flag needed.


## Serving the registry over HTTP — installing from another machine

The local mirror at `/tmp/repo` is a flat directory; any HTTP file
server in front of it becomes a real registry. The bundled rlx already
speaks HTTP catalog URLs (`urllib.request.urlopen` covers `http(s)://`
in `runtime/registry.py`), so this works out of the box — no Phase 5
code required to do basic LAN distribution.

### On the dev box

```bash
# 1. Build + publish to the local registry root
cd apps/robotlab_x
./tools/build_services.py
./tools/publish_services.py            # --kind file (default)
# → /tmp/repo/{catalog.yml, echo/…, echo_http/…}

# 2. Serve it. ``--bind 0.0.0.0`` so the LAN can reach you;
#    drop to 127.0.0.1 if you only want local-machine access.
python3 -m http.server 8080 --directory /tmp/repo --bind 0.0.0.0

# Sanity check from the dev box itself:
curl http://localhost:8080/catalog.yml
```

Find the dev box's reachable IP / hostname for the target machine:

```bash
ip -4 -o addr show | awk '{print $4}'      # Linux
hostname -I                                # quick + dirty
```

### On the target machine — the easy way (UI Sources editor)

A running rlx can be pointed at the registry **from the UI, no restart,
no env edit** — this is the in-app counterpart to `registries` config:

1. Open the **Catalog** page → the **Sources** panel → **Edit**.
2. Under **Registries (catalog.yml URLs)** → **+ Add** →
   `http://<dev-box-ip>:8080/catalog.yml` (the *catalog*, not a tarball)
   → **Save sources**. (This persists to `config/default.registries` and
   takes effect immediately.)
3. Switch to the **Browse registry (remote)** tab → the dev box's
   services appear → **Load** (downloads the tgz, verifies the sha,
   extracts into the writable root) → **Install** (builds the venv).

That's the whole flow through the GUI. The reorder arrows set search
order when you list more than one registry; first hit wins per
`type@version`. The CLI/headless equivalent follows.

### On the target machine — headless (.env + curl)

```bash
# 1. Unpack the bundle, override port + registry URL via .env
cd robotlab_x-<version>-<platform>
cp .env.example .env
cat >> .env <<EOF
ROBOTLAB_X_PORT=8998
ROBOTLAB_X_REGISTRY_URL=http://<dev-box-ip>:8080/catalog.yml
EOF
./robotlab_x

# 2. Claim the first user via the UI at http://localhost:8998 — or
#    skip the UI and curl the claim endpoint directly:
TOKEN=$(curl -s -X POST http://localhost:8998/v1/auth/claim-first-user \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"yourpass"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

# 3. Browse the catalog — should show services from the dev box's registry
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:8998/v1/registry/catalog | python3 -m json.tool | head -40

# 4. ABSENT → LOADED — download + verify + extract
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"echo_http","version":"1.0.0"}' \
  http://localhost:8998/v1/registry/load

# 5. LOADED → INSTALLED — build the venv (for pip services) / flip the flag
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"echo_http","version":"1.0.0"}' \
  http://localhost:8998/v1/registry/install
```

After step 5, the service appears in `/v1/service-meta-list` and the
Catalog UI marks it `installed` — same shape as if it had shipped
inside the bundle.

### Gotchas

- **Firewall** — the dev box needs port 8080 open to whatever network
  the target is on (`sudo ufw allow 8080` on Ubuntu, etc.). LAN only
  in most setups.
- **`python3 -m http.server` is unauthenticated** — the catalog and
  archives are world-readable from any host that can reach the port.
  Fine on a trusted LAN; if the registry's URL would be exposed to
  the internet, put it behind nginx with basic auth, or graduate to
  Phase 5's `gh_release` target so GitHub fronts the auth + CDN.
- **HTTPS** — `urllib.request.urlopen` follows `https://` URLs
  transparently. If you put nginx in front and serve `https://…/catalog.yml`,
  the rlx side just works with no code change. For ad-hoc LAN testing
  plain HTTP is fine.
- **Catalog is re-fetched on every API call** — no caching layer
  today, so updates on the dev box show up immediately on the target
  (next time the target hits `/v1/registry/catalog`). When this
  starts being a load issue, that's when Phase 7 (cache + updates
  banner) goes in.
- **Same JWT secret across both boxes if you want federation** — not
  required for the registry path itself (registry endpoints only
  need the local rlx's own admin auth), but if the target also wants
  to peer with the dev rlx's bus, both must share `ROBOTLAB_X_JWT_SECRET`.


## Reference

- **`master_template/1.0.0/package.yml`** — every package.yml field
  documented. Schema-by-example.
- **`master_template/1.0.0/master_template.py`** — every framework
  hook (`on_start`, `@service_method`, `update_config`, …)
  documented. Reference for in-process service authors.
- **`echo_http/1.0.0/`** — the canonical subprocess service. Copy
  this directory's structure for any `install.kind: pip` service.
- **`tools/build_services.py` / `tools/publish_services.py`** — build +
  publish the registry. Driven by each `package.yml`'s `publish` flag;
  transport via `--kind` / `--repo` / `--base-url` (run with `--help`).
- **`../docs/TODO_REPO.md`** — design doc (loaded vs installed,
  phasing, open questions).
