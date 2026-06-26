# robotlab_x Config Sets — Design Spec

A uniform, file-driven configuration framework for every service in the
runtime. Replaces the current "config blob inside the TinyDB row" model
with named folders of yml files that operators can edit, diff, share,
and version-control by hand.

The trigger was a concrete bug — Brain backend settings (ollama URL,
api keys, model names) were not persisted across restart — but the
fix landed at the architecture layer because the existing
`save_config()` contract is opt-in, easy to forget, and tied to a
specific persistence backend. This spec is the agreed shape; once
landed, the brain bug disappears as a side effect.

The pattern is lifted (with the user's blessing — they shipped it in a
prior Java framework) and adapted to robotlab_x's primitives: capability
interfaces, in-process Service framework, bus-as-substrate, Pydantic
configs.


## Core principles

```
File is truth.
TinyDB owns only ephemera (status, pid, started_at, error, heartbeat).
Configs live in named "config sets" — folders the operator owns.
One file per service instance, named by proxy_id.
Type is a field at the top of each yml — rename = rebind.
Switching sets = restart. No hot-swap.
Security singleton handles all crypto; configs round-trip through it.
Every service inherits the same wire-level config API.
```


## Why files

- **Editable**: `vi` works. No DB tool required.
- **Diffable + versionable**: `git diff` shows config changes.
- **Shippable**: `tar czf demo.tgz config_sets/demo/` is a complete demo.
- **Inspectable**: the canonical state is on disk, not behind an API.
- **Familiar**: matches how operators already think about robotlab_x
  (per-instance log files, per-instance workspace dirs).
- **Failure mode**: a corrupt yml is a clear, fixable error — not an
  opaque "row missing column" mystery.


## Directory layout

```
data/config_sets/
  default/                            # always present; the boot fallback
    runtime.yml                       # start_order only
    brain-1.yml                       # type + config for proxy "brain-1"
    arduino-1.yml
    servo-1.yml
    servo-2.yml
    ui-1.yml                          # canvas state lives here
    runtime-1.yml                     # the runtime singleton's own config (optional)
    amazon-speech.yml                 # parked candidate — not in start_order
    openai-speech.yml                 # parked candidate
  demo/                               # named alternate set
    runtime.yml
    ...
  guest/
    ...
```

Active set is selected by env var (default: `default`):

```
ROBOTLAB_X_CONFIG_SET=demo
```

If `ROBOTLAB_X_CONFIG_SET` is unset or the named folder doesn't exist,
fall back to `default`. If `default/` doesn't exist either, fail loud.


## File shapes

### `runtime.yml`

The minimum viable shape — just orchestration:

```yaml
start_order:
  - speech-1
  - brain-1
  - arduino-1
  - servo-1
  - servo-2
  - ui-1
```

That's it. No types, no proxies map. `runtime` and `security`
singletons are auto-prepended by the loader; the operator can't reorder
them.

Other runtime-level concerns (log level, port, runtime_id, federation
peers) belong in `runtime-1.yml` — the singleton runtime service's own
config file — not in `runtime.yml`. This keeps `runtime.yml` to pure
orchestration and means the runtime service is configured by the same
mechanism as every other service.

### `<proxy_id>.yml`

Type at the top, then the Pydantic config dump:

```yaml
# brain-1.yml
type: brain@1.0.0

default_model: ollama
ollama_base_url: http://localhost:11434
ollama_model: llama3.1
anthropic_api_key: Encrypted--abc123…   # round-tripped through security
openai_api_key: Encrypted--def456…
max_concurrent_runs: 4
workspace_path: null                    # null → default to <data_dir>/brain/brain-1/
```

The loader reads `type:` first → resolves to the Service class via the
registry → validates the rest of the dict against `config_class`. The
type field's presence is what makes the file bindable; a yml without
`type:` is invalid (or just a note file).

### Candidates

Any `<name>.yml` in the active set whose name isn't in `start_order` is
a **parked candidate**. UI lists them as "available implementations."
To swap an implementation:

```bash
mv data/config_sets/default/speech-1.yml data/config_sets/default/amazon-speech.yml
mv data/config_sets/default/openai-speech.yml data/config_sets/default/speech-1.yml
# restart
```

Two `mv`s. Rollback is two more `mv`s. Git diff shows the swap as
file renames. UI exposes this as a "swap" button that does the same
operation; nothing magical underneath.

Discovery is **pure presence** — no `candidates:` field in
`runtime.yml`, no `.parked.yml` suffix convention. Any `.yml` not in
`start_order` shows up as a candidate. Files that fail to parse as
valid yml (or lack a `type:` field) are surfaced as warnings, not
candidates.


## The Service contract

Each service declares its config class:

```python
class BrainConfig(ServiceConfig):
    default_model: str = "mock"
    ollama_base_url: str = "http://localhost:11434"
    # ...

class BrainService(Service):
    config_class = BrainConfig

    async def apply_config(self, diff: dict) -> None:
        """Optional. React to a config change live. Default: no-op.
        Called after a successful set_config; diff carries only the
        changed leaves. Subclass implements only the deltas it can
        apply without restart."""
        ...
```

The framework auto-mounts these `@service_method`s on every service
that declares a `config_class`:

| Action | Behavior |
|---|---|
| `get_config()` | Return current effective config as a dict (secrets MASKED — never echo `Encrypted--*` over the wire) |
| `set_config(patch)` | Validate patch + current → persist to file → call `apply_config(diff)` |
| `save_config()` | Round-trip current in-memory config back to file (no validation change) |
| `reload_config()` | Re-read file from disk → validate → call `apply_config(diff)` |

No service code calls `save_config()` by hand. The framework owns the
write path; services declare schema + react to deltas.


## The loader pipeline

```
1. Read $ROBOTLAB_X_CONFIG_SET (default "default")
2. Read <set>/runtime.yml::start_order
3. Prepend [runtime, security] to the order
4. For each proxy_id in order:
     a. Read <set>/<proxy_id>.yml
     b. type field → resolve Service class via registry (must exist)
     c. Walk dict; for every leaf string matching ^Encrypted--:
          → call security.decrypt(); replace with plaintext
     d. Validate plaintext dict against type's config_class
     e. Instantiate service; call apply_config(initial_values)
     f. Verify type's requires[] are satisfied by already-started proxies' implements[]
     g. Start service
```

Failure modes are explicit and logged:

- yml fails to parse → start aborts on that proxy; mark `status=error`;
  continue or fail-fast (TBD — default fail-fast for the first one)
- `type:` field missing → invalid config file; skip with warning
- Type not in registry → unresolvable; abort with clear message
- Pydantic validation fails → abort with field-level error
- Required capability not satisfied → abort with capability + missing
  implementer name


## Security singleton + crypto round-trip

A new singleton service-type ships at `repo/security/1.0.0/`:

```yaml
# repo/security/1.0.0/package.yml
name: security
version: 1.0.0
language: builtin
singleton: true
implements: [crypto]
bundled: true
install: { kind: builtin }
entry:
  in_process:
    module: security
    class: SecurityService
```

Bus actions:
- `encrypt(plaintext: str) -> str` — returns `Encrypted--<base64>`
- `decrypt(ciphertext: str) -> str` — accepts `Encrypted--<base64>`,
  returns plaintext; raises if input doesn't have the prefix or fails
  to decrypt

The framework's pre-persist + post-load hooks call into security:

```
ON LOAD  (file → service):
  yml plaintext "Encrypted--xyz" → security.decrypt() → "real_value"
  yml plaintext "Encrypt--foo"   → security.encrypt() → on next save becomes "Encrypted--<…>"
                                   (immediate use: plaintext "foo")

ON SAVE  (service → file):
  config_class.model_dump() → walk leaves → if a field is marked
  "secret" (TBD — Pydantic Field metadata or a SecretStr type),
  encrypt before write
```

**Key insight**: the Pydantic config class stays innocent. It never
sees `Encrypted--*` strings; the persistence layer handles encryption
in both directions. New service authors get crypto for free; they
just mark sensitive fields with `SecretStr` (or a `secret=True` marker)
and the loader does the rest.

The user-facing "type `Encrypt--myrawpassword` in the file by hand"
convenience is the explicit path: paste a plaintext with the prefix,
next save round-trips it to `Encrypted--<…>`. The Python service never
sees the `Encrypt--` form; it's a load-time tag for the operator's
convenience.

### Crypto material

The security service needs a key. Options (TBD):
1. Generated on first boot, stored at `data/security/key.bin`,
   `chmod 600`. Same machine = same key. Lose the file = lose every
   `Encrypted--*` in every set.
2. Operator-provided via env var (`ROBOTLAB_X_SECURITY_KEY`); falls
   back to (1) if unset.
3. KMS / Vault integration as a future plug-in.

Default to (1) + (2). Federation peers must share the key file if
they share encrypted configs, which is a feature, not a bug.

### Boot order constraint

Security MUST come up before any service that decrypts a value.
That's why it's auto-prepended right after runtime. If security
fails to start, the loader aborts the whole boot — there's no
meaningful partial state when crypto isn't available.


## Capability interlock

The existing `implements:` / `requires:` fields in `package.yml`
become the contract that makes swap-by-rename safe. Today:

```yaml
# repo/arduino/1.0.0/package.yml
implements: [servo_controller]
```

```yaml
# repo/servo/1.0.0/package.yml
requires: [servo_controller]
```

```yaml
# servo-1.yml
type: servo@1.0.0
controller_id: arduino-1     # bind by name
```

At boot, when `servo-1` is starting:
- Servo declares `requires: [servo_controller]` (from its type's package.yml)
- Loader checks: is there a started proxy whose type implements
  `servo_controller`? `arduino-1` is up, its type `arduino@1.0.0`
  implements it. ✓
- Servo binds. If the operator swapped `arduino-1.yml` for a candidate
  whose type doesn't implement `servo_controller`, boot refuses with:
  `servo-1 requires servo_controller, but arduino-1's type
  fakeboard@1.0.0 doesn't implement it`.

**Field cleanup**: today servo's config carries both `controller_type:
arduino` AND `controller_id: arduino-1`. The `controller_type` field
leaks the implementation choice. It goes away — only `controller_id`
remains. The capability check covers the contract that `controller_type`
was loosely enforcing.


## What TinyDB still owns

Pure ephemera — things that change as the runtime runs:

| Field | Meaning |
|---|---|
| `id` | proxy_id (same as file name minus `.yml`) |
| `status` | starting / running / stopping / stopped / error |
| `pid` | OS process id (or backend pid for in-process) |
| `started_at` | last successful start timestamp |
| `stopped_at` | last stop timestamp |
| `error` | most recent error string, if any |
| `host` / `port` | runtime-discovered values |

No `service_config`. No `service_meta_id` (derivable from file).
No `installed_at` (no concept of "installed but not running" — the
file's presence in the active set IS the installation).

DB schema migration: add `service_proxy.service_config` to a deprecated
field list, write a one-shot migrator that walks current rows, writes
`<proxy_id>.yml` per row using `service_meta_id` for `type:` and
`service_config` for the body, then strips those fields from the row.


## Locked decisions

1. **One file per proxy instance**, named `<proxy_id>.yml`. Defaults
   seeded from the type on first install.
2. **DB demoted to ephemera.** No config in TinyDB.
3. **UI service owns canvas.** Node positions, edges, viewport, view
   choices live in `ui-1.yml` — same shape as every other service
   config, round-trips through the same loader. The `ui` service-type
   stops being a passive node and becomes a real participant.
4. **`security` singleton.** Always starts, right after `runtime`.
   Round-trips `Encrypt--`/`Encrypted--` via load/save hooks. Config
   classes stay innocent.
5. **Explicit reload only.** No filesystem watcher. UI mediates writes;
   manual edits picked up on next `reload_config` or restart.
6. **`runtime.yml` carries only `start_order`.** Type info lives in
   each `<proxy_id>.yml`. Renaming a candidate to a slot name IS the
   bind operation.
7. **Candidates are pure-presence.** No `candidates:` list, no
   `.parked.yml` suffix. Any `.yml` not in start_order is a candidate.
8. **No hot-swap.** Switching sets = restart. Renaming candidates
   takes effect on next boot.
9. **Capability check at boot.** A proxy's bound type must satisfy
   declarer's `requires[]`. Field `controller_type` (and any like it)
   goes away — name + capability is the contract.


## Non-goals

- Filesystem-watch live reload of yml edits.
- Hot-swap of running services on set switch.
- DB-as-config-fallback when the file is missing.
- Plain-text secrets (`Encrypt--` is the only way to land a secret in a
  file).
- Per-service custom persistence backends (everyone uses the loader).
- KMS / Vault integration in v1 (key file is enough; ship as a future
  security service variant).
- Backwards-compatibility shim for the old `service_config` JSON column
  (one-shot migrator, then it's gone).


## Implementation order (first stones)

Land in this order; each stone is independently usable and testable.

### 1. `security` singleton + `Encrypt--`/`Encrypted--` round-trip

- `repo/security/1.0.0/` with `SecurityService`
- `encrypt(plaintext)` / `decrypt(ciphertext)` bus actions
- Key file at `data/security/key.bin`, created with 0o600 on first start
- Env-var override `ROBOTLAB_X_SECURITY_KEY` for ops automation
- Standalone tests: round-trip + bad-input + missing-key cases
- Not wired into anything yet — proves out the singleton + crypto in
  isolation

### 2. Config-set loader + Pydantic interlock

- `runtime/config_sets.py`: read active set, parse `runtime.yml`,
  walk start_order, read each `<proxy_id>.yml`, decrypt via security,
  validate against `config_class`
- Returns a list of (proxy_id, type_id, validated_config_obj) ready for
  the lifecycle to spawn
- Capability check inline: requires/implements interlock at the
  yielding step
- Tests: happy path, missing file, bad yml, missing type, missing
  capability, encryption round-trip

### 3. Service base auto-mounts

- `framework/service.py` Service base gains `apply_config(diff)` hook
  and `reload_config()` method
- `@service_method` decorator-level support to auto-register
  `get_config` / `set_config` / `save_config` on any subclass with a
  `config_class`
- `get_config` masks any field declared as `SecretStr` (returns
  `"***"` for those)
- `set_config(patch)` validates → writes file via loader → calls
  `apply_config(diff)`
- Tests against a minimal `EchoService` subclass

### 4. Migrate the existing lifecycle

- `runtime/lifecycle.py` boots from the loader instead of from
  TinyDB rows
- TinyDB write paths for `service_config` / `service_meta_id` removed
- `service_proxy` row writes restricted to ephemera fields only
- One-shot migrator: on first boot under the new system, detect old
  rows, write `<proxy_id>.yml` per row, strip the old fields

### 5. Migrate Brain as the test case

- Brain's runtime backend mutations (`set_backend`, etc.) become
  `set_config` calls instead of custom action plumbing
- `BrainConfig` gets `SecretStr` on the three api_key fields
- Brain UI panel uses the framework-mounted `get_config` / `set_config`
  instead of the bespoke `get_backends` / `set_backend`
- The original bug ("ollama settings not persisted across restart") is
  verified fixed
- The bespoke `get_backends` / `set_backend` / `clear_backend` actions
  can stay as **thin wrappers** over `set_config` if the UX benefits;
  or be removed entirely if `set_config` is enough

### 6. Migrate `ui` service to own canvas state

- Canvas mutations from the browser → `ui-1.set_config(patch)` (or
  bespoke `move_node` etc. that themselves call `set_config`)
- Debounce on the UI side (~500ms idle) before flushing
- Explicit "save set" button forces an immediate flush
- "Save as new set" button = `cp -r` active folder + switch active

### 7. UI surfacing of candidates + set switching

- Config-sets dropdown in the UI header
- "Switch set" prompts a restart confirmation
- Per-service "swap" menu lists yml candidates in the active set whose
  type satisfies the same capability as the current binding
- "Save as" + "Duplicate set" + "Delete set" file ops


## Open questions to resolve before code

1. **`runtime.yml` minimum scope.** Locked: just `start_order`.
   `runtime-1.yml` carries everything else the runtime singleton needs
   (runtime_id, log level, port, federation peers).
2. **Secrets API**: `SecretStr` from Pydantic, or a custom
   `secret=True` field metadata marker? Pydantic's SecretStr is more
   idiomatic; let's default to it and revisit only if it bites.
3. **Pluggable LLM backends as separate services?** Open. The pattern
   is described in the design discussion — `ollama-1.yml`,
   `anthropic-1.yml`, etc. as service-type instances implementing
   `llm_backend`, with brain `requires: [llm_backend]` and binding by
   proxy_id. Bigger refactor than this spec; flagging because the
   symmetry is striking. **Decision: defer.** Land config sets first;
   revisit if/when a second consumer of `llm_backend` shows up.
4. **Migrator timing.** Auto-run on first boot under the new system,
   or require an explicit `robotlab_x migrate` command? Auto is
   friendlier; explicit is safer. Lean: auto, with a one-line stdout
   notice listing every file written.


## Side benefits

- The original brain persistence bug disappears as a side effect.
- Demos are shippable as tarballs (`tar czf cannamatic-demo.tgz
  config_sets/demo/`).
- "Reset to factory" is `rm -rf config_sets/active/ && cp -r
  config_sets/default-shipped/ config_sets/default/`.
- Operators can `git init` a `config_sets/` and version their
  configurations.
- The wizard becomes a yml generator, not a DB row inserter.
- Federation has a clearer story: peers can share a config set via
  any file-sync mechanism (rsync, git, NFS).


## What this doesn't change

- Service framework (`Service` base, `@service_method`, capability
  declarations).
- Bus semantics (topics, retained, federation, subscribers).
- Workflow / brain workflow loading (independent file-based system,
  unaffected).
- Registry (still resolves `type@version` strings to package manifests).
- Lifecycle adapters (in-process / subprocess / docker — these spawn
  services; config sets just feed them validated configs).
