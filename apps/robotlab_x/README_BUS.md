# Bus messages

The robotlab_x runtime is a collection of services that talk to each other
over an in-process pub/sub bus. Every service exposes the same fixed
control envelope; the application-specific shape lives in the kwargs.
This file documents that envelope, where the schemas come from, and how
clients (UI, CLI, brain workflows) drive it.

> **TL;DR.** Publish `{"action": "<method>", ...kwargs, "reply_to":
> "<topic>"}` to `/<type>/<id>/control`. The framework dispatches to the
> matching `@service_method`, validates the kwargs against its signature,
> and publishes the return value to `reply_to`.


## Topic layout

Every service of type `<type>` running with id `<id>` owns three
canonical topics:

| Topic | Direction | Purpose |
|---|---|---|
| `/<type>/<id>/control` | clients → service | RPC inbox. Carries `{action, ...kwargs, reply_to?}` envelopes. |
| `/<type>/<id>/state` | service → subscribers, **retained** | Live snapshot of the service's public state. Late subscribers immediately read the most recent value. |
| `/<type>/<id>/meta` | service → subscribers, **retained** | Capability advertisement. Lists every `@service_method`, its docstring, args JSON Schema, the absolute control topic to call, and any `publishes=[...]` declarations. |

Methods can also opt into `/<type>/<id>/return/<name>` by setting
`publish_return="last"` (retained) or `"event"` (non-retained) on the
decorator — used when you want the return value broadcast even if no
caller supplied a `reply_to`.


## The control envelope

The framework reads `{"action", "reply_to", ...kwargs}` from every
message on `/control`. Source:
[`src/robotlab_x/framework/service.py`](src/robotlab_x/framework/service.py),
in the `_control_loop` coroutine.

```jsonc
{
  "action": "write_memory",      // required, picks which @service_method
  "reply_to": "/cli/reply/...",  // optional, where to publish the result
  // every remaining key becomes a method kwarg
  "kind": "reflection",
  "content": "A short note."
}
```

Behaviour:

1. `payload.action` selects the `@service_method` by name. Unknown
   actions are logged and (if `reply_to` is set) replied with
   `{"error": "unknown action: ..."}`.
2. `reply_to` is **pulled off the envelope** before dispatch — it would
   otherwise reach the method as an unexpected kwarg.
3. The remaining keys are forwarded as `**kwargs` to the method.
4. The return value (or an `{"error": "..."}` envelope if the method
   raised) is published to `reply_to`.
5. If the method declared `publish_return`, the value is **also**
   broadcast on `/<type>/<id>/return/<name>`.

That envelope is the same on every service. The kwargs are not.


## Kwargs are typed, not freeform

Each `@service_method` is a regular Python method. Its signature *is*
the contract:

```python
@service_method("write_memory")
async def m_write_memory(self, kind: str, content: str) -> Dict[str, Any]:
    ...
```

Calling this with `{"action": "write_memory", "kind": "reflection",
"content": "...", "topic": "/brain/brain-1/control"}` raises:

```
BrainService.m_write_memory() got an unexpected keyword argument 'topic'
```

The control loop catches the exception, logs it, and forwards the
error to `reply_to`. There is no extra-key tolerance and no shape
coercion — Python's call semantics are the only filter.


## Schemas are introspected, not hand-written

When a service comes online it publishes a retained `meta` message on
`/<type>/<id>/meta` describing its methods. For each `@service_method`
the framework walks the Python signature + type hints + defaults and
emits an `args_schema` (JSON Schema). See
[`src/robotlab_x/runtime/schema_introspect.py`](src/robotlab_x/runtime/schema_introspect.py)
(`method_args_schema`).

Shape of one entry in the meta payload:

```jsonc
{
  "topics": {"control": "/brain/brain-1/control", ...},
  "methods": [
    {
      "name": "write_memory",
      "doc": "Append a timestamped block to <workspace>/memory/<kind>.md.",
      "args_schema": {
        "type": "object",
        "properties": {
          "kind":    {"type": "string"},
          "content": {"type": "string"}
        },
        "required": ["kind", "content"]
      },
      "publishes": []
    }
  ]
}
```

Subscribers consume this in two main ways:

- **The brain** wildcard-subscribes to `/+/+/meta` and turns every
  declared method into a `ToolDescriptor` keyed by
  `<control_topic>::<action>`. That catalog is what the LLM is offered
  as callable tools inside a workflow. The `::` is purely an internal
  encoding — provider tool APIs (OpenAI functions, Anthropic
  `tool_use`, Ollama `tools`) require a single string for tool name,
  so brain joins topic + action, and the adapter splits it back when
  routing the call.
- **The UI** uses `/v1/bus/topics` (the broker's live view) for live
  subscriber lists + `/v1/service-proxy/{id}/topology` (which reads
  `meta`) for the per-service publish/subscribe panel in the
  Inspector.


## Reading the wire log

The Brain panel's output pane has a **wire** tab that logs every
`/control` round-trip this panel made — request, reply, latency.
Useful when an action isn't doing what you expect. Each entry expands
to show the full `request` envelope and the `reply` payload, including
any `{"error": ...}` reply.

The **topics** tab does the same for tool calls brain made during a
workflow run — same envelope shape, populated from the brain's
`runs/<run_id>/tool_calls.jsonl` stream.


## Implementation pointers

| Area | File |
|---|---|
| Control loop / dispatch | [`src/robotlab_x/framework/service.py`](src/robotlab_x/framework/service.py) `_control_loop` |
| `@service_method` decorator | [`src/robotlab_x/framework/service_method.py`](src/robotlab_x/framework/service_method.py) |
| JSON-Schema introspection | [`src/robotlab_x/runtime/schema_introspect.py`](src/robotlab_x/runtime/schema_introspect.py) |
| `meta` payload assembly | [`src/robotlab_x/framework/service.py`](src/robotlab_x/framework/service.py) `_emit_meta` |
| Brain tool catalog (`/+/+/meta` consumer) | [`repo/brain/1.0.0/brain/service.py`](repo/brain/1.0.0/brain/service.py) `_watch_types` |
| Auto-mounted `set_config` action | [`src/robotlab_x/framework/service.py`](src/robotlab_x/framework/service.py) |
| Bus broker (subscribe / publish primitives) | `rlx_bus` package |


## Quick recipes

**Call a method from the CLI**

```sh
# From any client with bus access:
rlx call /brain/brain-1/control write_memory kind=reflection content='A short note.'
```

`rlx call` constructs the envelope, picks a one-shot reply topic, publishes,
and prints whatever lands on the reply.

**Call from a browser console** (the brain panel's wire dispatcher works
on any service):

```js
ws.publish('/brain/brain-1/control', {
  action: 'write_memory',
  kind: 'reflection',
  content: 'A short note.',
  reply_to: '/cli/reply/manual-1',
})
ws.subscribe('/cli/reply/manual-1', frame => console.log(frame.payload))
```

**Call from a workflow** — the LLM doesn't write envelopes, it picks a
tool by name and supplies kwargs. The brain's `tool_executor` wraps
those into the same envelope above and publishes.


## Brain workflow fields — quick reference

The brain's workflows live as YAML files under `workflows/<name>/`.
Two fields drive model selection at run time:

| Field | Type | Purpose |
|---|---|---|
| `preferred_backend` | str | Picks the **adapter** (one of `mock` / `ollama` / `anthropic` / `openai`). Used to be called `model:` — that name was misleading because this field never named a specific LLM model. The old name is still accepted as a deprecated alias by the loader for one release. |
| `preferred_model` | str (optional) | Pins a specific **model id** (e.g. `llama3.2:3b`, `claude-opus-4-8`). When set, the workflow engine passes this to `adapter.complete(model=...)` on every call, overriding the adapter's configured default (`BrainConfig.<backend>_model`). |

Precedence at run time (`apps/robotlab_x/repo/brain/1.0.0/brain/service.py::m_start_workflow`):

```
backend:  start_workflow(backend=)  >  Workflow.preferred_backend  >  BrainConfig.default_model
model:    start_workflow(model=)    >  Workflow.preferred_model    >  adapter's self.model
```

Use `preferred_model` whenever the workflow's success depends on a
specific model — e.g. `take_a_note` pins `llama3.2:3b` because
`llama3.1:8b` mis-interprets the JSON Schema of `write_memory` and
emits `content: "{"`. See `repo/brain/1.0.0/TESTING_RESULTS.md` for
the per-workflow validation matrix.


## Common errors

| Symptom | Cause |
|---|---|
| `got an unexpected keyword argument 'X'` in `tool_calls.jsonl` | LLM (or any caller) added a key the method's signature doesn't accept. Same as a Python `TypeError`. |
| `unknown action: X` reply | `payload.action` doesn't match any `@service_method` on the receiving service. Check the service's `meta` to see what's actually advertised. |
| Message published but nothing happens | Service isn't running, the topic name is wrong, or `payload.action` isn't a string. The control loop silently drops non-string action values. |
| Reply never arrives | Caller's `reply_to` topic was set but their WS client wasn't subscribed to it yet when the reply published. Subscribe **first**, then publish (the brain panel's `dispatch` does this with an `awaitSubscribed` step). |
