# robotlab_x Brain Service — Requirements

A new robotlab_x service that runs **folder-defined, AI-agnostic
workflows** against the rest of the runtime. The model proposes; the
brain validates + executes via existing bus actions; folders define
behaviour; logs preserve memory + auditability.

This document refines the requirements draft so they line up with how
robotlab_x actually works. Items that differ meaningfully from the
original draft are flagged with **▶ delta**.


## Core principle

```
AI proposes.
Brain validates.
RobotLab-X services execute (via the bus).
Folders define behaviour.
The bus + run logs preserve memory and auditability.
```


## Where it fits in robotlab_x ▶ delta

The original draft described the brain as a standalone FastAPI service
with its own tool registry, HTTP endpoints to external tools, and an
opinionated folder layout under `brain_workspace/`. That's how a generic
AI workflow engine would be built — but robotlab_x already solves most
of those problems, so we should reuse them:

| Original draft | Refined for robotlab_x |
|---|---|
| Standalone FastAPI service | A robotlab_x service (`brain@1.0.0`), **in-process** (runs inside the rlx backend, no subprocess) |
| Custom `tool_registry.yaml` listing HTTP/ROS/MQTT endpoints | **Tools are existing robotlab_x services** — discovered automatically via `/runtime/runtime/types/+` |
| Tool execution = HTTP calls | Tool execution = **bus method call** (`publish /<type>/<id>/control {action, reply_to}`) |
| `brain_workspace/` at an env-var path | Bundled defaults at `repo/brain/<ver>/workflows/`; per-instance overrides at `<data_dir>/brain/<proxy-id>/workflows/` |
| Run logs to filesystem | Run logs on the bus (`/brain/{id}/runs/{run_id}/...`, retained) AND mirrored to disk |
| Tool list in YAML, kept in sync by hand | Tool descriptors auto-derived from each service's `@service_method` decorators; brain just reads from the catalog |
| Vendor SDKs (openai/anthropic/ollama) | **httpx-only** — adapters hit each provider's REST API directly (httpx is already an rlx dep). Keeps the core bundle slim + avoids vendor SDK churn |

Net effect: about half the components in the original draft (tool
registry, tool executor, HTTP routes, separate process_manager) don't
need to be built. The robotlab_x runtime already has them.


## Service name + identity

```
type:        brain
version:     1.0.0
language:    builtin       (in-process — runs inside the rlx backend)
install:     {kind: builtin}
bundled:     true          (ships with rlx; no extra install needed)
implements:  []
requires:    []            (tools are discovered, not declared)

entry:
  in_process:
    module: brain
    class:  BrainService
```

Multiple instances per runtime are supported by default — `brain-1`,
`brain-2`, etc. — so concurrent agents are a natural extension, not a
v2 feature. Each instance has its own workspace under
`<data_dir>/brain/<proxy-id>/`.

**Why in-process for v1**: simpler, no per-instance venv, no startup
cost beyond the rlx backend itself. AI adapters call provider HTTP
APIs via httpx (already an rlx dep) — no vendor SDK needed. If the
in-process design ever pinches (e.g. a hung adapter blocks rlx work),
the brain can be promoted to subprocess later without changing its
external contract (same bus topics, same actions).


## On-disk layout

### What ships in the bundle

In-process services in robotlab_x live as a Python package directly
inside `repo/<type>/<version>/`. The framework imports
`<module>.<class>` from there at startup (see `framework/adapters/
in_process.py`).

```
apps/robotlab_x/repo/brain/1.0.0/
  package.yml
  brain/                       # the importable Python package
    __init__.py                # exports BrainService
    service.py                 # BrainService(Service) — bus wiring, lifecycle
    workflow_engine.py
    safety_gate.py
    run_logger.py
    schemas.py
    context_loader.py
    tool_discovery.py
    tool_executor.py
    memory.py
    adapters/
      base.py                  # ModelAdapter ABC
      mock.py                  # MockAdapter (deterministic, for tests + offline)
      ollama.py                # httpx → OLLAMA_BASE_URL/api/chat
      openai.py                # httpx → api.openai.com/v1/chat/completions
  workflows/                   # bundled default workflows
    observe_room/
      workflow.yaml
      prompt.md
      allowed_tools.yaml
      success.md
      failure.md
    inspect_object/...
    emergency_stop/...
  icon.svg
  README.md
```

No `pyproject.toml` — in-process services don't have their own venv;
they import directly into the rlx process. The only dep beyond what
rlx already has is **httpx** (already present), which the adapters
use for provider REST calls.

### Per-instance state (under data_dir)

```
<data_dir>/brain/<proxy-id>/
  workflows/                # operator-added or modified workflows
  memory/
    observations.md
    known_objects.md
    task_history.md
  runs/
    2026-05-31T12-00-00-observe_room-a3f1/
      input.json
      context.md
      steps.jsonl
      tool_calls.jsonl
      result.md
      errors.log
```

**Bundled workflows + per-instance workflows merge at load time.**
Per-instance wins on name conflict so operators can override.


## Modules

```
src/brain_service/
  service.py            # the SubprocessService — wires bus subscriptions
                        # to workflow engine + exposes @service_method actions

  workflow_engine.py    # WorkflowRun state machine; step loop
  schemas.py            # Pydantic: Workflow, Step, ToolCall, RunRecord, etc.

  context_loader.py     # loads workflow.yaml + prompt.md + memory.md
                        # for a given run

  tool_discovery.py     # subscribes /runtime/runtime/types/+ and keeps
                        # a live catalog of available tools (= service
                        # @service_method actions + their JSON schemas)

  safety_gate.py        # validates a proposed tool call against the
                        # workflow's allowed_tools / blocked_tools /
                        # max_steps / requires_human_approval

  tool_executor.py      # publishes to /<type>/<id>/control with reply_to,
                        # awaits the response, normalises into a ToolResult

  run_logger.py         # writes step/tool_call/result files AND publishes
                        # to /brain/{id}/runs/{run_id}/... (retained)

  memory.py             # append-only markdown + structured rows;
                        # exposed as the "memory.*" pseudo-tool

  adapters/
    base.py             # ModelAdapter ABC — .complete(messages, tools)
    mock.py             # records prompts, returns scripted responses
    ollama.py
    openai.py
    anthropic.py        # stub for now
```


## Bus interface (instead of HTTP) ▶ delta

The original draft had REST endpoints (`POST /workflows/{name}/start`,
`GET /runs/{run_id}` etc.). In robotlab_x, services expose their API
via `@service_method` actions on the bus — the UI and other services
hit the same surface uniformly, and the bus already handles
request/reply, retained state, federation across peers.

### Topics

```
/brain/{id}/state             retained — {current_run_id, available_workflows, …}
/brain/{id}/heartbeat         1Hz
/brain/{id}/control           inbound: {action: "<verb>", …}
/brain/{id}/runs/{run_id}                  retained — top-level run summary
/brain/{id}/runs/{run_id}/steps            stream — appended per step
/brain/{id}/runs/{run_id}/tool_calls       stream — appended per tool call
/brain/{id}/runs/{run_id}/result           retained — terminal result
```

### @service_method actions on `/control`

```
list_workflows()                       → [{name, description, requires_human_approval, …}]
list_tools()                           → [{topic, action, schema, capability, …}]
start_workflow(name, inputs={})        → {run_id}
step(run_id)                           → {status: running|success|failure}
cancel(run_id, reason="")              → {cancelled: bool}
approve(run_id, decision=true)         → {approved: bool}   # for paused-pending-approval runs
get_run(run_id)                        → run summary
write_memory(kind, content)            → {written: true}
```

UI clients use the existing rlx_bus client (`call brain-1 start_workflow
observe_room`); CLI users use the existing `call` verb. No new
auth/transport surface.


## Tools = existing services ▶ delta

The original draft kept a hand-maintained `tool_registry.yaml`. The
brain's tool catalog should instead be **derived live from the runtime's
type index**. Every robotlab_x service already publishes its method
descriptors at `/runtime/runtime/types/<type>` (with JSON Schema for
each method's args + return). The brain subscribes once and gets a
self-updating tool catalog.

For workflow authoring, `allowed_tools.yaml` references services by
their bus address pattern + action name. **Topic-pattern is the only
allow/deny mechanism** — at the bus level, a publish either matches
a pattern or doesn't, so anchoring the safety gate to that is the
single source of truth. Capability-based / role-based / type-based
allow lists were considered and dropped: they'd be a second way to
say the same thing and would drift from the actual enforcement
point.

```yaml
# repo/brain/1.0.0/workflows/observe_room/allowed_tools.yaml
allowed:
  - topic: /video/*/control          # any video service instance
    actions: [capture_frame, detect_objects]
  - topic: /speech/*/control
    actions: [speak]
  - topic: /brain/*/control          # the brain's own memory.write_observation
    actions: [write_memory]

blocked:
  - topic: /movement/*/control
  - topic: /arm/*/control
  - topic: /system/*/control
```

### Pattern syntax

* `*` matches one path segment, the conventional "any instance" wildcard:
  `/video/*/control` covers `/video/video-1/control`, `/video/cam-2/control`, etc.
* `**` matches across the federation suffix:
  `/arduino/*@**/control` allows reaching `/arduino/arduino-1@funny-droid/control`.
  Without `@**`, federated topics are NOT allowed — operators have to
  opt in explicitly to drive a peer.
* `actions:` is a flat list; empty list or omitted means "no actions on this
  topic". The safety gate uses fnmatch-style matching against
  `proposed_topic + ":" + proposed_action`.

### Evaluation order

1. If the call matches anything in `blocked`, **reject**. No exceptions.
2. If it matches something in `allowed`, **allow**.
3. Otherwise **reject** (default-deny).

`blocked` wins ties so an operator can broaden `allowed` then trim
specific sub-paths.


## Workflow YAML

```yaml
# workflow.yaml
name: inspect_object
description: |
  Look at one object, identify it, summarise, save observation.
  No movement. No arm. No system actions.

model: ollama            # which adapter to use; can be overridden per-run
max_steps: 8
requires_human_approval: false   # if true, the brain pauses after each
                                 # proposed tool call and waits for an
                                 # approve(run_id) call before executing
timeout_seconds: 120

# Inputs the workflow accepts. Validated against this schema before
# the run starts. Bus-wire types — no model-specific shapes.
inputs:
  target_topic:
    type: string
    description: Object label or coordinate hint, e.g. "the red cube"
    required: true

# Per-step state machine. Steps are evaluated in order; each can
# branch on the model's response or a tool's return value. Most
# workflows have one default step that loops until success/failure.
steps:
  - id: default
    prompt: prompt.md           # rendered via Jinja2 with inputs + memory
    on_success: success.md      # written into result.md, run terminates
    on_failure: failure.md      # ditto

# Pulled into the model's context window at run start. Filenames are
# resolved relative to the workflow's per-instance memory dir first,
# then the bundled defaults, then a hard-coded empty fallback.
context:
  - memory/observations.md
  - memory/known_objects.md
```


## Execution loop

Largely what the draft has, with one rewording — "tool execution" is
literally just a bus publish:

```
for step in range(max_steps):
  context  = context_loader.load(workflow, memory, last_result)
  tools    = safety_gate.allowed_tools(workflow)
  response = adapter.complete(messages=context, tools=tools)
  action   = parse_action(response)        # tool call or "done"

  if action.kind == "done":
    log final, mark success, break

  verdict = safety_gate.check(workflow, action)
  if not verdict.allowed:
    log + reject, mark failure (or continue if workflow says retry), break

  if workflow.requires_human_approval:
    pause, publish approval-pending, await approve(run_id)

  result = tool_executor.call(action.topic, action.payload)   # bus publish
  log step + tool_call

  if result.status == "error" and step+1 == max_steps:
    mark failure
```

The loop is async — the brain doesn't block waiting for the model
or the tool. Other workflows can run concurrently in the same brain
instance.


## Safety gate

Same constraints as the draft, anchored to topic-pattern matching:

```
✓ Topic + action passes the allow/block evaluation above
✓ Steps used < workflow.max_steps
✓ Total wall time < workflow.timeout_seconds
✓ Total model tokens used < workflow.max_tokens_per_run (cost guardrail)
✓ If requires_human_approval: a pending approve(run_id) call exists
✓ The target service exists in the live type index
✓ The proposed args validate against the action's JSON Schema

Every rejection records reason + originating model response.
```

**Emergency stop is a workflow** (`emergency_stop`), invoked the same
way as any other. It's allowed to call any `*.stop` action regardless
of other workflows' running state — it's the only workflow that can
pre-empt others. The safety gate special-cases its run.


## Run logging — bus + disk ▶ delta

The draft has run logs on disk only. We dual-write:

* **Bus**: every step + tool call published to a retained topic so the
  UI can subscribe live (`/brain/{id}/runs/{run_id}/steps`) and a tab
  on the proxy panel shows the workflow timeline as it happens.
* **Disk**: the same content written to
  `<data_dir>/brain/<proxy-id>/runs/<timestamp>-<workflow>-<id>/`.
  Survives runtime restarts, browsable with `cat`/`less`.

`steps.jsonl` is the canonical event log:

```jsonl
{"ts": "...", "step": 0, "model": "ollama", "prompt_summary": "...", "response": {...}, "action": {"topic": "/video/video-1/control", "action": "capture_frame", "args": {...}}, "verdict": "allow", "tool_call_id": "tc-001"}
{"ts": "...", "step": 0, "tool_call_id": "tc-001", "result": {"status": "ok", "value": {...}, "duration_ms": 230}}
{"ts": "...", "step": 1, ...}
```


## Memory

Markdown-backed for v1 (operator-readable, diffable, easy backup).
Three default files:

```
memory/observations.md       # "Saw a red cube on the table at T"
memory/known_objects.md      # ID → last-seen position, descriptor
memory/task_history.md       # workflow runs the operator + brain consider canonical
```

Appended via the brain's own `write_memory(kind, content)` action.
That action is exposed on `/brain/{id}/control` and looks identical to
any other tool call — so a workflow can declare it in `allowed_tools`
just like `video.capture_frame`.

**Future upgrade path**: replace the markdown backend with SQLite +
embeddings for vector search, without touching workflow YAML. The
`write_memory` / `read_memory` action shape stays the same.


## Model adapters

```python
class ModelAdapter(ABC):
    @abstractmethod
    async def complete(
        self,
        messages: list[ChatMessage],
        tools: list[ToolDescriptor] | None = None,
        *,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> ModelResponse:
        ...
```

`ChatMessage` is OpenAI-shaped (`{role, content}`) since every modern
adapter normalises to that. `ToolDescriptor` is the JSON Schema
from the type index; adapters convert into their own tool-calling
format internally (OpenAI function-calling, Anthropic tool_use,
Ollama-with-tools, etc.).

Implementations shipped:

```
MockAdapter      records prompts, returns scripted responses — for tests + offline workflow authoring
OllamaAdapter    httpx → OLLAMA_BASE_URL/api/chat
OpenAIAdapter    openai-python ≥1.0
AnthropicAdapter stub for v2
```

Selection: `workflow.yaml: model: <name>` references an adapter
declared in the brain's config (`adapters: {ollama: {base_url: …}, openai: {api_key_env: OPENAI_API_KEY}}`).


## Federation ▶ added

The brain naturally drives services on peer runtimes via the standard
`@<peer-id>` topic suffix. A workflow targeting `/arduino/arduino-1@funny-droid/control`
sends the call across the federation bridge transparently. The safety
gate's globbing supports `**` for "match across peers" — explicit, not
accidental.

So one brain on the rlx runtime can orchestrate hardware on multiple
robots without any new code. Worth a sample workflow demonstrating
this once the first version is stable.


## Initial bundled workflows

| Name | Purpose | Allowed | Blocked |
|---|---|---|---|
| `observe_room` | Image → object list → save observation + speak summary | `/video/*/control: [capture_frame, detect_objects]`, `/speech/*/control: [speak]`, `/brain/*/control: [write_memory]` | `/movement/*`, `/arm/*` |
| `inspect_object` | Same as above but on one specific object | same | same |
| `emergency_stop` | Stop all unsafe motion, speak confirmation, log | `*.stop`, `/speech/*/control: [speak]`, `/brain/*/control: [write_memory]` | (everything else) |


## Configuration

Pydantic settings (`ServiceConfig` subclass), env-overridable via the
standard `BRAIN_*` prefix that subprocess services use:

```
BRAIN_WORKSPACE_PATH         per-instance data dir (default: <data_dir>/brain/<proxy-id>/)
BRAIN_DEFAULT_MODEL          which adapter to use when workflow doesn't say (default: mock)
BRAIN_MAX_CONCURRENT_RUNS    default 4
BRAIN_OLLAMA_BASE_URL        e.g. http://localhost:11434
BRAIN_OPENAI_API_KEY         optional; required iff openai adapter selected
BRAIN_ANTHROPIC_API_KEY      optional; required iff anthropic adapter selected
LOG_LEVEL                    INFO (inherited from rlx)
```

`.env.example` ships with the brain repo, walking through each value.


## Tests

`tests/test_brain.py` — using the existing FakeDB + tmp_path pattern
from `tests/test_lifecycle.py` and `tests/test_registry.py`:

```
test_loads_bundled_workflows        — walk repo/brain/1.0.0/workflows/, parse each yaml
test_per_instance_overrides_bundled — overlay an operator workflow, assert it wins
test_tool_discovery_reads_catalog   — given a fake type index, brain knows the actions
test_safety_gate_allows             — proposed tool ∈ allowed → verdict=allow
test_safety_gate_blocks_explicit    — proposed tool ∈ blocked → verdict=block, reason set
test_safety_gate_blocks_unknown     — proposed tool not in allow_list → verdict=block
test_safety_gate_max_steps          — step > workflow.max_steps → verdict=block
test_mock_adapter_replay            — adapter returns scripted response → workflow runs
test_blocked_tool_records_rejection — full run, model proposes blocked tool, workflow marks failed
test_run_disk_log                   — run folder + steps.jsonl + tool_calls.jsonl + result.md
test_run_bus_publish                — captures /brain/{id}/runs/{run_id}/... messages
test_memory_append                  — write_memory action lands in observations.md
test_approve_gate                   — workflow with requires_human_approval pauses then proceeds
test_federation_topic               — proposed call to /x/x@peer flows through, gate accepts
```

The full set runs in <1s against the MockAdapter — no live model
needed for CI.


## Non-goals (v1)

- **No autonomous movement.** Movement-touching workflows must be
  invoked manually and must explicitly allow movement actions.
- **No multi-agent orchestration.** A brain instance runs one workflow
  at a time per `start_workflow` call. Multiple instances can coexist;
  cross-instance coordination is v2.
- **No LangChain / AutoGen / CrewAI.** The workflow engine is ~300
  lines of Python; we don't need an agent framework.
- **No hardcoded model vendor.** The mock adapter is the canonical
  v1 target; ollama + openai are bonus.
- **No unrestricted tool execution.** Even with no `allowed_tools`
  declared, the default posture is DENY ALL.


## v1 success criteria

1. `brain@1.0.0` ships as a robotlab_x service: package.yml,
   pip-installable into a per-type venv, runs as a subprocess.
2. `tools/build_services.py` packages it; the registry publishes it;
   a fresh rlx install can `load + install` it.
3. The brain subscribes to `/runtime/runtime/types/+` and exposes the
   current tool catalog via `list_tools()`.
4. The brain loads bundled + per-instance workflows from disk on
   startup.
5. `start_workflow("observe_room")` against the MockAdapter runs
   end-to-end, generates a complete run folder + bus event stream.
6. A workflow proposing a blocked tool is rejected with a clear
   verdict in the run log.
7. Switching adapters is a `workflow.yaml: model: <name>` change —
   no code edits.
8. `write_memory` appends to `observations.md`.
9. All tests pass.
10. The proxy panel in the UI shows the brain's state + active run +
    last-step timeline (read from the bus).


## Decisions locked in for v1

1. **In-process.** No subprocess venv; brain imports directly into
   the rlx backend. Adapters use httpx (already a dep) instead of
   vendor SDKs so the core bundle stays slim. If model-call latency
   ever blocks rlx work, the brain can be promoted to subprocess
   without changing its external contract.
2. **Memory is embedded.** Markdown files under `<data_dir>/brain/
   <proxy-id>/memory/`. The brain exposes `write_memory(kind, content)`
   as a bus action; that's the only writer. If we later need
   SQLite/vector backing, the action shape stays the same and the
   implementation swaps internally.
3. **Topic-pattern is the only allow/deny mechanism.** Dropped the
   capability-based dual-path entirely — at the bus level, a publish
   either matches a pattern or doesn't, so anchoring to that is the
   single source of truth.
4. **Cost guardrails in v1.** `max_tokens_per_run` in workflow.yaml;
   safety gate aborts the run if exceeded.
5. **Adapter secrets in service_config.** Each brain instance can
   point at different provider credentials via `service_proxy.
   service_config.openai_api_key` etc. Env vars (`BRAIN_OPENAI_API_KEY`)
   are the fallback / "set once for every brain on this runtime"
   default. Same pattern as arduino's `controller_id`.

## Still on the wish list (deferred from v1)

- **Streaming model responses.** OpenAI + Anthropic + Ollama all
  support streamed completions. Execution control flow is step-based
  so streaming isn't required, but it'd let the UI show tokens as
  they arrive. Skipped for v1 — adapter returns the full response.
- **Workflow author tooling.** Handwriting YAML is error-prone; a
  JSON-schema-validated form in the UI Composer would be a nice v2
  add. v1 ships example workflows + README patterns.
- **Memory as its own service.** Extract `write_memory` /
  `read_memory` to a `memory@1.0.0` service once a second consumer
  appears or a non-markdown backend is needed.

---

## Implementation phasing

`observe_room` is the canonical test scenario at every phase. It's
small enough to fit on one screen of code review but exercises every
moving part — workflow load, model adapter, tool discovery, safety
gate, tool execution, run logger, memory append. If `observe_room`
passes, the rest of the workflow surface is mechanical.

### v1 — milestone 1 (Mock adapter, end-to-end observe_room)

Everything except the model adapter is real code; the adapter is
deterministic + scripted so the test runs offline in milliseconds.

```
[1] repo/brain/1.0.0/package.yml + brain/__init__.py (skeleton)
[2] schemas.py        — Workflow, Step, ToolCall, RunRecord, Verdict
[3] context_loader.py — load workflow.yaml + prompt.md + memory
[4] safety_gate.py    — topic-pattern allow/deny + max_steps + tokens
[5] adapters/base.py + adapters/mock.py — ModelAdapter ABC + MockAdapter
[6] tool_executor.py  — bus publish + reply_to wait
[7] run_logger.py     — disk + retained bus topic
[8] memory.py         — append to observations.md / known_objects.md
[9] workflow_engine.py — orchestrates 1..N steps via the ABC
[10] service.py       — BrainService(Service) wires bus actions
[11] workflows/observe_room/ — workflow.yaml + prompt.md + allowed_tools.yaml + success.md
[12] tests/test_brain.py — observe_room success path + 7 negative tests
```

#### Test scenario (`tests/test_brain.py::test_observe_room`)

```
Setup
  - tmp_path with brain workspace
  - FakeDB pre-populated with /v1/service-meta-list for video-1 + speech-1
  - MockAdapter scripted:
      step 0: propose capture_frame(camera=0) on /video/video-1/control
      step 1: propose detect_objects(frame_id=…) on /video/video-1/control
      step 2: propose speak("Saw a red cube.") on /speech/speech-1/control
      step 3: propose write_memory("observations", "Saw a red cube.") on /brain/brain-1/control
      step 4: done()

  - tool_executor mocked to return scripted tool results

Assertions
  - Workflow run terminates with status=success
  - 5 steps recorded in steps.jsonl
  - 4 tool_calls.jsonl entries
  - observations.md gained the new line
  - /brain/brain-1/runs/<run_id>/result retained on the bus
```

#### Negative tests in the same file
```
test_blocked_tool_rejected         — model proposes /movement/* → verdict=block, failure
test_unknown_tool_rejected         — model proposes /nonexistent/* → verdict=block, failure
test_max_steps_exceeded            — scripted loop, hits max_steps=2 → failure
test_max_tokens_exceeded           — adapter reports cumulative tokens > max → failure
test_args_schema_validation_fails  — proposed args don't match action's JSON Schema → failure
test_approval_pause                — requires_human_approval=true, pauses + waits + resumes
test_per_instance_overrides_bundled — operator workflow shadows bundled one
```

### v1 — milestone 2 (Ollama adapter)

```
[1] adapters/ollama.py — httpx → POST /api/chat with tools[]
[2] Ollama tool-call response parser (their {"message":{"tool_calls":[...]}} shape)
[3] tests/test_ollama_adapter.py — mocked httpx, runs observe_room
[4] README section — pointing at local Ollama, picking a tool-using model
                     (qwen2.5-coder, llama3.1, granite3-dense, etc.)
```

Success: `BRAIN_DEFAULT_MODEL=ollama OLLAMA_BASE_URL=http://localhost:11434
./robotlab_x` + `start_workflow observe_room` lands successfully against a
real local Ollama serving llama3.1.

### v2 — Anthropic + OpenAI adapters (in that order) ✓ DONE

Anthropic first because their tool_use shape is the closest to our internal
`ToolDescriptor`, so the adapter is the simplest.

```
[1] adapters/anthropic.py — httpx → POST /v1/messages with tools[]      ✓
[2] adapters/openai.py    — httpx → POST /v1/chat/completions with tools[]  ✓
[3] tests for each, mocked httpx                                         ✓
[4] README: per-instance API key via service_config; env-var fallback   ✓
```

Both adapters ship + their observe_room test passes through the
identical engine path as Mock and Ollama. The adapter-parity property
is now testable: every adapter goes through the same workflow and
produces the same terminal `RunRecord`. 36 brain tests cover all four
adapters.

Validation against real providers:

```bash
# Anthropic
export BRAIN_ANTHROPIC_API_KEY=sk-ant-...
# In the brain instance config or per-workflow:
#   model: anthropic
# Then start_workflow observe_room.

# OpenAI
export BRAIN_OPENAI_API_KEY=sk-...
# model: openai
# Then start_workflow observe_room.
```

### Out of scope (every phase above)

- Streaming responses — `complete()` is still request/response only.
- Workflow author UI — handwriting YAML is the only authoring path.
- Memory backends other than markdown.
- Multi-agent coordination across brain instances.


### Net delta from the original draft

- **Half the components dropped** — tool registry, tool executor's
  HTTP machinery, custom auth, separate FastAPI app. The runtime
  already does these.
- **Tools are robotlab_x services**, discovered via the type index.
  No hand-maintained registry.
- **API is bus methods**, not HTTP routes. Same surface as every
  other service.
- **Run logs go on the bus** (retained streams) AND to disk.
- **Federation works for free** via `@peer-id` topic suffix; opt-in
  via the `@**` glob in `allowed_tools`.
- **Topic-pattern is the single source of truth** for allow/deny;
  no capability-based dual path.
- **In-process service** — no per-instance venv; AI adapters use
  httpx instead of vendor SDKs.
- **Memory embedded** (markdown) — extract to its own service later
  if a second consumer or non-markdown backend appears.
- **Approval flow + cost guardrails + cancel** spec'd in v1; the
  original draft had them as "optional later".
- **Tests use the existing FakeDB + tmp_path pattern** so they slot
  into the existing `apps/robotlab_x/tests/` directory.
