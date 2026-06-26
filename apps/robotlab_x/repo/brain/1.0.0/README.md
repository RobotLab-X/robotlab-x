# brain — workflow brain service

In-process robotlab_x service that runs folder-defined workflows against
pluggable model adapters (Ollama / Anthropic / OpenAI / mock). Each
workflow is a directory; the engine loops an LLM + the live bus tool
catalog until the workflow reaches a terminal state.

Companion docs:
- [`README_ENGINE.md`](README_ENGINE.md) — `WorkflowEngine` internals
  (the step loop, message threading, concurrency). Read this when
  working on the engine itself.
- [`TESTING_RESULTS.md`](TESTING_RESULTS.md) — per-model validation matrix.
- [`TODO.md`](TODO.md) — open ideation items.

```
type:      brain
version:   1.0.0
language:  builtin (in-process — no install needed)
bundled:   true
```


## Bus actions

All are `@service_method`s on `/brain/<id>/control`, callable from any
bus client (`rlx call /brain/<id>/control <action> ...`).

**Runs**
```
list_workflows()                                     → workflow cards
list_tools()                                         → live tool catalog
start_workflow(name, inputs={}, backend=None,
               model=None, configuration=None)       → {run_id}
cancel(run_id, reason="")                            → {cancelled: bool}
approve(run_id, decision=True)                       → {approved: bool}
get_run(run_id)                                      → RunRecord
write_memory(kind, content)                          → {written: true}
```

**Run configurations** (per-workflow saved `(backend, model)` combos)
```
list_run_configurations(workflow=None)
save_run_configuration(workflow, name, backend, model=None, description="")
set_default_configuration(workflow, name)   # promote to preferred_*
delete_run_configuration(workflow, name)
save_workflow_preferences(...)              # write preferred_backend/model etc.
```

**Backends** (runtime adapter credentials / model lists)
```
get_backends()                  set_backend(name, ...)
set_active_backend(name)        clear_backend(name)
list_backend_models(backend)    test_backend(name)
```


## Workflow layout

Bundled (read-only "example") workflows live in `workflows/` next to
this README. Per-instance workflows live under the runtime data dir and
**shadow** a bundled one of the same name:

```
<data_dir>/brain/<proxy-id>/
  workflows/   per-instance — operator-owned, shadows bundled on name clash
  memory/      markdown memory files
  runs/        one folder per workflow run
```

Each workflow is a folder. **The directory name is the workflow's
identity** — it is the single source of truth, used for run dirs, log
filenames, and the Run button's lookup. Any `name:` in `workflow.yaml`
is ignored (storing it in two places desyncs on duplicate/rename).

```
workflows/observe_room/
  workflow.yaml       see "workflow.yaml fields" below
  prompt.md           user-visible task description
  allowed_tools.yaml  topic-pattern allow/deny rules
  success.md          written to result.md on success
  failure.md          written to result.md on failure
```


## workflow.yaml fields

Every key the engine reads + what it does. **None are
documentation-only** — each is enforced at run time by the context
loader, the engine's pre-call guards, or the safety gate. Keep this
table in sync whenever [`brain/schemas.py::Workflow`](brain/schemas.py),
[`context_loader.py`](brain/context_loader.py), or the engine's guards
change.

| Field | Type | Default | Effect |
|---|---|---|---|
| `description` | str | `""` | UI display (workflow card, `list_workflows`). |
| `preferred_backend` | str | `mock` | Adapter selected at `start_workflow` time. Falls back to `BrainConfig.default_model`. |
| `preferred_model` | str \| null | `null` | Pinned model id passed to `adapter.complete(model=...)` per call. Null → adapter's own default. |
| `configurations` | list of `{name, backend, model?, description?}` | `[]` | Operator-curated alternates to `preferred_*`, surfaced as the toolbar dropdown. See [Named run configurations](#named-run-configurations). |
| `max_steps` | int | `8` | Loop guard ([`check_max_steps`](brain/safety_gate.py)) → **failure** when exhausted. |
| `timeout_seconds` | int | `120` | Wall-clock loop guard → **failure** when exceeded. |
| `max_tokens_per_run` | int \| null | `null` | Loop guard ([`check_max_tokens`](brain/safety_gate.py), skipped when null), sums `input+output` tokens from each `ModelResponse.usage` → **failure**. No-op for adapters that don't report usage. |
| `requires_human_approval` | bool | `false` | Parks the run as `awaiting_approval` before every tool call until `approve`/`cancel` arrives. |
| `terminate_on` | list of `{action: str}` | `[]` | Engine terminates **success** the moment every listed action has succeeded. Also rejects a premature model `done`. |
| `exit_on_phrase` | `{matches: [str], case_insensitive, whole_message, listen_topic}` \| null | `null` | Watcher on `listen_topic`; on phrase match it cancels the run and the engine converts that to **success**. Exit latency is bus-RTT, not inference. Built for long-running interactive workflows (`conversation_servo`). |
| `loop_on_timeout` | `{tool, field, value}` \| null | `null` | When the named tool returns `result.value[field] == value`, the engine silently re-dispatches the same call (no LLM round-trip, no `steps_used`). Canonical case: `chat.listen` returning `{timeout: true}` — re-listen instead of burning a turn. Cancel + `timeout_seconds` still fire from inside. |
| `message_window_size` | int \| null | `null` | Trims the conversation tail to the last N messages after each tool result; always keeps the system prompt + initial context. Null → unbounded (long runs eventually hit the model's context cap). |
| `inputs` | object | `{}` | UI form generation + validated in `start_workflow`. |
| `steps` | list of step objects | one default | Engine reads `steps[0].{prompt,on_success,on_failure}` paths. Multi-step graphs reserved. |
| `context` | list of paths | `[]` | Files read + injected into the user prompt at run start. |
| `model` *(deprecated)* | str | — | Accepted as an alias for `preferred_backend`; drop it at convenience. |

Sibling file **`allowed_tools.yaml`** (`allowed:` / `blocked:` lists of
`{topic, actions}` rules) is consumed by the safety gate before every
tool call: default-deny, `blocked` wins ties, `*` matches one path
segment, `@**` opts into federation.


## How a workflow ends

The engine ([`workflow_engine.py`](brain/workflow_engine.py)) walks a
step loop and every run ends in exactly one terminal status —
**success**, **failure**, or **cancelled** — via one of these paths.

**Success**
1. **Model emits `done`** — the LLM returns a terminal `done` action.
   The normal completion. *But* if `terminate_on` is declared, a `done`
   is rejected as failure unless all required actions already
   succeeded (guards against models hallucinating completion).
2. **`terminate_on` satisfied** — engine-driven, no LLM needed. After
   any tool call succeeds, if the required action set ⊆ the actions
   that have succeeded, the run terminates success.
3. **`exit_on_phrase` match** — a watcher matches operator text on
   `listen_topic` and cancels the in-flight run; `run()` converts that
   cancel into success naming the matched phrase. Latency is bus-RTT,
   not inference.

**Failure**
4. **max_steps exceeded** — `check_max_steps`.
5. **max_tokens exceeded** — `check_max_tokens` (`max_tokens_per_run`).
6. **timeout_seconds exceeded** — wall-clock deadline, checked each
   iteration (and inside the `loop_on_timeout` inner loop).
7. **Unsafe tool call** — the safety gate rejects a proposed action.
   (Disallowed tools are also filtered out of what the model is shown,
   so this is a second line of defense.)
8. **Operator denies approval** — under `requires_human_approval`.
9. **Engine error** — any unexpected exception → `engine error: …`.

**Cancelled**
10. **Operator cancel** — `cancel()` raises at the next loop checkpoint.
    (Same mechanism as `exit_on_phrase`, distinguished by a flag so a
    phrase-exit becomes success rather than cancelled.)

**Does *not* end a run:** `loop_on_timeout` re-dispatches the same tool
call without an LLM round-trip or `steps_used` increment; only cancel
or the wall-clock timeout can break out of it.

Transient (non-terminal) statuses: `pending` → `running` →
(`awaiting_approval` ↔ `running`) → terminal. Every terminal transition
writes `result.md`, stamps `ended_at` + duration, and emits an `ended`
event on `/brain/<id>/workflow_events`.


## What gets sent to the LLM

Every turn sends **three** components — not the two operators usually
guess (prompt + memory):

| Component | Source | Sent as |
|---|---|---|
| **System prompt** | [`_system_prompt(workflow)`](brain/workflow_engine.py) — fixed preamble (safety, tool-call format, what `done` means) | `role: system` |
| **User context** | `prompt.md` with `{input}` substitutions + every file in `workflow.context` concatenated below | `role: user` |
| **Tools (filtered)** | live `tool_catalog` (from each peer's retained `/{type}/{id}/meta`) filtered through `allowed_tools.yaml` | provider-native tool array |

`_allowed_tool_descriptors()` keeps only the `(topic, action)` pairs the
workflow grants — a buggy model can't propose a tool it wasn't shown.
Each adapter encodes descriptors into its native format (Ollama/OpenAI
`{type:"function", function:{…}}`; Anthropic `{name, input_schema}`).
The `messages` array **grows** turn over turn (assistant tool calls +
tool results threaded back in); the `tools` array stays constant.


## Named run configurations

`configurations` is a list of operator-curated `(backend, model)` combos
saved in `workflow.yaml`. Each `name` becomes a label in the brain
panel's toolbar dropdown — pick one to switch backend + model without
editing yaml. `preferred_backend` / `preferred_model` remain the
canonical defaults.

```yaml
configurations:
  - name: fast
    backend: ollama
    model: llama3.2:3b
    description: "Smallest validated model — TESTING_RESULTS.md."
  - name: production
    backend: anthropic
    model: claude-opus-4-8
```

**UI:** the dropdown lists each saved entry plus `(preferred)` (no
override) and `(custom)` (appears when backend/model match no entry).
Editing backend/model directly enters `(custom)` and reveals a **save**
button (prompts for a name → `save_run_configuration`; forks a bundled
workflow to the workspace first if needed).

**Precedence** at `start_workflow` time:
```
backend:  call arg  >  configuration  >  preferred_backend  >  BrainConfig.default_model
model:    call arg  >  configuration  >  preferred_model    >  adapter default
```

Configs persist via `ruamel.yaml` round-trip, so comments and key order
in `workflow.yaml` survive saves.


## Model adapters

| name | endpoint | required config | shipped |
|---|---|---|---|
| `mock` | (in-memory) | none | v1 |
| `ollama` | `{OLLAMA_BASE_URL}/api/chat` | `ollama_base_url` (default `http://localhost:11434`) | v1 |
| `anthropic` | `https://api.anthropic.com/v1/messages` | `anthropic_api_key` (env `BRAIN_ANTHROPIC_API_KEY`) | v2 |
| `openai` | `https://api.openai.com/v1/chat/completions` | `openai_api_key` (env `BRAIN_OPENAI_API_KEY`) | v2 |

Select per-workflow via `preferred_backend`, globally via the instance's
`default_model`, or per-call via `start_workflow(name, backend="…")`.
Adapters use **httpx only** — no vendor SDK — so the AI deps don't bloat
the core rlx bundle. Each is a ~120-line file translating between the
brain's internal `ChatMessage` + `ToolDescriptor` and the provider's
native tool-calling format.

### Pointing at a local Ollama

```bash
ollama pull llama3.1        # tool-capable; qwen2.5-coder / granite3-dense also work
ollama serve                # default port 11434
# Point the instance at it: set ollama_base_url + preferred_backend=ollama
#   (wizard: Catalog → brain → instance), or BRAIN_OLLAMA_BASE_URL env var.
rlx call /brain/brain-1/control start_workflow name=observe_room backend=ollama
```


## Run artefacts

Every run produces a folder under `<workspace>/runs/`:

```
2026-05-31T19-23-04-observe_room-a3f1b2c4/
  input.json        inputs + workflow ref
  context.md        rendered prompt at run start (system header + user body)
  tools.json        filtered tool catalog the LLM saw, in provider-native wire format
  requests.jsonl    one record per adapter.complete() — full messages + tools + model id
  steps.jsonl       one StepRecord per line — model response, verdict, action
  tool_calls.jsonl  one ToolCallRecord per line — args, result, duration
  result.md         success.md or failure.md, plus the reason
  summary.json      the terminal RunRecord
  errors.log        unstructured stderr (catastrophic failures only)
```

Pair `requests.jsonl` (what we sent) with `steps.jsonl` (`response_raw`)
for a full per-turn audit. `tools.json` answers "why didn't the model
call X?" — usually "X wasn't in this workflow's filtered catalog."

The same data flows on the bus:

```
/brain/<id>/runs/<run_id>             retained — RunRecord summary
/brain/<id>/runs/<run_id>/steps       stream — StepRecord per step
/brain/<id>/runs/<run_id>/tool_calls  stream — ToolCallRecord per call
/brain/<id>/runs/<run_id>/result      retained — terminal {status, body}
/brain/<id>/workflow_events           stream — lifecycle (started / ended)
```


## Authoring new workflows

Duplicate a bundled example into your workspace, edit, and it appears in
the Catalog UI (the brain re-reads disk on every `list_workflows()`):

```bash
cp -r workflows/observe_room <data_dir>/brain/<proxy-id>/workflows/my_workflow
$EDITOR <data_dir>/brain/<proxy-id>/workflows/my_workflow/workflow.yaml
```

The new workflow is named by its **folder** (`my_workflow`) — no `name:`
field needed. From the UI, use the "Duplicate" action on an example to
do the same with collision-checked naming.
