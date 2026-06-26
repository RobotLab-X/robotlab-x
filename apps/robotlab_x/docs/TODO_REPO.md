# robotlab_x service repo — remote install plan

## Why

Today a robotlab_x bundle ships **every** service type ever defined
(arduino, video, raspi, servo, cli, clock, …). That's fine for a dev
checkout but wrong for distribution:

- A first-time operator on Windows downloads a 200 MB+ tarball that
  contains opencv (~80 MB), arduino, raspi-specific deps they may
  never use.
- Adding a new service type means cutting a new robotlab_x release.
- Operators can't share a custom service they wrote without forking
  the whole runtime.

Shape we want: **bundle ships a thin core**, everything else lives in a
**remote service catalog** the runtime can browse + install from on
demand. Operators discover types, click Install, get the bits, and the
existing install/start machinery handles the rest unchanged.

The catalog is just a static HTTP-served manifest + a flat directory
of versioned archives. No daemon to run, no DB. Hosting is a
DigitalOcean droplet or GitHub Releases; either way the runtime sees
plain HTTPS URLs.


## Vocabulary

| Term | Meaning |
|---|---|
| local repo | `<install>/repo/` directory next to the binary; what the runtime reads from |
| registry | the remote catalog (a `catalog.yml` URL + the archives it points at) |
| service type | `clock`, `video`, … (the `name` field in `package.yml`) |
| service version | `clock/1.0.0` (semver under the type) |
| service package | the archive file (`<type>-<version>.tar.gz`) for one type+version |
| install | "fetch + verify + extract + run install hook" — produces a working `repo/<type>/<version>/` dir |


## Two kinds of repo source (format vs access)

These are two **orthogonal** axes. Conflating them causes confusion, so
keep them separate.

### Axis A — format (how the bits are stored / transported)

- **Exploded** — a directory tree `<type>/<version>/{package.yml, src/…}`
  read directly off disk.
- **Archived** — a `catalog.yml` that points at per-version
  `<type>-<version>.tar.gz` + `sha256`, served over `file://`,
  `http(s)://`, or GitHub Releases.

**The runtime only ever runs the exploded form.** Archived is a
*transport*, not a runtime format — nothing executes a `.tgz`.
`registry.load` is the bridge: fetch catalog → download archive → verify
sha256 → **extract into the writable local root**. After that the type
is exploded on disk like everything else. So archives are simply how
exploded dirs travel over a network and get integrity-checked; once
landed, there's no "archive mode" left.

### Axis B — access (read-only vs writable)

A property of the **local exploded roots**:

- **Read-only sources** — the bundled `repo/` baked into the binary /
  image, or any extra `config.repo_paths` root (e.g. a shared
  `robotlab_x-services` checkout). Scanned, never written.
- **The one writable root** — `config.repo_dir` (dev `./repo`; the s1
  container's persisted `var/repo` volume). Downloads extract here and
  per-type `.venv`s build here. Installing a type whose source lives in
  a read-only root first **copies** it into the writable root, then
  builds the venv there.

### How the config knobs map

| Knob | Format | Access |
|---|---|---|
| `repo_dir` (`./repo` dev, `var/repo` container) | exploded | **writable** — loads/installs land here |
| `repo_paths` (bundled image `repo/`, shared checkouts) | exploded | read-only |
| `registries` / `registry_url` (catalog + tgz + sha) | **archived** | read-only (consume only) |

### Deliberately not a thing

- **A "writable registry"** — the runtime never writes back to a
  registry. Publishing is the separate `tools/build_services.py` +
  `tools/publish_services.py` path; the runtime only *consumes*.
- **A "remote exploded repo"** — remote is always an archive catalog;
  local is always exploded dirs. (A git-clone-of-exploded-tree source
  could be added later, but doesn't exist today.)


## What we have today

- `apps/robotlab_x/repo/<type>/<version>/package.yml` + source + (for
  subprocess services) a `pyproject.toml`.
- The build (`packaging/build.sh`) copies the whole `repo/` next to the
  binary so it lives at `<install>/repo/`.
- In-process services (`kind: builtin`, `in_process: true`) load via
  importlib from `repo/<type>/<version>/src/...` —
  `framework/adapters/in_process.py:_resolve_repo_dir`.
- Subprocess services install a per-type venv at
  `repo/<type>/<version>/.venv/` via `lifecycle.install` (uv + pip
  install -e).
- Service metadata is published to `/runtime/runtime/types/...` and
  `/v1/service-meta-list` — both read from local `repo/` walking, not
  from any remote source.

So the runtime already has a clean filesystem contract: drop a properly
shaped directory under `repo/<type>/<version>/` and the existing
machinery picks it up. **Remote install is just "how the directory got
there"** — nothing in the framework needs to know whether you cloned
it from git, untarred it, or pulled it from a registry.


## Source of truth: the monorepo's `apps/robotlab_x/repo/`

**The registry has no service source of its own.** All service code
lives in this cloudseeder monorepo at `apps/robotlab_x/repo/<type>/
<version>/` and is developed exactly as today — edit the files, commit
a PR, run rlx locally to test. No "publish to test" loop in normal
dev flow.

The registry is a **build artifact** of that monorepo: a periodic (or
on-tag) job walks `apps/robotlab_x/repo/`, filters which services to
publish (some stay bundle-only, some are private, some are
work-in-progress), packages each into a versioned tarball, computes
sha256, and ships the archives + a regenerated catalog file to the
hosting target. The runtime then sees the same content remotely that
the dev sees locally.

This split has real consequences for tooling, which is why it gets
its own section under "What's missing" below:

- **build_services** — selective filter over the monorepo, produces
  `<out>/<type>/<type>-<version>.tar.gz` + sha256 + a per-version
  metadata JSON. Pure local operation, no network. Run by CI on a
  release tag, OR by a dev manually for testing.
- **publish_services** — takes the build output and uploads it to
  the configured target (GH Releases, S3, DO Spaces, or — critically
  for offline dev — a local `file://` directory). Regenerates and
  publishes `catalog.yml`.

Both scripts must support **a local mirror target** as a first-class
option so the entire install path (catalog fetch → archive download →
verify → extract) can be exercised end-to-end without going to the
public internet. The runtime's `registry_url` config knob points at
the local mirror in this mode (e.g. `file:///tmp/rlx-mirror/`).

> **SUPERSEDED (shipped differently).** The `registry.yml` allow-list
> described in the rest of this section was NOT built. It was replaced by
> a per-service **`publish: true|false`** flag in each `package.yml` (the
> same place `bundled` lives) — `build_services.py` / `publish_services.py`
> walk `repo/` and act on every `publish: true` version. WHERE a published
> registry ships (file mirror / HTTP / GitHub Releases) is a transport
> chosen by `publish_services.py`'s `--kind` / `--repo` / `--base-url`
> flags, not declared per service. So the "two orthogonal lists" below are
> now **two orthogonal per-service flags** (`bundled`, `publish`). The
> prose below is kept as the original rationale.

The filter is config-driven, not hardcoded. **Two orthogonal lists**:

1. **`bundled: true|false` in each service's `package.yml`** is the
   authoritative answer to "ships inside the binary bundle?". The
   packaging tooling (`packaging/build.sh`) walks `repo/` and copies
   only entries with `bundled: true` into the bundle. This is the
   per-service flag, lives next to the code, and is the natural place
   for the author of a service to declare its bundle posture.
2. **A new `apps/robotlab_x/repo/registry.yml`** declares what
   PUBLISHES to which remote target. Different concern entirely:
   a service can be `bundled: true` and ALSO published (so a stripped
   bundle can re-install it), or `bundled: false` and published
   (the typical "optional" case), or `bundled: false` and NOT
   published (private dev only).

```yaml
# apps/robotlab_x/repo/registry.yml
# What gets packaged + uploaded to which target. Default-deny — types
# not listed here are NEVER published. The per-service ``bundled``
# field is independent of this list; both are read by the build/publish
# tooling for their respective concerns.
publish:
  - type: video
    versions: ["1.0.0"]
    targets: [public]
  - type: arduino
    versions: ["1.0.0"]
    targets: [public]
  - type: raspi
    versions: ["1.0.0"]
    targets: [public]
  - type: kinematic_proto
    versions: ["0.1.0-dev"]
    targets: [private]                  # private mirror only

targets:
  public:
    kind: gh_release
    repo: supertick/robotlab_x-services
  private:
    kind: http
    base_url: https://private.robotlab-x.example/registry/
  local:
    kind: file
    base_dir: /tmp/rlx-mirror
```

Devs developing a new service add it to `repo/<name>/<version>/` —
that's enough to make it usable from a checkout. Set `bundled: true`
in its `package.yml` to also ship it in the binary; add it to
`registry.yml` to also publish it remotely.

**Starting a new service: use the master_template.** A reference
manifest lives at `apps/robotlab_x/repo/master_template/1.0.0/` with
every package.yml field heavily commented. Copy that directory,
rename, strip the commentary down to what your service needs. The
in-process service file (`master_template.py`) gives the same
treatment to the framework hooks (`on_start`, `@service_method`,
`update_config`, etc.). New service authors should look there first
rather than reverse-engineering an existing service.


## Loaded vs Installed — two distinct stages

These are different things and the model has been conflating them:

### Stages

```
┌─────────┐  registry fetch + extract   ┌────────┐  install hook       ┌───────────┐
│ ABSENT  │ ──────────────────────────▶ │ LOADED │ ──────────────────▶ │ INSTALLED │
│         │     (or monorepo checkout    │        │   (venv build,      │           │
│         │      where everything is     │        │    user config,     │           │
│         │      pre-loaded)             │        │    hardware probe)  │           │
└─────────┘                              └────────┘                     └───────────┘
                                              │                              │
                                              │           Start              │
                                              ▼                              ▼
                                         /v1/service-meta visible      service_proxy(status=running)
                                         in the type catalog
```

### Definitions

- **ABSENT** — no `repo/<type>/<version>/` directory. Type is not
  visible in `/runtime/runtime/types/`. Only the catalog (if reachable)
  knows it exists.
- **LOADED** — the directory exists, `package.yml` parses, the
  framework has registered the type. Metadata flows through to
  `/v1/service-meta-list` and `/runtime/runtime/types/`. UI Catalog
  shows it as a known type, but it isn't ready to Start. **This is
  what a fresh `tar -xzf` of a registry archive produces.**
- **INSTALLED** — install hook has completed: for subprocess services
  the per-type `.venv/` is built and deps are present; for any
  service that needs user-supplied config (API keys, hardware pins,
  network endpoints) the wizard has captured that config; for
  hardware-touching services any required permission / device-node
  check has passed. Ready to Start.

A LOADED service can sit indefinitely without being installed —
useful when the operator wants to browse the type's docs / methods /
config schema before committing to the heavy install step.

### Why this matters

- **Dev mode runs everything LOADED out of the box.** When rlx runs
  from a monorepo checkout, every directory under
  `apps/robotlab_x/repo/` is loaded on startup — the dev sees their
  in-progress service in the type catalog immediately. INSTALL only
  happens on the first Start, the same way it does today. No
  separate publish/install loop.
- **Bundle installs start with only the core LOADED.** Anything
  else is ABSENT until the operator picks it from the catalog. The
  catalog → install path goes ABSENT → LOADED → (Start triggers)
  INSTALLED.
- **The two transitions have very different failure modes.** LOADED
  fails on network / sha256 / extraction. INSTALLED fails on missing
  build tools / hardware / bad user config. Surfacing them
  separately in the UI lets the operator see "I have the bits but
  the install is failing" vs "I never got the bits in the first
  place" — today both errors collapse to a single red "install
  failed" banner.
- **Sideload becomes trivial.** An operator with an archive on disk
  but no internet drops it in `repo-staging/`, the runtime extracts
  it → LOADED. They click Install → INSTALLED. Same flow, just
  different source of the archive.

### Model changes

The existing `service_meta.installed: bool` (in
`templates/apps/robotlab_x.yml`) is a TWO-state flag that doesn't
capture LOADED-but-not-INSTALLED. Migration:

- Add `service_meta.install_phase: Literal["loaded", "installing",
  "installed", "failed"]`.
- Keep `installed` for one release as a derived view
  (`install_phase == "installed"`) so the UI doesn't have to flip
  in lockstep — then deprecate.
- `installation_exception` remains, gated on `install_phase ==
  "failed"`.

Alternative names considered for "loaded": *present* (filesystem-y
but doesn't capture "framework has registered the type"), *staged*
(implies staging-area transience, which it isn't), *available*
(reads from the catalog's POV, not the local one). "Loaded" wins
because the framework already uses "load" for `_load_service_class`
— same word, same meaning.


## What's missing

1. **A remote catalog** — a single YAML/JSON file at a known URL
   listing every available service type + version with archive URL +
   sha256 + compatibility metadata.
2. **Per-service archives** hosted somewhere reachable.
3. **Backend endpoints** to fetch the catalog, transition a type
   ABSENT → LOADED (the network + extract step) and LOADED →
   INSTALLED (the existing install hook). And the reverse for
   uninstall / unload.
4. **UI** — the Catalog page already lists installed types; extend it
   to surface ABSENT types with a Load button, LOADED types with an
   Install button, INSTALLED types with Start/Stop/Remove. Three
   visually distinct states, three different failure modes.
5. **`tools/build_services.py`** — local, no network. Reads
   `apps/robotlab_x/repo/registry.yml` (see "Source of truth" above)
   to know which types/versions to package; for each, runs the same
   "tar the dir, exclude `.venv/`, compute sha256, emit metadata
   JSON" steps; writes into a configurable output directory.
6. **`tools/publish_services.py`** — takes the output of
   build_services and uploads it to the configured target (GH
   Releases / S3 / DO Spaces / local mirror). Regenerates and
   publishes `catalog.yml`. Idempotent — re-publishing the same
   version-sha pair is a no-op; bumping a version requires
   changing `package.yml`'s version field. Without these two
   scripts publishing is manual and error-prone.
7. **Sideload directory** — `<install>/repo-staging/`. On startup the
   runtime checks for archives there, extracts them into `repo/`,
   logs the sideload. Lets an operator install a service from a USB
   stick without any registry network access; same code path the
   registry uses for ABSENT → LOADED, just a different archive
   source.


## Core vs optional split

What ships in the bundle vs lives in the registry. Recommendation:

| Ship in bundle | Pull on demand |
|---|---|
| `cli` — used by every operator to inspect the runtime | `video` — opencv is heavy + platform-fiddly |
| `clock` — smoke-test and demo | `arduino` — pymata4 + serial; Linux-only ports |
| `echo` — smoke-test | `servo` — depends on arduino |
| `cron` — common scheduler use case | `raspi` — Linux-only GPIO |
| `python` — generic script runner, no native deps | `echo_http` — demo of pip-installed subprocess |
| `runtime` — the runtime's own management service | (future) `kinematic`, `slam`, `vision_*`, etc. |

Roughly: anything pure-Python with no native or hardware deps and
universal value → core. Anything with native deps, hardware tie-in, or
narrow audience → registry.

Bundle size before/after this split is the headline win: video alone
pulls ~80 MB of opencv binaries.


## Catalog format

A single file the registry hosts at a stable URL. Versioned at the
top so we can evolve the schema:

```yaml
# https://repo.robotlab-x.com/catalog.yml
registry_version: 1
maintainer: supertick/cloudseeder
updated_at: 2026-06-01T00:00:00Z

services:
  - name: video
    description: |
      Capture + filter video frames over the bus. OpenCV-backed.
    tags: [vision, camera, opencv]
    versions:
      - version: 1.0.0
        archive: https://repo.robotlab-x.com/video/video-1.0.0.tar.gz
        sha256: 6f3a9d…                # required; verified post-download
        size_bytes: 12_345_678         # optional, shown in UI
        min_runtime: "0.1.0"           # robotlab_x version this needs
        platforms:                     # filter by host arch / OS
          - linux-x86_64
          - linux-aarch64
          - darwin-arm64
          - windows-x86_64
        notes: |
          First public release. Filters: gray, edges, blur, sonar-overlay.

  - name: arduino
    description: Firmata-over-serial board interface (pymata4).
    tags: [hardware, firmata]
    versions:
      - version: 1.0.0
        archive: https://repo.robotlab-x.com/arduino/arduino-1.0.0.tar.gz
        sha256: 81d44e…
        platforms: [linux-x86_64, linux-aarch64]   # serial /dev path Linux-only
        min_runtime: "0.1.0"
```

The archive itself is a tarball containing the same shape we already
use locally — `<type>-<version>/package.yml`, `src/...`,
`pyproject.toml` (for subprocess services). Extraction lands directly
at `repo/<type>/<version>/`.


## Hosting

Three options, ranked by ops cost:

1. **GitHub Releases on a dedicated repo** (e.g.
   `supertick/robotlab_x-services`) — recommended for v1. Free,
   signed by GitHub, CDN-fronted. The `catalog.yml` lives in the repo
   itself (committed); archives are release assets. Publishing
   workflow tags a release and uploads the archive.
2. **DigitalOcean Spaces + Cloudflare** — when bandwidth grows. Spaces
   gives S3-compatible storage; CF in front for free egress.
3. **DO droplet + nginx static serve** — most control, ~$6/mo. Useful
   only if we want path-based dynamic features (signed URLs, per-org
   private mirrors).

Start with (1). Migrating to (2) later is a URL change in the catalog
plus regenerating the catalog file — operators don't have to do
anything (their runtime re-fetches the catalog).


## Backend implementation sketch

New module `apps/robotlab_x/src/robotlab_x/runtime/registry.py`:

```python
async def fetch_catalog() -> Catalog: ...
async def install(name: str, version: str) -> ServiceMeta:
    """download → verify sha256 → extract → register in service_meta table.
    Subprocess services then go through the existing lifecycle.install
    path (venv + pip install -e) — registry only owns "get the bits"."""
async def uninstall(name: str, version: str) -> None: ...
```

Cache layer:
- The catalog is fetched on demand and cached locally
  (`<data_dir>/registry/catalog.yml`) with a TTL (1 hr default,
  overridable via config). UI Catalog page reads from cache; explicit
  Refresh button hits the registry.
- Archives are not cached — downloaded once, extracted, archive
  deleted.

REST shape (new endpoints on the existing `/v1` surface):
```
GET    /v1/registry/catalog            → cached catalog json
POST   /v1/registry/refresh            → force re-fetch from upstream
POST   /v1/registry/install            body: {name, version}  → install_request id
GET    /v1/registry/install/{id}       → progress (downloading / extracting / installing / done|failed)
DELETE /v1/registry/{name}/{version}   → uninstall
```

The install is async because subprocess service installs (pip + venv)
take real time; status SSE'd over the bus to `/registry/install/{id}`
so the UI can show a progress bar.


## UI changes

`apps/robotlab_x_ui/src/pages/Catalog.tsx` (or wherever the type
listing lives) gets a remote/local toggle:

```
[● Installed]  [○ Browse registry]      Refresh ↻

video          1.0.0    [Install]      vision, camera, opencv
arduino        1.0.0    [Install]      hardware, firmata
slam           0.2.1    [Install]      navigation       (alpha)
```

Installed types stay where they are; remote types listed alongside
with status (not-installed / newer-available / installing / installed).
Filter by tag, search by name, with a click-through page showing the
service's README pulled from the catalog `description`.

Same UI handles uninstall — already-installed types get a `Remove`
button instead of `Install`.


## Build + publish tooling

Two scripts, separated so "build" can be tested without ever touching
the network. Both driven by the monorepo's
`apps/robotlab_x/repo/registry.yml` (see Source of truth above).

### `tools/build_services.py`

Pure-local build step. Reads `registry.yml`, walks the listed
`<type>/<version>/` dirs under `apps/robotlab_x/repo/`, packages each.

```bash
tools/build_services.py                              # build everything in registry.yml
tools/build_services.py --type video                 # build just one type
tools/build_services.py --out /tmp/rlx-mirror/build  # custom output dir
```

For each (type, version), produces:

```
<out>/<type>/<type>-<version>.tar.gz       # the archive
<out>/<type>/<type>-<version>.sha256       # one line: <hex>  <archive>
<out>/<type>/<type>-<version>.metadata.json
   {
     "name": "video",
     "version": "1.0.0",
     "size_bytes": 12345678,
     "sha256": "abcdef…",
     "description": "...",   # from package.yml
     "tags": [...],          # from package.yml
     "min_runtime": "0.1.0",
     "platforms": [...],
     "language": "python",
     "dependency_manager": "uv"
   }
```

Excludes `.venv/`, `__pycache__/`, build outputs, anything in
`.gitignore`. Deterministic — same input dir → same archive bytes →
same sha256 (uses `tar --sort=name --owner=0 --group=0 --mtime` for
reproducibility).

### `tools/publish_services.py`

Network step. Reads the build output and ships it.

```bash
tools/publish_services.py --target public      # → GH Releases at supertick/robotlab_x-services
tools/publish_services.py --target private     # → private HTTP host
tools/publish_services.py --target local       # → file:// mirror at the configured base_dir
tools/publish_services.py --dry-run --target public  # show what would happen
```

For each target type (`gh_release`, `http`, `file`) there's a per-
backend uploader. After uploads succeed, regenerates `catalog.yml` by
merging every type's `metadata.json` into the catalog schema, then
publishes the catalog itself to the target (a release asset for
`gh_release`, a PUT for `http`, a file copy for `file`).

Idempotent — re-publishing the same (type, version, sha256) tuple is
a no-op. Bumping requires editing `package.yml`'s `version` field.

### Why this matters for dev / local testing

The `--target local` flag is what makes the end-to-end install path
testable in isolation:

```bash
tools/build_services.py --out /tmp/rlx-mirror/build
tools/publish_services.py --target local --build-from /tmp/rlx-mirror/build
# → /tmp/rlx-mirror/catalog.yml
# → /tmp/rlx-mirror/<type>/<type>-<version>.tar.gz

ROBOTLAB_X_REGISTRY_URL=file:///tmp/rlx-mirror/catalog.yml ./robotlab_x
# Now the bundled rlx fetches its catalog from local disk, installs
# work the same as production, no internet involved.
```

Drops into CI naturally too — the same mirror dir + bundled rlx is
all you need for an integration test of the install flow.


## Phasing

Reordered to land **build_services.py + local mirror first** so every
later phase can be tested without depending on a public host.

1. **Phase 1 — `registry.yml` + build_services.py + local mirror.**
   Add `apps/robotlab_x/repo/registry.yml`. Write `build_services.py`
   that walks it and produces archives + per-version metadata in a
   local output dir. Write `publish_services.py` with the `file://`
   target only — produces a fully-formed `catalog.yml` + archive tree
   under `/tmp/rlx-mirror/`. No network code yet. Verify with
   `curl file:///tmp/rlx-mirror/catalog.yml`. End state: every later
   phase can run against this local mirror.
2. **Phase 2 — Backend reads the catalog.** Add
   `runtime/registry.py` with catalog fetch + cache. New endpoint
   `GET /v1/registry/catalog` returns the parsed catalog scoped to
   `install_phase` per type (ABSENT / LOADED / INSTALLED). The UI's
   Catalog page renders types in the three states. No state
   transitions yet — read-only.
3. **Phase 3 — ABSENT → LOADED transition.** Backend
   `POST /v1/registry/load` downloads + sha256 verifies + extracts
   to `repo/<type>/<version>/`. UI's "Load" button on ABSENT rows.
   No install hook runs yet. Failure modes: network, sha256, disk
   full, extract error — all distinct user-facing messages.
4. **Phase 4 — LOADED → INSTALLED transition.** Wire the existing
   install hook (uv venv + pip install -e for subprocess services)
   into the catalog UI as an "Install" action on LOADED rows.
   Verify the bundled binary can find `uv` (it can't today — needs
   the bundled-uv work below).
5. **Phase 5 — `publish_services.py` with real targets.** Add the
   `gh_release` target (and `http` for self-hosted mirrors).
   Publishing a service is now `tools/build_services.py && tools/
   publish_services.py --target public`. Reachable from any dev box.
6. **Phase 6 — Sideload directory.** `<install>/repo-staging/` —
   archives dropped there get extracted into `repo/` on startup.
   Air-gapped install path; reuses Phase 3's extract code.
7. **Phase 7 — Updates.** UI shows "newer version available" banner
   when local + catalog disagree on the highest version.
8. **Phase 8 (optional) — Signing.** GPG-sign the catalog so a
   compromised mirror can't inject bad services. Probably overkill
   until we have third-party consumers; sha256 in the catalog already
   detects tampering of individual archives.


## Open questions

1. **Bundle uv or call pip directly?** The LOADED → INSTALLED
   transition for subprocess services needs *some* Python package
   manager available in the bundled binary's environment. Today's
   bundle has no uv on PATH (the dev `.venv/uv` isn't shipped).
   Options: (a) include the uv binary in `_internal/` and use it via
   absolute path; (b) fall back to PyInstaller's bundled `pip`
   somehow; (c) require the operator to install uv separately as a
   documented prereq. (a) is cleanest and is a prerequisite for
   Phase 4.

2. **Platform-specific availability.** The catalog's `platforms` field
   lets the UI hide types that won't work on the host. But what's the
   source of truth — the catalog editor decides per release, or the
   `package.yml` declares + the publish tool extracts? Latter is more
   maintainable but means `package.yml` gains a new field.

3. **Migration story for currently-bundled-but-optional types.** If
   we strip video/arduino/etc from the bundle, fresh installs need
   the registry to be reachable to do anything useful with hardware.
   Options: (a) hard split — bundle = core only, registry mandatory;
   (b) "starter pack" bundle that includes the most common
   hardware services for the install target's platform; (c) keep
   the everything-bundle as one download flavor, ship a smaller
   "core" flavor alongside. (b) is friendliest, but doubles the
   build matrix; (a) is simplest but punishes first-time users with
   no internet at the install location.

4. **Custom / private services.** An operator with their own service
   they don't want to publish publicly — how do they install it?
   Options: (a) point `registry_url` at their own catalog (already
   supported by the design above — it's just a config knob); (b)
   sideload by dropping an archive into a known directory;
   (c) `tools/publish-service.sh` supports a `--local-mirror` mode
   that writes to a local catalog file. Probably want all three.

5. **Federation with installed-vs-not types.** Runtime A has video,
   runtime B doesn't. A publishes `/video/video-1/state` over the
   bus, B is subscribed. Does B need the type to display the
   payload? Almost certainly no — the bus is type-agnostic, the
   payload is JSON. The Composer UI's "ghost node" rendering for
   unknown types already covers this. Worth confirming though.

6. **Versioning of the runtime API.** When we add a new framework
   capability (say, a new method on `Service`), older services pulled
   from the catalog won't have it. `min_runtime` field handles
   forward compat (won't install a service that needs a newer
   runtime), but what about the reverse — runtime sees a service
   archive that requires an *older* API? Probably negligible at this
   stage; revisit when we have ≥ 2 stable releases.

7. **DECIDED — Uninstall returns to LOADED, not ABSENT.** Uninstall
   tears down what installation produced — the per-type `.venv/`,
   captured wizard config, any global rlx config the service
   registered. The service's source files (and its place in the
   catalog) stay. Operators who want to truly remove a service's
   files use a separate "Remove" action that drops to ABSENT;
   bundled services (`bundled: true`) can't be Removed because
   re-extracting the bundle would bring them back — Remove is
   disabled in the UI for those.
   Rationale: keeping stages granular lets the user keep their
   wizard input across uninstalls if they want to. The reverse —
   collapsing Uninstall and Remove into one action — would force
   network re-download for every reinstall and lose any captured
   per-instance config the user might want to reuse.

8. **DECIDED — The registry only acts on `bundled: false` services
   (and remotely-installed copies of `bundled: true` ones).** The
   authoritative list of "what's in the bundle" lives in each
   service's `package.yml` via the `bundled: true|false` field, not
   in a separate central list. `build.sh` walks `repo/` and copies
   only `bundled: true` entries into the artifact. `registry.yml`
   (separate file) decides what to publish remotely. The two are
   independent — see "Source of truth" above. UI consequence: the
   "Remove" action that drops a service to ABSENT is disabled for
   services whose package.yml says `bundled: true`, because the
   next bundle extraction would bring them back. Uninstall (drop
   to LOADED) is always allowed.

9. **Does the build_services.py archive contain `package.yml` only,
   or also a snapshot of the framework version it was built
   against?** Pinning matters for the `min_runtime` check at install
   time. Simplest: the `package.yml` already has `min_runtime`;
   `build_services.py` validates it's set and refuses to package
   without it.


## Decisions needed before starting Phase 1

Phase 1 itself is entirely local (no hosting picked), so these can
be deferred until Phase 5 — but answering early lets the catalog
schema design assume the right shape:

1. **Where does the public `catalog.yml` live?** GH Releases (recommended
   default; free, signed) vs the DigitalOcean cloud server. Decide
   before Phase 5 so URLs in test code are stable.
2. **What's the canonical core/optional split?** Drives which
   services have `bundle_in_core: true` in `registry.yml` and which
   get stripped from the bundle in the packaging change.
3. **Does `service_meta.installed` get replaced with `install_phase`
   or supplemented?** Either way it's a model change that needs to
   land before Phase 2 makes the UI three-state. My lean:
   supplement first (both fields, `installed` becomes a derived view),
   migrate UI, then drop `installed`.
4. **Are private/work-in-progress services published to a private
   mirror or just kept out of `registry.yml` entirely?** "Out of
   registry.yml" is simpler and probably enough. A private mirror
   only matters if you want to share private services across a team
   without committing to the public registry.


## Out of scope for v1

- Dependency graphs between services. "video depends on opencv-python"
  is handled by the service's own pyproject.toml; we're not building
  a package manager for service-on-service deps.
- A web UI for browsing the registry outside the runtime (i.e.
  "robotlab_x.dev/services" as a landing page). Nice eventually,
  not on the critical path.
- Multi-tenant private registries with auth. The registry is public
  HTTPS for v1; private setups can run their own mirror.
- Telemetry on installs ("count of video installs across the world").
  Not collecting anything until there's a real reason to.
