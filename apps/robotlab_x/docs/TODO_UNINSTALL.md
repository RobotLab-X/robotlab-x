# TODO — Uninstall a service *type* (repeatable install ⇄ uninstall)

Make a pip/subprocess service **type** uninstallable from the UI, and the
full cycle **install → uninstall → install → uninstall** clean and
repeatable. Builds on the install wizard (`docs/TODO_INSTALL_WIZARD.md`).

Status: ✅ M6 implemented.

## Two distinct concepts (don't conflate)

| | Scope | Mechanism |
|---|---|---|
| **Release** an instance | one `service_proxy` row | `release_service` (exists; the trash button) |
| **Uninstall** a *type* | the shared per-type venv | `uninstall_type` (this doc) |

A type's deps live in **one** shared venv at `repo/<name>/<version>/.venv`
(+ `.install-state.json` marker), reused by every instance. Uninstall =
remove that venv + marker, flip `service_meta.installed → false`, and
**keep the source** (`package.yml`, `src/`). Keeping the source is what
makes it repeatable — it's the registry `INSTALLED → LOADED` transition,
not `→ ABSENT`.

Naming: the legacy alias `"uninstall" → release_service` is already taken
for instance release, so the type action is named **`uninstall_type`**.

## State model

```
LOADED (source present, no venv, installed=false)
   │  Play a placeholder → install wizard → install
   ▼
INSTALLED (venv + marker, installed=true)
   │  uninstall_type
   ▼
LOADED   ← next Play reinstalls fresh
```

## The repeatability gap (fixed here)

After a type uninstall, existing instances still reference it. Without a
fix, starting a *stopped* instance would launch a subprocess against a
missing venv. Two coupled fixes:

1. **Uninstall resets the type's non-running instances to `placeholder`.**
   Their canvas blocks revert to grey "needs install"; the next Play
   re-runs the wizard and reinstalls.
2. **`_handle_start` self-heal.** The lazy-install gate is generalized
   from "status == placeholder" to "placeholder **or** the type isn't
   installed". `_ensure_type_installed` is idempotent + short-circuits on
   an existing venv, so a missing venv (uninstalled, hand-deleted,
   corrupted) always self-repairs on Start.

## Preconditions

- **Refuse** if any instance of the type is *active*: `installing /
  starting / running / stopping` → "Stop the N running instance(s) first."
- `placeholder / installed / stopped / error` instances are fine → reset
  to `placeholder`.
- **Builtins** (`dependency_manager == None`) have no venv → no-op; the UI
  hides the action.

## Backend

- `uninstall_type` action in the dispatch table (`runtime/lifecycle.py`),
  carrying `service_meta_id`, so the UI reuses `/v1/service-request` + the
  `/service_request/{id}/progress` channel.
- `_handle_uninstall_type`:
  1. Load `service_meta`; builtin or already-not-installed → no-op success.
  2. Guard active instances → refuse with the list.
  3. `installer.uninstall_type(slot, repo_dir)` — `rm -rf` venv + marker.
  4. `service_meta.installed=false`, `installation_exception=None`; persist
     + publish a `service_meta` change so the catalog badge updates live.
  5. Reset surviving instances → `placeholder`; publish each lifecycle.
  6. Emit `install`/`uninstall` progress on the request channel.
- Serialized against install via the existing `_INSTALL_LOCK`.

## UI

- **REPO palette**: installed badge (from `ServiceMeta.installed`) + an
  **Uninstall** button on installed, non-builtin types.
- **Confirm dialog**: warns deps are removed (re-install re-downloads),
  lists instances that revert to placeholders; blocks with a clear message
  when instances are running.
- POST `uninstall_type`; on success refetch `service-meta-list` (badge) +
  `service-proxy-list` (instances → placeholder). Canvas reflects it
  automatically (reset instances become grey Play placeholders).

## Repeatability — walk-through

1. **install**: Play → wizard → venv + marker, `installed=true`, running.
2. **uninstall**: stop → Uninstall → venv+marker gone, `installed=false`,
   instance → `placeholder`.
3. **install**: Play the placeholder → venv-existence short-circuit sees it
   gone → reinstalls fresh, marker rewritten.
4. **uninstall**: as step 2.

No stale state survives a cycle: venv fully removed, marker gone (no false
"already installed"), short-circuit keys on venv existence. Each install is
from-scratch.

## Edge cases

- Partial/failed venv → `uninstall_type` `rm -rf` (ignore_errors) clears it.
- Permission/IO error → structured failure on the progress channel.
- Concurrent install during uninstall → blocked by the per-type lock.
- Catalog source / federated peers → untouched (venv-only).

## Tests

`tests/test_lifecycle.py`: uninstall removes venv+marker+flag and resets
instances; refuses while an instance is running; full install → uninstall
→ install → uninstall cycle leaves a from-scratch venv each install;
`_handle_start` self-heals a missing venv. (Subprocess install is mocked.)
