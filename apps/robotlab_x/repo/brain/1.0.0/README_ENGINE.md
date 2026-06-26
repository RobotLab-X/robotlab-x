# Brain workflow engine

How `WorkflowEngine` drives an LLM through a workflow — components,
lifecycle, the per-turn loop, termination paths, on-disk + on-bus
artefacts, and the concurrency model.

For the user-facing surface (workflow.yaml fields, named
configurations, run artefacts, CLI/bus recipes) see
[`README.md`](README.md). This file is the implementation companion.


## One paragraph

[`WorkflowEngine`](brain/workflow_engine.py) is a tight async loop
that drives an LLM through a workflow. Each iteration: bounds-check,
build the request, call the chosen adapter, route the response
through a safety gate, dispatch any tool call onto the bus, thread
the tool result back into the conversation, check terminal
conditions, repeat. The engine is provider-agnostic — it only
speaks the brain's internal `ChatMessage` + `ToolDescriptor` types;
adapters do the provider translation in/out. Persistence is heavy +
structured: every input, request, response, tool call, and
lifecycle event ends up in `runs/<run_id>/` on disk and on the bus.


## Moving parts

| Component | File | Role |
|---|---|---|
| **Workflow** | [`brain/schemas.py::Workflow`](brain/schemas.py) | The static contract — prompt, allowed tools, guards, configurations |
| **Engine** | [`brain/workflow_engine.py::WorkflowEngine`](brain/workflow_engine.py) | The loop |
| **Adapter** | [`brain/adapters/{mock,ollama,anthropic,openai}.py`](brain/adapters/) | Translates internal types ↔ provider wire format; one HTTP call per turn |
| **ToolExecutor** | [`brain/tool_executor.py`](brain/tool_executor.py) | Dispatches a tool call onto the target service's `/control` topic + awaits the reply |
| **Safety gate** | [`brain/safety_gate.py`](brain/safety_gate.py) | Per-call `check_tool_call` (topic-pattern allow/deny) + per-loop `check_max_steps` / `check_max_tokens` |
| **RunLogger** | [`brain/run_logger.py`](brain/run_logger.py) | Disk artefacts (`runs/<id>/…`) + bus publishes (`/brain/<id>/runs/<id>/…`) |


## Lifecycle

`m_start_workflow(name, inputs, backend?, model?, configuration?)` in
[`brain/service.py`](brain/service.py) resolves the precedence chain
to a concrete `(backend_name, model_id)`, builds the adapter, builds
the `ToolExecutor`, constructs the engine, and
`asyncio.create_task(_run_to_completion(engine))` — returns
immediately with the `run_id`. The run continues in the background;
`m_cancel(run_id)` interrupts it.

Inside `engine.run()`:

1. **Write input artefacts** — `input.json` (workflow + inputs),
   `context.md` (system prompt + rendered `prompt.md` with input
   substitutions + each file from `workflow.context` concatenated
   below; preceded by a small run-header noting backend, model id,
   workflow name, run id).
2. **Build the initial message array** —
   `[ChatMessage(system, _system_prompt(wf)), ChatMessage(user, context_body)]`.
3. **Filter the tool catalog** — `_allowed_tool_descriptors()` walks
   the brain's live `tool_catalog` (built from the `/+/+/meta`
   wildcard subscription) through the workflow's `allowed_tools.yaml`
   allow/deny rules; result is the list the LLM will see.
4. **Write `tools.json`** in provider-native wire format via
   `adapter.encode_tools_for_log(tools)` — exactly what gets sent on
   the network for the chosen backend (Ollama/OpenAI
   `{type:"function", function:{name, description, parameters}}`;
   Anthropic `{name, description, input_schema}`).
5. **Emit `started`** on `/brain/<proxy_id>/workflow_events`
   (non-retained; engine bookend visible in the UI's Steps tab).
6. **Enter `_loop(messages, tools)`** — the heart (see below).
7. **`finally:`** write the terminal `RunRecord` to `summary.json` +
   emit `ended` workflow_event with status / duration_ms /
   tool_calls_count / failure_reason.


## A single loop iteration

```python
while True:
    # 1. Bounds — checked BEFORE the LLM call so a failure-bound run
    #    terminates without spending tokens.
    if self._cancel_event.is_set(): raise CancelledError
    check_max_steps(workflow, steps_used)   → maybe _terminate_failure
    check_max_tokens(workflow, tokens_used) → maybe _terminate_failure
    if time.monotonic() > deadline:         → _terminate_failure

    # 2. Log the exact request. ``messages`` grows turn-over-turn
    #    (assistant tool calls + tool-result messages threaded back
    #    in); ``tools`` stays constant. ``requests.jsonl`` line
    #    written here, with tools in provider-native wire format.
    self.logger.log_request({step, backend, model, messages, tools})

    # 3. Call the adapter — the only place provider-specific code runs.
    response = await self.adapter.complete(
        messages, tools=tools, model=self._model_id,
    )

    # 4. Parse + safety-gate the model's action.
    action  = response.action                       # ProposedAction (tool|done)
    verdict = check_tool_call(workflow, action, tool_catalog)

    # 5. Persist the step record (steps.jsonl + bus publish).
    self.logger.log_step(StepRecord(
        step, model, response_raw, action, verdict, usage,
    ))

    # 6. Branch on action.kind
    if action.kind == "done":
        # Reject ``done`` if terminate_on actions haven't all been
        # called yet — catches the "model emits done before doing
        # the work" failure mode.
        if required_terminate_on and not satisfied:
            _terminate_failure(f"missing {sorted(missing)}"); return
        _terminate_success(action.rationale); return

    # 7. Approval gate (when workflow.requires_human_approval).
    if requires_human_approval and not await self._wait_for_approval():
        _terminate_failure("operator denied"); return

    # 8. Dispatch the tool call onto the bus. ToolExecutor publishes
    #    to the action's topic with the args + awaits the reply on a
    #    one-shot topic; default timeout 30s per call.
    result = await self.tool_caller(action.topic, action.action, action.args)
    self.logger.log_tool_call(ToolCallRecord(
        step, topic, action, args, result,
    ))

    # 9. Termination via terminate_on — engine-driven success the
    #    moment all required actions have returned ok at least once.
    if result.status == "ok":
        actions_succeeded.add(action.action)
        if required.issubset(actions_succeeded):
            _terminate_success(...); return

    # 9b. loop_on_timeout (E2) — short-circuit re-dispatch loop.
    #     While the just-returned result matches the configured
    #     {tool, field, value}, re-call the same tool WITHOUT an
    #     LLM round-trip and without incrementing steps_used.
    #     Cancel + timeout_seconds still fire from inside. The LLM
    #     only sees the FIRST non-matching result via step 10.
    while loop_on_timeout and action.action == cfg.tool \
          and result.value.get(cfg.field) == cfg.value:
        result = await self.tool_caller(action.topic, action.action, action.args)
        self.logger.log_tool_call(...)  # fresh tool_call_id per re-dispatch

    # 10. Thread the tool result back into the conversation so the
    #     next turn's LLM call sees the full history.
    messages.append(ChatMessage(role="assistant",
                                tool_call_id=..., tool_args=action.args))
    messages.append(ChatMessage(role="tool",
                                tool_call_id=..., content=result.value))

    # 10b. message_window_size (E3) — bound the conversation tail.
    #      Always retain messages[:2] (system + initial user
    #      context_body) so workflow instructions never fall out of
    #      window; trim only the tail to the last N messages. Drops
    #      leading orphan `tool` messages whose assistant was just
    #      trimmed.

    steps_used += 1
    # loop
```

### Long-running interactive workflows (E1/E2/E3)

The triad `exit_on_phrase` + `loop_on_timeout` + `message_window_size`
makes the engine safe for hours-long conversational workflows like
[`conversation_servo`](workflows/conversation_servo/workflow.yaml):

- **E1 (`exit_on_phrase`)** — a watcher task spawned in
  [`run()`](brain/workflow_engine.py) subscribes to the configured
  `listen_topic` (typically `/chat/+/inbox`) and matches every text
  payload against `matches`. On match it sets `_exit_via_phrase=True`
  + `_exit_phrase_matched` then `Task.cancel()`s the run task. The
  `CancelledError` handler in `run()` checks the flag and converts
  the cancel into `status=success`. The watcher is cancelled +
  awaited in the `finally:` so it never outlives the run.
- **E2 (`loop_on_timeout`)** — collapses the "tool returned nothing,
  call it again" pattern. Without this, a 30-second `chat.listen`
  polling cycle would burn one LLM round-trip per idle interval; with
  it, the engine just re-listens until the operator actually speaks.
  `_tool_calls_attempted` / `_tool_calls_succeeded` still count every
  re-dispatch for accurate tool-load metrics.
- **E3 (`message_window_size`)** — without trimming, `messages` would
  grow past the model's context cap after a few hundred turns. With
  it, only the conversation tail is bounded; the workflow's
  `prompt.md` + injected memory stay anchored at the head so
  instructions never decay.

Step records carry the provider's raw reply in `response_raw` (for
post-hoc debugging without re-running), `verdict` (allow/deny +
reason + guard name), and `usage` (input/output token counts when
the provider reports them — `max_tokens_per_run` enforcement reads
this).


## Termination paths

| Outcome | Trigger | `summary.json` |
|---|---|---|
| `success` | `terminate_on` actions all called ok | `status=success`, `result_summary` populated |
| `success` (exit_on_phrase) | watcher matched a phrase on `listen_topic` and cancelled the run task — converted from `CancelledError` to success in `run()` | `status=success`, `result_summary="exit phrase matched: '<phrase>'"` |
| `success` (legacy) | model emits `done` AND `terminate_on` is empty OR already satisfied | `status=success`, rationale as summary |
| `failure` | `done` emitted but `terminate_on` not satisfied | `status=failure`, `failure_reason="missing ['X']"` |
| `failure` | `max_steps` / `max_tokens` / `timeout_seconds` exceeded | `status=failure`, `guard=…` recorded on the final step |
| `failure` | safety gate denied a tool call and the run can't make progress | `status=failure`, `guard=topic_pattern` |
| `failure` | adapter raised an exception | `status=failure`, `engine error: <ExcType>: <msg>` |
| `cancelled` | `m_cancel(run_id)` → `_cancel_event.set()` + `task.cancel()` | `status=cancelled`, reason in `failure_reason` |
| `awaiting_approval` | mid-run park (intermediate, not terminal) | transitions to `running` on approve, `cancelled` on deny |


## What gets captured

### On disk — `runs/<ts>-<workflow>-<run_id>/`

| File | Contents | Written when |
|---|---|---|
| `input.json` | start args (workflow ref + inputs) | once at run start |
| `context.md` | system prompt + rendered prompt.md + injected memory files; preceded by a run-header (backend, model, run_id) | once at run start |
| `tools.json` | provider-native wire tools (constant for the run) | once at run start |
| `requests.jsonl` | per-turn `{step, ts, backend, model, messages, tools}` — the exact request the engine handed to the adapter | one line per `adapter.complete()` call |
| `steps.jsonl` | per-step `StepRecord` (response_raw, action, verdict, usage) | one line per loop iteration |
| `tool_calls.jsonl` | per-tool-call `ToolCallRecord` (args, result, duration_ms) | one line per dispatched tool |
| `result.md` | `success.md` or `failure.md` body + the reason | once at terminal state |
| `summary.json` | terminal `RunRecord` | rewritten throughout; final write at terminal state |
| `errors.log` | unexpected crashes only (engine bugs, not workflow failures) | rarely; one line per crash |

Pair `requests.jsonl` (what we sent) with `steps.jsonl::response_raw`
(what came back) for a complete request/response audit trail per turn.

### On the bus

| Topic | Retained? | Payload |
|---|---|---|
| `/brain/<id>/runs/<run_id>` | yes | `RunRecord` summary |
| `/brain/<id>/runs/<run_id>/steps` | no | `StepRecord` stream |
| `/brain/<id>/runs/<run_id>/tool_calls` | no | `ToolCallRecord` stream |
| `/brain/<id>/runs/<run_id>/result` | yes | `{status, body}` terminal |
| `/brain/<id>/workflow_events` | no | `started` + `ended` engine bookends |


## Concurrency

Each call to `m_start_workflow` creates its own `asyncio.Task` on the
brain service's loop and registers it under `self._runs[run_id]` +
`self._run_tasks[run_id]`. `max_concurrent_runs` (default 4,
[`BrainConfig`](brain/service.py)) caps the pool — additional
start requests raise `max concurrent runs reached`.

Each engine instance owns its own `adapter` reference but the
underlying HTTP clients are shared across engines. `model_id` is
passed per-call to `adapter.complete(model=…)` so concurrent runs
pinned to different models on the same adapter instance don't
trample each other.

`m_cancel(run_id)` both sets the engine's cooperative `_cancel_event`
AND calls `Task.cancel()` so an in-flight `adapter.complete()`
aborts immediately. Without the `Task.cancel()` piece the operator
would wait for the slow inference to return (15–30s on a local
model) before the engine sees the cancel flag at the top of the
next loop iteration. `CancelledError` propagates through the awaits
+ the `finally:` block still publishes the `ended` event and writes
`summary.json` with `status=cancelled`.


## Where each guard lives

| Guard | Fires | Reason format |
|---|---|---|
| `max_steps` | top of every loop iteration via [`check_max_steps`](brain/safety_gate.py) | `workflow.max_steps=N exhausted (used N)` |
| `max_tokens_per_run` | top of every loop iteration via [`check_max_tokens`](brain/safety_gate.py); skipped when null | `workflow.max_tokens_per_run=N exceeded (used N)` |
| `timeout_seconds` | top of every loop iteration (`time.monotonic() > deadline`) | `workflow.timeout_seconds=N exceeded` |
| `topic_pattern` allow/deny | per tool call via `check_tool_call` against `allowed_tools.yaml` | `denied by blocked rule …` / `no allow rule matched …` |
| `terminate_on` mismatch | when model emits `done` before required actions ran | `model emitted done but terminate_on actions were not satisfied: missing [...]` |
| `requires_human_approval` | between each tool call when the workflow declares it | parks the run; not a guard failure on its own |
