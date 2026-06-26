# Brain model + workflow testing results

Living document. Pick a model + workflow combination from the matrix
below; if it's marked ✅, the brain's tool-calling plumbing has been
exercised end-to-end against that pair and known to work.

This is a snapshot — re-run `take_a_note` periodically as ollama
upstream pushes new model versions. Latencies vary with hardware; the
table records what was observed on the test host at the time of run.

Last updated: 2026-06-01 (post-`terminate_on` engine refactor).


## Quick verdict

**With engine-driven termination (`terminate_on` field on
workflows), 6 of 7 tested models now complete `take_a_note`
correctly + every model that passed before is significantly
faster:**

| Model | Before | After `terminate_on` |
|---|---|---|
| claude-opus-4-8 | ✅ 5.5 s | **✅ 4.1 s** (25% faster) |
| llama3.2:3b (2 GB) | ✅ 7.8 s | **✅ 4.6 s** (40% faster) |
| mistral-nemo | ✅ 23.5 s | **✅ 11.5 s** (51% faster) |
| qwen3:8b | ✅ 28 s | **✅ 16.3 s** (42% faster) |
| qwen2.5:7b-instruct | ❌ loop | **✅ 14.7 s** (flipped) |
| gemma4:e4b | ❌ loop | **✅ 27.9 s** (flipped) |
| qwen2.5-coder:7b | ⚠️ fake success | **✅ honest failure** |
| llama3.1:8b | ⚠️ wrong arg | ✅ intermittent — sometimes correct, sometimes still `kind="string"` |

The engine change: when a workflow declares `terminate_on:
[{action: name}]`, the engine terminates as success the moment
those actions are called successfully. No follow-up turn, no
``done`` emission required from the model. See
[TODO.md](TODO.md) for the design rationale and the
[implementation in workflow_engine.py](brain/workflow_engine.py).

Wall-clock improvements come from skipping the second model turn
(the "now emit done" turn). Workflows that previously took N+1
inferences now take N. For local models on modest hardware
that's the difference between a sluggish loop and a snappy tool
call. Three remaining footguns (most affect only SOME models):

1. **Code-specialized models emit calls as text** (qwen2.5-coder).
   These models return the tool call as a JSON string inside
   `content`, not via ollama's structured `tool_calls` array. The
   engine sees no tool call → no `terminate_on` action gets
   satisfied → workflow correctly fails with
   `missing ['write_memory']`. Don't use coder variants for
   tool-calling workflows.
2. **Some models interpret schemas literally** (llama3.1:8b,
   intermittent). Real tool call, but the model sometimes picks
   the schema's type declaration as the argument VALUE — passes
   `kind: "string"` because the schema says `"kind": {"type":
   "string"}`. Adding an `enum` to constrain the field would fix
   this; deferred until the workflow tooling supports it
   ergonomically. `terminate_on` happily accepts the call (the
   action ran successfully, just with wrong args) so this still
   shows up as `status=success` — engine doesn't know what
   "correct" args are.
3. **Boot-time double dispatch.** After a backend restart the brain
   sometimes runs two control loops in parallel, so each tool call
   writes to memory twice. Affects file contents only — model
   output unaffected. Tracked separately.


## Test workflows

| Workflow | Purpose | Hardware required |
|---|---|---|
| `take_a_note` | Minimal LLM smoke test. Brain forms one reflection and calls `write_memory`. Only tool used is the brain's own action. | None |

All other bundled workflows (`observe_room`, `explore_room`,
`patrol_waypoints`, etc.) need vision / movement / speech services
running. They'll surface different model behaviour and aren't
covered here yet.


## Model matrix

All status/latency columns are post-`terminate_on`. Wall-clock is
typically ~half what it was before because the engine no longer
waits for a follow-up "done" turn.

| Model | Tag | Size | `take_a_note` | End-to-end wall-clock | Reflection quality |
|---|---|---|---|---|---|
| **qwen2.5 7B Instruct** | `qwen2.5:7b-instruct-q4_K_M` | 4.7 GB | ✅ **status=success** (was loop-forever pre-`terminate_on`) | ~14.7 s | Generic prose |
| **gemma4 E4B** | `gemma4:e4b` | 9.6 GB | ✅ **status=success** (was loop-forever pre-`terminate_on`) | ~27.9 s | **Domain-engaged** ("behavioral drift", "operational data", "self-correction" — actually reasons about the topic) |
| **qwen2.5-coder 7B** | `qwen2.5-coder:7b` | 4.7 GB | ❌ **honest failure** — engine detects model never made a real tool call ("model emitted done but terminate_on actions were not satisfied: missing ['write_memory']"). Was a fake-success before. | n/a | n/a — no actual reflection saved to disk; model emits tool call as JSON text instead of structured `tool_calls` |
| **qwen3 8B** | `qwen3:8b` | 5.2 GB | ✅ status=success | ~16.3 s (was ~28 s pre-`terminate_on`) | Practical + focused — sensor data, decision-making framing |
| **llama3.1 8B** | `llama3.1:8b` | 4.9 GB | ⚠️ **intermittent** — sometimes correctly emits `kind="reflection"` + succeeds (~8.6 s), sometimes still picks `kind="string"` from the schema's type annotation and lands the file at `memory/string.md`. Was reliably wrong-arg before. | ~8.6 s when it succeeds | Decent content when correct |
| **mistral-nemo** | `mistral-nemo:latest` | 7.1 GB | ✅ status=success | ~11.5 s (was ~23.5 s pre-`terminate_on`) | Practical + focused (self-improvement, pattern identification) |
| **llama3.2 3B** | `llama3.2:3b` | **2.0 GB** | ✅ status=success — **fastest + smallest** local success | **~4.6 s** (was ~7.8 s pre-`terminate_on`) | Functional ("process experiences, identify patterns, inform future actions") |
| **claude opus 4.8** | `claude-opus-4-8` (anthropic) | hosted | ✅ status=success | ~4.1 s (was ~5.5 s pre-`terminate_on`) | **Best of the matrix** — natural prose, no LLM-isms, concrete + accountable framing |

**Not yet tested on `take_a_note`:**
`qwen3-coder:30b` · `glm-4.7-flash` ·
`deepseek-r1` · `gemma4:e2b` · `claude-sonnet-4-6` ·
`claude-haiku-4-5` · any OpenAI.


## Per-model notes

### qwen2.5:7b-instruct-q4_K_M

> **Update post-`terminate_on`:** now **status=success** in
> ~14.7 s. The loop-forever behavior described below still
> happens on the model side — qwen2.5 STILL doesn't emit `done`
> — but the engine terminates on the first successful
> `write_memory` call so the workflow completes cleanly. Original
> failure-mode notes preserved below for historical reference.

**Take-a-note run.** Calls `write_memory` with proper
`{kind: "reflection", content: "<paragraph>"}` on the first turn.
Then the engine feeds the tool result back as `role=tool` and qwen
treats it as "continue the conversation" — emits another tool call
with a slightly-rephrased reflection. Repeats until `max_steps=4`
exhausts.

Reflections are competent but generic:

> *"Journaling can help a robot reflect on its actions and emotions,
> identify patterns, improve decision-making, and provide a historical
> record of its experiences."*

Fast inference — ~3 s per call, ~35 s total workflow run.

**Use this when**: you want the fastest tool-calling sanity check
or you're rate-limited on time. Quality of the actual content is
adequate but not impressive.

### gemma4:e4b

> **Update post-`terminate_on`:** now **status=success** in
> ~27.9 s. Same situation as qwen2.5 — gemma4 still loops on the
> model side but the engine terminates on the first
> `write_memory`. Original failure-mode notes preserved below.

**Take-a-note run.** Same shape: clean tool call with correct args
on every step, no `done` emission, loops until `max_steps`.

Reflections are noticeably more thoughtful — gemma actually
considers what robot journalling could DO rather than just
restating that journals are helpful:

> *"A robot's journal could serve as a mechanism for logging
> unexpected operational encounters and behavioral drifts that are
> difficult to quantify through simple metrics. By recording these
> unique experiences, the robot can facilitate a form of
> self-analysis, helping its core programming understand context,
> efficiency, and novelty."*

Slower — ~15-17 s per inference, ~68 s total. Twice the wall clock
of qwen for the same task.

**Use this when**: you care about the quality of generated content
and can spare the latency. Good for workflows where the brain
needs to actually *reason* about something (planning, summarising,
explaining) rather than just call a tool.

### qwen2.5-coder:7b

> **Update post-`terminate_on`:** now correctly reports
> **status=failed** with message
> `model emitted done but terminate_on actions were not satisfied: missing ['write_memory']`.
> Was a fake-success before. The model's underlying behavior
> (emitting tool calls as JSON text) is unchanged; the engine
> now catches it. Original notes preserved below.

**Take-a-note run** — surfaces a third distinct failure mode
neither of the prior models showed. The engine reported
`status: success` in ~12 s, but the memory file is empty + no
tool was actually invoked.

What happened: qwen2.5-coder:7b doesn't use ollama's structured
tool-calling API at all. It returned the tool call as a literal
JSON string inside the assistant's `content`:

```
{
  "name": "write_memory",
  "arguments": {
    "kind": "reflection",
    "content": "A robot journal is a personal record of a robot's
      thoughts, feelings, and experiences over time..."
  }
}
```

And the response carried `tool_calls: None`. The adapter saw no
tool calls → treated the message as terminal `kind=done` with the
content as rationale. The engine accepted that as a success
without ever invoking write_memory.

Verified the behavior with a direct probe to `/api/chat` — qwen2.5
coder consistently emits tool calls as text. This is a model
behavior, not an adapter or workflow bug: code-specialized models
seem to treat function calls like code blocks they're being asked
to generate rather than invocations they should perform.

**This also exposes a separate engine bug**: when a workflow's
allowed_tools declares any tools, a `done` on step 0 with zero
tool calls actually performed should probably be a failure (or at
least a warning), not a success. The current engine accepts any
`done` as terminal regardless of whether the workflow did the work
it was supposed to do. Tracked in TODO.md as "engine convergence
semantics".

**Use this when**: ...don't. qwen2.5-coder:7b is a poor fit for
tool-calling workflows. Use `qwen2.5:7b-instruct-q4_K_M` (the
non-coder variant) instead — it uses the structured API correctly.
The coder variant is built for code generation, where emitting
function calls as text IS the expected output.

Worth keeping the row in this matrix as a known-bad data point —
new operators reaching for "qwen2.5-coder" because they recognize
qwen2.5 should see the warning.

### mistral-nemo:latest

**Take-a-note run.** Third clean run on `take_a_note` and the most
disciplined `done` emission seen yet. Two steps:

```
step 0: TOOL write_memory  in=398/out=67   args: kind='reflection' (correctly!)
step 1: DONE  "done"  in=205/out=2
RESULT: status=success  (~23.5s)
```

Reflection content:

> *"A robot might want to keep a journal for self-improvement and
> problem-solving. It can record its experiences, analyze them
> over time, identify patterns or areas of improvement, and adapt
> its strategies accordingly."*

Practical + functional. Slightly less "operational" than qwen3:8b
("sensor data, decision-making") but covers the same conceptual
ground.

What stands out: the **`done` step is 2 output tokens long.**
Mistral-nemo emits the literal word "done" and stops. Textbook
behavior. For comparison:

| Model | `done` step output tokens |
|---|---|
| **mistral-nemo** | **2** |
| claude-opus-4-8 | 28 |
| llama3.1:8b | 68 |
| qwen3:8b | 174-367 |

When the prompt says "emit `done`", mistral-nemo emits `done`
period. Other models add summarization, commentary, or even a
fresh inline reflection. This matters for latency — that single
step is faster than the equivalent on any other model + leaves
zero ambiguity for the engine to parse. Pleasant surprise.

**Use this when**: you want local, free, status=success runs AND
you specifically want clean terminal-signal behavior. The 7.1 GB
size makes it heavier than qwen3:8b (5.2 GB) but the difference
in `done`-step token count compensates on overall wall-clock for
short workflows.

### llama3.2:3b

**Take-a-note run.** Fastest + smallest local success on the
matrix. Two clean steps:

```
step 0: TOOL write_memory  in=481/out=57   args: kind='reflection' (correct)
step 1: DONE  "done\nA robot might want to keep a journal..."  in=436/out=71
RESULT: status=success  (~7.8s)
```

Reflection content:

> *"A robot might want to keep a journal to process and reflect
> on its experiences, identify patterns and areas for improvement,
> and gain insights that can inform its future actions."*

Functional + concise. Same conceptual ground as qwen3 +
mistral-nemo but tighter (178 chars).

**This is significant.** llama3.2:3b is:

- **2.0 GB** — smallest model tested that succeeds
- **~7.8 s** — fastest local success (3× faster than mistral-nemo,
  3.6× faster than qwen3:8b)
- **Correctly passes `kind="reflection"`** — Meta fixed the
  schema-literal bug present in llama3.1:8b. Llama3.2 actually
  reads the prompt's instruction "kind: \"reflection\"" rather
  than treating the schema's type annotation as the value.

Best resource-to-success ratio in the matrix. For deployments
where every gigabyte matters (Raspberry Pi-class hardware,
mobile, edge) this is the model to reach for.

`done` emission style is verbose like llama3.1 — emits an inline
fresh reflection (71 tokens) instead of mistral-nemo's terse
literal "done" (2 tokens). Less clean but doesn't affect
correctness.

**Use this when**: hardware is constrained, latency matters, or
you want to run hundreds of workflows per hour locally. The 2 GB
footprint fits comfortably alongside the rest of robotlab_x on
modest hardware.

### llama3.1:8b

> **Update post-`terminate_on`:** intermittent. One run after
> the engine refactor succeeded in ~8.6 s with the model
> correctly emitting `kind="reflection"`. The schema-literal
> bug below still appears in some runs. Treat as unreliable —
> use `llama3.2:3b` (smaller + faster + more consistent)
> instead.

**Take-a-note run.** Surfaces a fourth distinct failure mode: the
tool call SHAPE is correct (real structured tool call via the
ollama API, real `done` emission on step 1, status=success in
~12 s) but the **argument value is wrong**.

The prompt explicitly tells the model:

> 2. Call the write_memory tool with these arguments:
>      - kind: "reflection"
>      - content: <your paragraph from step 1>

llama3.1:8b emitted:

```
write_memory(kind="string", content="A robot might want to keep a journal...")
```

That `kind="string"` looks like the model conflated the schema's
type declaration (`"kind": {"type": "string"}`) with the expected
VALUE for the field. The file landed at `memory/string.md`
instead of `memory/reflection.md` — technically a successful tool
call but the operator's data is in the wrong location.

```
step 0: TOOL write_memory  in=484/out=60   args: kind='string'
step 1: DONE  "A robot might want to keep a journal to record..."  in=436/out=68
RESULT: status=success  (~12.3s)
```

The `done` rationale style is also peculiar — llama emitted a
fresh reflection inline ("done\nA robot might want to keep a
journal to record experiences, learn from mistakes...") instead
of summarizing what got saved (qwen3 style) or being terse
(Claude style). It's like the model wanted to write the journal
in the done message rather than via the tool.

**Use this when**: ...not for take_a_note as currently written.
The schema is ambiguous enough that llama interprets it
literally. Possible mitigations (deferred — see TODO.md):
- Add an `enum` to the `kind` field so allowed values are
  declared: `kind: {"type": "string", "enum": ["reflection",
  "observation", "task_history"]}`. Models that read schemas
  literally (like llama here) would pick from the enum instead
  of "string".
- Stronger prompt phrasing pinning the literal `kind` value.
- Default value in the schema set to "reflection" so the model
  uses it when unsure.

Worth retrying llama3.1:8b once one of those mitigations lands.
The convergence behavior (real tool call + clean done +
status=success) is healthy; just the literal-value
interpretation tripped it up.

### qwen3:8b

**Take-a-note run** — first local ollama model to complete the
workflow correctly. Two clean steps:

```
step 0: TOOL write_memory  in=470/out=367   (260-char reflection)
step 1: DONE  "done: Reflection saved on why a robot might keep a journal."  in=532/out=174
RESULT: status=success  (workflow took ~28.1s total)
```

Reflection content:

> *"A robot might keep a journal to track experiences, analyze
> patterns in sensor data, and retain memory of past interactions.
> This allows it to learn from successes and failures, optimize
> decision-making, and preserve a record of its evolving behavior
> over time."*

Practical + focused. Not as eloquent as Claude (no "form of memory
and identity" reframing) but stays grounded in concrete operations
the robot would actually do — sensor data, pattern analysis,
decision-making. ~260-character payload is appropriate for the
"brief note" instruction.

The convergence behavior is the real news. Where qwen2.5:7b looped
indefinitely, qwen3:8b looks at the tool result and reasons "the
operator asked me to call write_memory once and emit done; I've
done both" → terminates correctly. Genuinely follows the prompt
instructions. The qwen3 base model appears to be a substantial
improvement over qwen2.5 for tool-using workflows.

Latency is ~28 s — about 5x Claude's wall-clock (5.5 s) but
honest local-CPU speed. Two inferences: 470 → 367 tokens on the
tool call, 532 → 174 tokens on the done emission. Total ~1,500
tokens for the full workflow.

**Use this when**: you want local, free, status=success runs and
can spend ~30 s per workflow turn. This is currently the only
local model on the matrix that completes `take_a_note` correctly.
Worth retrying every other workflow against qwen3:8b before
authoring provider-specific variants.

**Reliability check (2 runs).** Both runs landed `status: success`
in 27-28 s wall-clock. Reflection prose varies between runs (it's
a stochastic model) but the SHAPE is stable: one tool call with a
200-260-char focused reflection, then a `done` emission on step
1. Output tokens vary ~2× across runs — qwen3 sometimes spends
more tokens reasoning before emitting the tool call. The `done`
rationale style also drifts: terse one-liner ("done: Reflection
saved...") in run 1, restating the content in run 2. Both valid.
Convergence on `done` is the reliable part.

### claude-opus-4-8 (anthropic)

**Take-a-note run** — the first workflow run in the integration
to complete with `status: success`. Claude made ONE clean tool
call with a polished reflection (~441 chars), the engine fed the
tool result back, and Claude emitted `done` on the next turn.

Total wall-clock: ~5.5 seconds.

Step trace:
```
step 0: TOOL write_memory  in=920/out=203
step 1: DONE  "done — saved a 3-sentence reflection on why a robot might keep a journal."  in=1206/out=28
RESULT: status=success  (workflow took ~5.5s total)
```

Reflection content:

> *"A robot might keep a journal to preserve continuity across
> tasks and sessions, turning fleeting sensor readings and
> decisions into a record it can revisit and learn from. Writing
> things down forces a kind of reflection — noting what worked,
> what failed, and why — which sharpens future judgment. Over
> time, such a journal becomes a form of memory and identity,
> helping the robot act with consistency rather than starting from
> zero each time."*

Notice the differences vs the ollama runs:
- Concrete framing ("preserve continuity across tasks and
  sessions", "fleeting sensor readings")
- No LLM-isms ("behavioral drift", "operational data" — absent)
- Clean conclusion that reframes the question ("becomes a form of
  memory and identity")
- ~200 output tokens on the tool call — half what ollama models
  produced for the same task

**Use this when**: quality of output matters AND you have an
Anthropic API key. The status=success run makes it the only
backend so far suitable for workflows that need to actually
complete successfully (rather than just exercise the integration).

Caveats:
- `claude-3-5-sonnet-20241022` (the old default in `BrainConfig`)
  returns 404 — that model id has been deprecated by Anthropic.
  Use `claude-opus-4-8` / `claude-sonnet-4-6` /
  `claude-haiku-4-5-20251001` from the current 4.x family.


## A/B testing without yaml edits

The Brain panel's workflow card has a **Run configuration** section
that lets you pick `backend` + `model` right before clicking Run —
without touching `workflow.yaml`. Defaults come from the workflow's
`preferred_backend` / `preferred_model`; any divergence highlights
the section in sky and adds a **reset** link. The Save-as-preferred
button next to it persists the current selection back to the
workflow yaml (forking from bundled to workspace first via a confirm
dialog). Use this when comparing models head-to-head:

1. Select a workflow in the file tree.
2. Pick `ollama` backend, type `llama3.2:3b` as the model, Run.
3. After it finishes, change the model field to `qwen3:8b`, Run.
4. Compare results in the Steps tab or `runs/*/summary.json`.
5. If one combo wins, click **save as preferred** to make it the
   workflow's default.

Status badges on each backend chip:
- `✓` last test_backend reply was reachable
- `✗` last test failed
- `⚠` backend has no credentials/base_url configured (clicking the
  chip opens Settings)


## How to run the test yourself (CLI / bus)

1. **Configure the brain's ollama backend** (Brain panel → Settings →
   Backends, or via the bus action `set_backend`):

   ```
   set_backend(name="ollama",
               model="<model-tag>",   # e.g. qwen2.5:7b-instruct-q4_K_M
               make_active=True)
   ```

   The model field is the value used as `model:` in the
   `/api/chat` request — must match an `ollama list` entry.

2. **Run `take_a_note`** with any topic:

   ```
   start_workflow(name="take_a_note",
                  inputs={"topic": "Why robots benefit from a journal."})
   ```

   Override backend + model for a one-off without editing yaml:

   ```
   start_workflow(name="take_a_note",
                  inputs={"topic": "..."},
                  backend="anthropic",
                  model="claude-opus-4-8")
   ```

3. **Watch the run**:
   - Tree: `runs/<timestamp>-take_a_note-<id>/steps.jsonl` and
     `tool_calls.jsonl` for the live step trace.
   - Output: `memory/reflection.md` for the saved reflection(s).
   - The Brain panel's file browser auto-tails `steps.jsonl` while
     a run is in flight.

4. **Tag the result**: `take_a_note` is the simplest pass/fail
   diagnostic — if the model emits even ONE valid tool call with
   parseable args, the integration is working. The "loops without
   done" symptom is independent of the adapter.


## Known issues affecting tests

- **Loops without `done`** (RESOLVED via `terminate_on`).
  Workflows now declare `terminate_on: [{action: <name>}]` and
  the engine terminates as success when those actions have been
  called successfully — no `done` emission required from the
  model. Flipped qwen2.5 + gemma4 from loop-forever to clean
  success and cut wall-clock 25-50% on every previously-passing
  model. Implementation in
  `brain/workflow_engine.py::_loop` (action-success check) and
  the `kind == "done"` branch (rejects `done` if `terminate_on`
  unsatisfied — catches the qwen2.5-coder false-success case).
  Workflow schema field on `Workflow` model.

- **Double-write per tool call.** Memory file gets two appended
  entries for each tool invocation. Caused by boot-lifecycle: the
  in-process adapter's stop+restart sequence doesn't fully cancel
  the prior control loop, so two coroutines pull each message off
  the bus. `list_topics` shows one subscriber but two iterators
  consume independently. Fix lives in
  `framework/adapters/in_process.py::stop()` and/or the bus's
  subscriber-id dedup behaviour. Doesn't affect the model — only
  the on-disk artifact.

- **Tool-name encoding** (already fixed). The adapter used to map
  every tool to indexed names like `tool_000`, hiding the real
  action name from the model. Now uses the action name
  (`write_memory`) directly when valid + unique; falls back to
  indexed only on collision. Models matched the prompt's "call
  write_memory" instruction far better after this fix.

- **Tool `args_schema` not advertised** (already fixed). Meta payload
  was missing `args_schema` per method, so the catalog exposed
  every tool as zero-arg. Models silently skipped tools they
  couldn't figure out how to invoke. Now generated via
  `runtime/schema_introspect.method_args_schema`.

- **`topics_root` vs `topic_root` typo** (already fixed). Meta
  payload published `topics_root` (plural) but brain's
  `_watch_types` read `topic_root` (singular). Every tool's topic
  in the catalog ended up as bare `/control` — safety gate
  rejected every call. Now reads `topics.control` directly with a
  `topics_root` fallback.

- **Anthropic `tool_use` threading on follow-up turns** (FIXED).
  Engine now passes the tool name + args on the assistant
  ChatMessage (`tool_args` field added to `ChatMessage` schema).
  Anthropic adapter's `_split_system` reconstructs the proper
  `tool_use` content block when an assistant message carries a
  tool_call_id; the follow-up tool_result threads to it via
  `tool_use_id`. Verified: claude-opus-4-8 now completes
  `take_a_note` with `status: success`.

- **Anthropic adapter `tool_NNN` indexed naming** (FIXED). Parity
  with ollama: tools now encode under their action name when valid
  + unique, falling back to `tool_NNN` only on collision or invalid
  characters. The `_encode_tools` forward map is consulted by
  `_split_system` to translate action names back to wire names for
  reconstructed `tool_use` blocks.

- **Deprecated `claude-3-5-sonnet-20241022` default** (OPEN — see
  TODO.md). The `BrainConfig.anthropic_model` field defaults to a
  model id Anthropic has retired. Operator-side workaround: set
  the model via `set_backend` to a current 4.x family id
  (`claude-opus-4-8`, `claude-sonnet-4-6`,
  `claude-haiku-4-5-20251001`). Fix is a one-liner default bump in
  `BrainConfig`.


## Updating this document

When you run a new model + workflow combination, append a row to
the matrix + a per-model note. Include:

- Model name + exact ollama tag
- Per-step latency (median of 3 runs)
- Whether `take_a_note` got past step 0 with a valid tool call
- Whether the model converged on `done` or hit max_steps
- A representative quote of the reflection it generated (good
  flavor for the next operator picking a model)

Since `terminate_on` made `done` emission optional, the
interesting model-by-model variability is now: (a) does the model
emit structured `tool_calls` or text-JSON? (b) does it read prompt
instructions for arg values or fall back to schema-literal defaults?
(c) wall-clock at first successful tool call. Note all three when
adding a row.
