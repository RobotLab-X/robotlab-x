# Brain Service View — File Browser + Markdown Viewer/Editor

The brain's workspace is the home of operator-authored content: prompts
that define workflow behavior, success/failure copy, ongoing memory
notes the brain writes back, and the per-run logs the engine produces.
Today the Brain panel surfaces this content indirectly — workflows are
buttons, runs are a step log, memory is invisible. Operators editing
markdown today have to leave the UI, find the file in the workspace
dir on disk, edit in their own tool, save, refresh.

This plan turns the brain service view into the primary workspace for
that authoring: a file-browser tree on the left, a viewer/editor
right pane, render markdown formatted, edit on demand, save in place.


## Goals

- **Editing is local.** The viewer/editor is the place; no shell, no
  external tool, no SCP, no refresh dance.
- **The file is the truth.** This continues the pattern landed in
  TODO_CONFIG_SETS.md — yml/md files on disk are authoritative.
- **Browsing is fast.** Tree expands instantly; large run-log dirs
  paginate or lazy-load.
- **Editing is safe.** Yaml edits validate before save; bundled
  defaults are read-only by default (with explicit fork-to-workspace);
  unsaved changes survive accidental tab close; conflict on disk
  warns before overwrite.
- **The mode-switch is invisible.** Operators don't think in terms of
  view-vs-edit dialogs; the viewer and editor coexist in the same
  pane with a single toggle.


## Sketch

```
┌─ Brain ─ proxy_id=brain-1 ───────── 4 tools · model: ollama · wire(0) ─┐
│                                                                        │
│ ┌─ Files (workspace/brain-1) ──────────┬─ workflows/observe_room/prompt.md
│ │ ▾ workflows/                         │
│ │   ▾ observe_room/    (bundled)       │  # Observe the room
│ │     · workflow.yaml                  │
│ │     · prompt.md      ←  open         │  You are an observer drone…
│ │     · allowed_tools.yaml             │
│ │     · success.md                     │  ## Steps
│ │     · failure.md                     │  1. Use ``/video/*/capture_frame``
│ │   ▸ inspect_object/                  │  2. ...
│ │   ▸ emergency_stop/                  │
│ │   ▸ explore_room/                    │
│ │   …                                  │  [render flows here, formatted]
│ │ ▾ memory/                            │
│ │   · observations.md                  │
│ │   · known_objects.md                 │
│ │   · task_history.md                  │
│ │ ▸ runs/  (24)                        │
│ └──────────────────────────────────────┴─────────────────────────────
│   [+ new file]  [+ new workflow]      │  [Edit]  [Save]  [Discard]
└────────────────────────────────────────────────────────────────────────┘
```

Top status row stays the same as today (proxy_id, tool count, active
model, wire log toggle). The Backends section, Active runs section,
and Step log compress into a collapsed sidebar drawer (button on the
top-right of the file tree) or move into per-run pages reachable via
the `runs/` folder.


## What's in the tree

Two roots, presented as one merged tree with badges showing origin:

1. **Workspace files** at `<data_dir>/brain/<proxy_id>/` — writable.
   This is the per-instance state: memory, run logs, operator overrides.
2. **Bundled type defaults** at `repo/brain/<version>/workflows/` —
   read-only. These are the workflows shipped with the brain type.

The merge rule mirrors `brain.context_loader.list_workflow_dirs()`:
the bundled set provides defaults; a per-instance workflow with the
same name shadows the bundle. The UI distinguishes them with a small
badge — `bundled` / `local` — and forks bundled workflows into the
workspace via a "Fork to workspace" button before allowing edits.

Tree shape per workflow:

```
workflows/observe_room/         (bundled OR local)
  workflow.yaml                  # the manifest
  prompt.md                      # main instructions
  allowed_tools.yaml             # safety gate
  success.md                     # terminal-success body
  failure.md                     # terminal-failure body
  context.md                     # optional extra context
```

Tree shape under memory:

```
memory/
  observations.md                # brain's running notes
  known_objects.md               # entity registry
  task_history.md                # what got done
```

Tree shape under runs (paginated — last 50 by default):

```
runs/
  2026-06-01T12-34-56-observe_room-a8b3/
    input.json
    context.md
    steps.jsonl
    tool_calls.jsonl
    summary.json
    result.md
    errors.log                   # only if present
```


## Backend API surface

All endpoints live under the brain proxy's REST namespace + are
gated on user auth (read endpoints) / admin auth (write endpoints).

### File tree

```
GET /v1/service-proxy/brain-1/files
  ?root=workspace|bundled|all          (default: all)
  ?path=workflows                      (optional subpath)
  ?depth=2                              (default: 2, cap at 6)
  → {
      root_dir: str,
      bundled_dir: str | null,
      entries: [
        { name, path, is_dir, size?, mtime, source: "workspace"|"bundled",
          shadowed?: bool, children?: [...] },
        ...
      ]
    }
```

`shadowed=true` means a bundled entry has a same-named local override
(the local one wins at runtime). `path` is workspace-relative for
workspace files (`workflows/observe_room/prompt.md`) and matches the
key passed to file-read/write.

### File read

```
GET /v1/service-proxy/brain-1/files/content
  ?path=workflows/observe_room/prompt.md
  ?source=workspace|bundled            (required if path exists in both)
  → { path, source, content: str, mtime, encoding: "utf-8",
      writable: bool, mime: "text/markdown" }
```

Returns the raw text. Caller renders markdown client-side. Returns
404 if neither workspace nor bundled has the file. Refuses paths
that escape the root (`..`, absolute paths, symlink traversal).

### File write

```
PUT /v1/service-proxy/brain-1/files/content
  ?path=workflows/my_workflow/prompt.md
  body: { content: str, expected_mtime?: float }
  → { path, source, written: true, mtime }
```

Always writes to **workspace**, never to bundled. If `expected_mtime`
is provided and disk mtime differs, returns 409 conflict so the UI
can offer "your edit OR the disk version" reconciliation.

Atomic write: tmp file + rename. yaml + workflow.yaml-shaped files
get schema validation before commit. Markdown gets a trivial sanity
check (UTF-8 decodable, no NUL bytes) — no semantic validation.

### Fork (bundled → workspace)

```
POST /v1/service-proxy/brain-1/files/fork
  body: { source_path: "workflows/observe_room" }   # always bundled
  → { dest_path: "workflows/observe_room", files: [...] }
```

Copies every file under `<bundled>/workflows/observe_room/` into
`<workspace>/workflows/observe_room/`. Refuses if a local copy
already exists. After fork, edits land in workspace; the bundled
copy is shadowed but stays on disk for "reset to defaults".

### File create + delete + rename

```
POST   /v1/service-proxy/brain-1/files/create
  body: { path, content }
DELETE /v1/service-proxy/brain-1/files/content?path=...
POST   /v1/service-proxy/brain-1/files/rename
  body: { from, to }
```

Workspace-only. Renaming a workflow directory must keep the canonical
filenames intact (workflow.yaml, prompt.md, etc.) — the rename
operation moves the parent dir, leaves the inside alone.


## Frontend stack

UI dependencies to add to `apps/robotlab_x_ui/package.json`:

- **`react-markdown`** — render markdown to React elements. Avoids
  `dangerouslySetInnerHTML`.
- **`remark-gfm`** — GitHub-flavored markdown plugin (tables, task
  lists, strikethrough, autolinks) so workflow prompts can use the
  full markdown vocabulary operators already know.
- **`rehype-highlight`** — syntax highlighting inside fenced code
  blocks. The brain's workflows are full of yaml + json + python
  snippets.
- **`@uiw/react-codemirror`** OR **`monaco-editor`** for the edit
  pane. CodeMirror is lighter (~200KB vs ~3MB), still ships syntax
  highlighting for yaml/markdown/json. **Recommendation: CodeMirror.**
  Monaco's IntelliSense isn't useful here; the bundle weight isn't
  justified.

The Python `markdown-it-py` dep landed in `pyproject.toml` covers
backend-side needs — frontmatter extraction, server-rendered
exports if we want them later. Frontend rendering goes through
react-markdown so the rendered view runs in the browser, no
round-trip per scroll.


## Component layout (Brain.tsx)

```
<BrainFullView>
  <Header />                            ← unchanged (status, wire log toggle)
  <ResizablePanels>                     ← left/right split, draggable handle
    <FileTree                           ← left, ~300px default
      proxyId
      onOpen={(path, source) => …}
      onContextMenu={…}                 ← right-click: fork, rename, delete
    />
    <FileEditor                         ← right, fills rest
      file={openFile}                   ← {path, source, content, mtime, writable}
      mode={mode}                       ← 'view' | 'edit'
      dirty={editorDirty}
      onSave={…}
      onModeChange={…}
    />
  </ResizablePanels>
  <Drawer>                              ← collapsed, summons via icon button
    <BackendsSection />
    <ActiveRunsSection />
    <StepLog />
  </Drawer>
</BrainFullView>
```

The Workflows section as it exists today (cards with Start buttons)
collapses into the drawer too — or appears at the top of the file
tree as a quick-action strip ("Start observe_room ▶"). Both shippable;
quick-action strip is friendlier for the operator who wants to run
something fast without opening a workflow file.

Sub-components broken out into `src/serviceViews/brain/`:

```
src/serviceViews/Brain.tsx              ← orchestrator
src/serviceViews/brain/
  FileTree.tsx                          ← expandable tree, double-click opens
  FileEditor.tsx                        ← view + edit modes, save coordination
  MarkdownView.tsx                      ← react-markdown wrapper
  CodeEditor.tsx                        ← CodeMirror wrapper, language-aware
  ForkDialog.tsx                        ← confirm fork before edit on bundled
  ConflictDialog.tsx                    ← mtime mismatch → keep mine / take theirs
  brainApi.ts                           ← typed fetch wrappers for /files endpoints
```


## Edit / save safety

- **Read-only bundled**: opening a bundled file shows a banner
  "Bundled workflow — read-only. Fork to edit." Edit button is
  disabled; a Fork button replaces it. After fork, the tree reloads
  with the new local entry; the editor opens on the local copy.
- **Yaml validation pre-save**: workflow.yaml + allowed_tools.yaml
  parse server-side before commit. Validation errors surface inline
  in the editor; save is blocked until fixed.
- **Markdown validation**: UTF-8 decodable, no NUL bytes. That's it.
  No structural rules — markdown is intentionally forgiving.
- **Atomic writes**: tmp file in same dir + rename (proven pattern
  from `save_proxy_yml` in `config_sets.py`).
- **mtime conflict detection**: each fetch returns `mtime`; the save
  PUT carries `expected_mtime`. Server compares before write; mismatch
  → 409 → conflict dialog gives the operator the choice.
- **Unsaved changes warning**: leaving an edit with dirty state pops
  a ConfirmDialog (not `window.confirm`, per
  feedback_no_native_dialogs).
- **Path validation**: server rejects paths with `..`, leading `/`,
  null bytes, or symlink traversal. Tree only ever surfaces paths
  rooted under workspace or bundled.


## Live updates

Files can change underneath the operator three ways:

1. The brain itself writes to `memory/*.md` during workflow runs.
2. Another operator on another tab edits the same file.
3. The run logger appends to `runs/.../steps.jsonl` continuously.

For (1) and (3) the brain already publishes events on the bus
(`/brain/{id}/runs/{run_id}/steps`). The UI can subscribe and refresh
the tree + auto-tail the open file if it's a known append-only one.
For (2) we rely on the mtime-conflict mechanism — no live conflict
broadcast needed in v1.

A simple optimization: when the brain writes to memory/, it publishes
a `/brain/{id}/files/changed` event with the relative path. The UI
debounces (500ms) and re-fetches the tree + the open file if it
matches. No filesystem watcher needed server-side; the brain already
controls every write path.


## Phases (stones)

### Stone A — read-only browser (smallest valuable cut)

- Backend `GET /files` tree + `GET /files/content` read endpoints
- Frontend `FileTree.tsx` + `MarkdownView.tsx`
- Brain.tsx restructured: top status bar, two-pane layout, drawer
  collapses existing Backends/Runs/StepLog
- Bundled + workspace merge view
- Double-click to open in markdown view
- No editing yet — Edit button shows "Coming next stone"
- **Ship value**: operators can READ every workflow + memory file
  formatted, without leaving the UI

### Stone B — code-aware viewer

- Plain text + yaml + json non-markdown files render via CodeMirror
  in read-only mode (syntax highlighting, line numbers)
- File-type detection via extension; fall back to text/plain
- Per-file `mime` field from the read endpoint drives the renderer
- **Ship value**: operators can read workflow.yaml + steps.jsonl
  + allowed_tools.yaml properly highlighted

### Stone C — workspace editing

- Edit mode toggle in `FileEditor.tsx`
- CodeMirror in editable mode for yaml/json/text
- Markdown source-edit mode (toggle between rendered/source)
- Save endpoint `PUT /files/content` with mtime check
- Dirty state + unsaved-changes ConfirmDialog
- Pre-save yaml validation (workflow.yaml schema)
- **Ship value**: operators edit local memory + their forked
  workflows in-app

### Stone D — fork from bundled

- "Fork to workspace" button on read-only bundled files
- `POST /files/fork` backend
- ForkDialog confirms the destination + lists files copied
- Tree refresh post-fork; editor reopens on the local copy
- **Ship value**: full edit loop on every workflow, including
  customizing the bundled defaults

### Stone E — create / rename / delete

- "+ New file" / "+ New workflow" buttons under the file tree
- Right-click context menu on workspace files: rename, delete
- Workflow scaffolding: "+ New workflow" prompts for name, creates
  the 5 canonical files from templates
- **Ship value**: operators can author workflows from scratch entirely
  in-app

### Stone F — live updates

- Bus subscription to `/brain/{id}/files/changed`
- Auto-refresh tree + open file on relevant events
- Tail mode for `steps.jsonl` (append-and-scroll)
- mtime-conflict resolution dialog
- **Ship value**: operators see runs evolve live in the editor; no
  manual refresh

Stones A–C are the core experience; D–F are quality.


## Open questions

1. **Editor library: CodeMirror vs Monaco.** Locked recommendation
   above (CodeMirror) for bundle weight. Reconsider if we need
   diff view, lsp integration, or multi-cursor — none of which seem
   likely for prompt/yaml authoring.

2. **Layout persistence.** Should the file tree's expansion state
   + which file is open + the view/edit toggle position survive a
   restart? Probably yes — store in `ui-1.yml` (the canvas-state
   service from stone 6). Defer to a stone after F.

3. **Cross-workflow refactor.** When an operator renames a workflow,
   does that update references elsewhere (e.g., favorites bar)?
   Workflow names are referenced by string in `start_workflow(name=)`
   calls, not by file path — but if a workflow has been started
   recently and the operator renames its directory, the run history
   in `runs/` keeps the old name. Probably fine; flag if it bites.

4. **Multi-tab editing.** Should the editor support multiple open
   files (tabs)? Aligns with editor UX but doubles the state model.
   Probably yes in stone E or beyond; ship single-file in A–D.

5. **Search.** Cross-workspace text search would be lovely for
   "where did I write that thing about cups?" Out of scope for
   v1; ripgrep behind an endpoint is the obvious primitive when
   it's wanted.


## What this changes elsewhere

- `pyproject.toml`: `markdown-it-py` already added (this PR).
- `apps/robotlab_x_ui/package.json`: add `react-markdown`,
  `remark-gfm`, `rehype-highlight`, `@uiw/react-codemirror` +
  CodeMirror language packs (yaml, markdown, json, python).
- The brain service gains REST routes via a new
  `src/robotlab_x/api/brain_files_api.py`. Not via `@service_method`
  on the bus — file content can be large; HTTP is the right
  transport.
- Existing Brain.tsx sections (Backends, Active runs, Step log, Wire
  log) move into a drawer or get consolidated. The Workflows section
  may stay as a quick-action strip or fold entirely into the tree
  view of `workflows/`.


## Non-goals

- An IDE. No syntax-aware refactoring, no project-wide find/replace,
  no test-running, no debugger. CodeMirror's defaults are the ceiling.
- Multi-user real-time collaboration. Two operators editing the same
  file get the mtime-conflict dialog and resolve manually.
- Versioning. No git integration in v1; operators who want history
  can `git init` the workspace directory themselves. Reset-to-bundled
  is the only undo we ship.
- Backend-rendered markdown HTML. Rendering happens in the browser.
