# Brain TODO

Operator-facing followups for the brain service. Each entry is a
question or a piece of work that hasn't been done yet; status field
tracks whether ideation is open or closed.


## OPEN — How to maintain workflows across model + backend differences

**Status**: ideation open. No implementation should land until we
have empirical data from several models.

**Problem**

Different LLM backends + model families behave differently on the
same workflow. Concrete observations so far (see TESTING_RESULTS.md):

- **Ollama qwen2.5:7b** and **gemma4:e4b** call `write_memory`
  correctly but never emit `done` — they loop until `max_steps`
  exhausts, producing rephrased re-attempts each turn. Engine
  terminates with `status: failure`.
- **Claude opus-4-8** makes one clean call + would emit `done` on
  the follow-up turn if the adapter weren't broken. Different
  convergence pattern entirely.
- **qwen2.5:7b** content is generic ("journaling is helpful");
  **gemma4:e4b** is jargon-y ("behavioral drift", "operational
  data"); **Claude** is concrete + accountable ("retain continuity
  across tasks that its short working memory would otherwise
  discard"). All call the same tool with different prose.

If we tune `take_a_note` (prompt phrasing, `max_steps`, step graph
shape) to converge on Claude's natural single-shot pattern, the
ollama models still loop. If we tune for ollama's looping pattern
(e.g., `max_steps=1`, "do exactly one tool call then we'll
auto-terminate"), we lose Claude's natural multi-turn capability.
There's no single workflow shape that's optimal across providers.

**Why this matters**

The brain ships 15 bundled workflows today. If we have to author
each one N times (once per backend family), the catalog explodes
+ stays out of sync as we add models. But if we author once with
a single shape, some providers will fail.

**Possible approaches to investigate** (do NOT pick one without
data — the right approach depends on how DIFFERENT the providers
actually are):

1. **Provider-named workflows.** Sibling folders:
   `take_a_note_anthropic/` · `take_a_note_ollama/` ·
   `take_a_note_openai/`. The brain UI surfaces them as separate
   workflows; the operator picks the one matching their configured
   backend. Pros: simple, no engine changes, easy to A/B. Cons:
   directory sprawl (`take_a_note_anthropic_4_8` vs `_3_5`?
   how granular?), discoverability mediocre, can't share the
   non-model-specific parts.

2. **Subfolders per provider inside a single workflow dir.** Instead
   of `take_a_note_anthropic/`, use
   `take_a_note/variants/anthropic/` containing the per-provider
   overrides (just `prompt.md`, just `workflow.yaml`, or both). The
   parent `take_a_note/` carries shared files. The brain loader
   walks the variant matching the active backend; missing variant
   → fall back to parent. Pros: keeps related variants together,
   shared resources stay shared. Cons: more loader complexity,
   non-trivial to explain.

3. **Provider-keyed sections in workflow.yaml.** One workflow file
   with branches:
   ```yaml
   prompts:
     default: prompt.md
     anthropic: prompt_anthropic.md
     ollama: prompt_ollama.md
   max_steps:
     default: 8
     anthropic: 2
   ```
   Loader resolves per the active backend. Pros: one file per
   workflow, easy to see all variants at once. Cons: yaml gets
   busy fast; harder to edit the live prompt for one provider
   without reading the others; binding to specific providers
   instead of behavioral profiles.

4. **Behavioral profiles, not providers.** Group models by *how
   they converge*, not by what API they use. e.g., profile
   `single_shot` (Claude, big OpenAI), `loops_until_done`
   (ollama small models), `chain_of_thought` (deepseek-r1).
   Workflows declare which profiles they support; the loader picks
   a variant matching the active model's profile. Profiles are
   defined in one place (`profiles.yaml`) listing which
   model_tag → profile. Pros: scales as providers add models —
   you classify new model once, every workflow auto-benefits.
   Cons: needs profile taxonomy work; mis-classification
   propagates.

5. **Engine-level convergence handling.** Strip the question from
   workflows entirely and make the engine smart enough to converge
   reasonable models. Concrete strategies:
   - **Auto-terminate on duplicate tool calls.** If the model
     makes the same tool call (same name + similar args) twice in
     a row, treat the second as `done` and stop.
   - **Inject a synthetic done-prompt.** After a successful tool
     call, when the model fails to emit `done`, send a
     follow-up: "You called the tool successfully. If you have
     no other action to take, respond with the literal word
     done." Cost: one extra inference per workflow run.
   - **max_steps semantics change.** Distinguish "max useful tool
     calls" (1 for take_a_note) from "max model invocations"
     (could be 4 — engine wraps them). Status=success when the
     useful-calls budget is exhausted, not failure.

6. **Hybrid.** Maybe the answer is profiles (4) for the
   prompt + max_steps shape AND engine-level convergence (5) for
   the done emission. They solve different aspects of the same
   problem.

**What to gather before picking**

Each empirical data point reduces the design space. Things we
don't know yet:

- Does qwen2.5 emit `done` if we phrase the prompt differently?
  (E.g., "When you call the tool, the system will save your
  reflection. Reply with the single word done." — would tighter
  framing converge it?)
- Do qwen3 / llama3.x / mistral-nemo / glm-4.7-flash differ from
  qwen2.5 on this loop pattern?
- Does Claude actually emit `done` reliably once the follow-up
  adapter bug is fixed?
- Does OpenAI behave more like Claude (single-shot) or more like
  ollama (loops)? Need a live run.
- Are the differences mostly about *prompt sensitivity* (a-b test
  prompts on one model) or about *fundamental conversation
  shape* (the model just doesn't think in terms of `done`)?

Each test on a new model + tweaked prompt → row in
`TESTING_RESULTS.md`. Once we have ~8 data points, the design
space collapses to one or two viable approaches.

**Decision criteria**

When picking an approach, weigh these in roughly this order:

1. **Author cost per workflow.** A workflow author shouldn't need
   to think about backends. If they do, they will skip it and
   the catalog stays thin.
2. **Catalog discoverability.** Operators shouldn't see N versions
   of every workflow in the file tree; one entry should resolve
   the right variant automatically.
3. **Failure mode legibility.** When a workflow misbehaves on a
   provider, the operator should be able to figure out why —
   "this provider isn't profiled" beats "no idea, it just loops."
4. **Engine simplicity.** Fewer special-cases in the engine, even
   at the cost of more yaml.

Until we have data, defer.


## OPEN — Engine convergence semantics: when is `done` legitimate?

**Status**: open question, surfaced by the qwen2.5-coder:7b run.

When a model emits `kind=done` (either explicitly or by returning
text-only with no tool call), the engine currently terminates the
workflow with `status: success`. That's fine when the model
actually did the work the workflow asked for. It's WRONG when the
model:

- Emitted the tool call as JSON text inside `content` instead of
  via the structured tool-calling API (qwen2.5-coder behavior —
  the adapter sees no tool_calls and treats the text as `done`,
  but the actual side-effect — write_memory invocation — never
  happened).
- Decided the workflow was unsolvable / refused / hallucinated a
  completion message without doing the work.
- Hit some adapter parsing edge case where a real tool call was
  present but got missed.

The current take_a_note run with qwen2.5-coder reports
`status: success` despite producing zero output (empty
`reflection.md`). The operator-facing result is a lie.

**Questions to investigate:**

- Should the engine require at least one tool call before
  accepting `done` when the workflow's `allowed_tools` declares
  any tools? Maybe a `requires_tool_call: true` field in
  workflow.yaml (per-step or workflow-level)?
- Should adapters detect "tool call as JSON in content" patterns
  and parse them out before declaring `done`? Risky — could
  misinterpret valid prose that mentions JSON.
- Should `take_a_note` require a tool call to count as success,
  vs. workflows like `emergency_stop` where text-only "I called
  stop" IS the completion (no tool result expected)?
- How do we signal "the workflow was supposed to have produced
  output X, but X didn't appear" without re-implementing
  workflow-output validation?

Related to the broader "workflow variants per backend" question
above — different convergence semantics may be the right tool for
different model families. A coder-specialized model variant might
deliberately use text-as-tool-call and we'd need to parse it; a
chat model uses structured calls and the current logic works fine.

**Preferred direction (operator-proposed, not yet implemented).**
Move workflow lifecycle into the engine, not the model. The
engine publishes start + end events on a flat topic
``/brain/{id}/workflow_events``; ``workflow.yaml`` gains a
``terminate_on:`` field declaring when the engine should consider
the work done — typically "after this specific tool was called
successfully" or "after all of these tools were called." The
model never needs to emit ``done``; it just calls tools.

This converts the failed loops (qwen2.5, gemma4) into successes
on `take_a_note` (single tool call → done) and converts
qwen2.5-coder's false-positive success into an honest failure
(zero real tool calls → max_steps exhausted → status: failure).
Big win for matrix coverage.

Keep ``done`` as a SECONDARY termination path for genuinely
open-ended workflows like ``explore_room`` where the model
decides when it's seen enough. Backwards compatible: workflows
without ``terminate_on`` keep current behavior.

Edge cases to ideate before implementing:
- Failed tool call vs successful tool call (failed shouldn't
  satisfy ``terminate_on``)
- Workflows that want tool call + summary turn (a new value:
  ``tool_call_with_summary``?)
- Tool-call-only workflows lose the model's natural language
  summary — is the saved tool output enough? Probably yes for
  ``take_a_note`` (the reflection IS the artifact). Might matter
  for workflows where the operator wants a verbal recap.
- Migration: which existing workflows should opt in to
  ``terminate_on``? Probably all the "tool then done" shaped ones
  (take_a_note, inspect_object, emergency_stop, count_objects,
  teach_object). Leave the multi-step exploratory ones alone.


## Other tracked items (smaller)

### Strip the in-process adapter's boot-time double dispatch
Each tool call writes twice to disk because the stop+restart
sequence during `reconcile_running_proxies` doesn't fully reap
the previous control loop. Fix in
`framework/adapters/in_process.py::stop()` and/or the bus's
subscriber-id dedup. Affects file contents only.

### Bump `BrainConfig.anthropic_model` default
Current default is `claude-3-5-sonnet-20241022` which Anthropic
has deprecated → 404. Bump to a current 4.x family id.

### Bring openai + anthropic adapters to tool-name encoding parity
The ollama adapter was fixed to use the action name directly (no
more `tool_NNN` indexed naming) when it's unique. The openai and
anthropic adapters still use indexed names. Same one-liner fix
needed in each. Likely affects "model can match the prompt's
human tool name to a tool in the catalog" — same root cause as
the ollama fix.

### Add `enum` constraints to `kind` (and similar categorical args)
Surfaced by the llama3.1:8b run. Models that read JSON schemas
literally interpret `"type": "string"` as "the value should be the
string 'string'". An `enum` clause would force them to pick one of
the allowed labels. Means letting service authors declare
categorical fields on their `@service_method` signatures via
`Literal["a", "b", "c"]` and having `runtime/schema_introspect`
emit them as `enum` in the generated JSON schema. Probably already
works for Literal; would need to verify + extend the brain's
`m_write_memory` to use `kind: Literal["reflection",
"observation", "task_history"]` instead of plain `str`.

### Run `take_a_note` against the other installed ollama models
`qwen3-coder:30b`, `qwen3:8b`, `qwen2.5-coder:7b`, `glm-4.7-flash`,
`deepseek-r1`, `gemma4:e2b`. Each provides a data point for the
profile-vs-provider question above. Log every result in
TESTING_RESULTS.md.

### Add OpenAI live run + record in TESTING_RESULTS.md
No live OpenAI inference exercised yet. Need at minimum one tool-
calling capable model (`gpt-4o-mini` or `gpt-4o`).


## OPEN — Audit bundled prompts vs declared workflow inputs

**Status**: ideation open. Concrete bug evidence motivates the audit.

**Problem**

The context loader substitutes `inputs:` into `prompt.md` via Python
`str.format(**inputs)` (`brain/context_loader.py::render_context`).
That means every declared input MUST appear in the prompt as a
`{key}` placeholder to actually reach the model — otherwise the
operator's value is silently dropped, and the LLM sees the input
name as a literal English word with no value attached.

Concrete example: `workflows/conversation_session/workflow.yaml`
declares three inputs (`exit_phrase`, `listen_window_seconds`,
`remember_notable`). The prompt uses `{exit_phrase}` and
`{listen_window_seconds}` correctly, but mentions `remember_notable`
as an English word ("When `remember_notable` is true …") without
the curly braces — so the model never sees the actual boolean
value the operator passed. Whether it writes to
`memory/conversations.md` becomes a coin flip on the model's prior.

**Work**

Run a script over every `repo/brain/1.0.0/workflows/*/` directory:

1. Parse `workflow.yaml::inputs`
2. Read `prompt.md`
3. For each input key: search for `{key}` (substring match counts
   — formats like `{key:format_spec}` are valid too)
4. Flag any input that has NO `{key}` reference — those are either
   dead config (input was added but never wired) or silently
   dropped (prompt should reference it but doesn't)
5. Also flag the inverse: prompt placeholders `{name}` where
   `name` isn't a declared input → `str.format` will raise on
   `start_workflow` (loud failure, not silent, but still a bug)

Bonus: ship this as a unit test
(`test_bundled_workflows_inputs_match_prompts`) so the audit runs
on every CI build and catches the next instance at PR time.

While doing the audit, also fix the conversation_session
`remember_notable` instance discovered above — either reference
it as `{remember_notable}` in the prompt or remove the input
declaration if the operator shouldn't override it.
