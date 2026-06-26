# unmanaged
"""Pydantic models that the rest of the brain reads + writes.

Every cross-module data structure flows through one of these. They're
deliberately small + literal — the brain doesn't have a separate ORM,
DB schema, or wire-format layer. Workflow YAMLs parse into these;
bus payloads serialise from these; run logs are JSON lines of these.
"""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


# ─── workflow definition (parsed from disk) ──────────────────────────


class ToolPattern(BaseModel):
    """One row of allowed_tools.yaml ``allowed`` or ``blocked``."""
    topic: str = Field(..., description="Topic glob, e.g. /video/*/control or /movement/* ")
    actions: List[str] = Field(
        default_factory=list,
        description="Action names allowed on the matched topic. Empty/omitted = no actions.",
    )


class AllowedTools(BaseModel):
    """Parsed allowed_tools.yaml for one workflow."""
    allowed: List[ToolPattern] = Field(default_factory=list)
    blocked: List[ToolPattern] = Field(default_factory=list)


class WorkflowInput(BaseModel):
    """One entry in workflow.yaml ``inputs:`` — per-run argument schema."""
    type: Literal["string", "integer", "boolean", "number"] = "string"
    description: Optional[str] = None
    required: bool = False
    default: Any = None


class WorkflowStep(BaseModel):
    """One step in a workflow's state machine. v1 has a single 'default'
    step that loops; the multi-step graph is just an extension point."""
    id: str = "default"
    prompt: str = "prompt.md"
    on_success: str = "success.md"
    on_failure: str = "failure.md"


class ToolTerminationCondition(BaseModel):
    """Engine-driven terminal condition. Once every action listed in a
    workflow's ``terminate_on`` has been called successfully at least
    once, the engine terminates the run as success WITHOUT requiring
    the model to emit ``done``.

    Matches by action name only — proxy ID and args are not part of
    the match. The workflow's ``allowed_tools`` already constrains
    which proxies are reachable; args matching adds complexity without
    a current use case (revisit if a workflow needs it).
    """
    action: str


class ExitOnPhrase(BaseModel):
    """Engine-enforced exit-phrase interceptor for long-running
    workflows. The engine spawns a watcher task at run start that
    subscribes to ``listen_topic`` and matches every incoming text
    payload against ``matches``. On match, the engine force-
    terminates the run as ``success`` — bypassing the LLM entirely
    so exit latency is bus-RTT (<50ms) not inference-latency.

    Why engine-enforced instead of prompted to the LLM: across long
    conversations, model drift makes "emit done on phrase X" an
    unreliable contract. The engine guarantees it.

    ``whole_message=True`` (default) requires the utterance to equal
    one of the matches exactly (after strip + optional case fold) —
    prevents "stop the servo" from matching a "stop" exit phrase.
    ``whole_message=False`` substring-matches; suitable when the
    operator might prefix/suffix the exit phrase."""
    matches: List[str] = Field(default_factory=list)
    case_insensitive: bool = True
    whole_message: bool = True
    listen_topic: Optional[str] = Field(
        default=None,
        description="Wildcard or exact topic to subscribe to for exit-phrase detection. "
                    "Payload's ``text`` field is the candidate string. "
                    "Example: ``/chat/+/inbox`` to catch every chat instance.",
    )


class LoopOnTimeout(BaseModel):
    """Fast-path for tools that return a timeout marker (e.g. chat
    service's ``listen`` returns ``{text: '', timeout: True}`` when
    no message arrives). When the engine sees a tool result that
    matches this config, it locally re-dispatches the same tool call
    without going back to the LLM — saving the round trip on every
    idle tick. Bounds (cancel, run timeout, exit phrase) still apply.

    Example for the chat service::

        loop_on_timeout:
          tool: listen
          field: timeout
          value: true"""
    tool: str = Field(..., description="Action name of the tool whose result triggers the re-loop.")
    field: str = Field(..., description="Key on the tool's result dict to inspect.")
    value: Any = Field(..., description="Matched value of that key — when equal, re-dispatch.")


class RunConfiguration(BaseModel):
    """One named (backend, model) combo the operator wants to switch
    between quickly. Saved into ``workflow.yaml::configurations``.

    Configurations are operator-curated experimentation aids — the
    workflow's canonical default still lives in ``preferred_backend``
    / ``preferred_model``. The toolbar's configuration dropdown lets
    the operator flick between saved combos without editing yaml;
    selecting one populates the backend + model fields, and the Run
    button passes those values into ``start_workflow(backend=,
    model=)``.

    Names must be unique within a workflow's ``configurations`` list.
    They're free-form labels — operators use them as "fast", "smart",
    "production", etc. ``description`` is optional rationale that
    surfaces as a tooltip in the dropdown."""
    name: str = Field(..., description="Unique label within this workflow's configurations.")
    backend: str = Field(..., description="Adapter name — one of mock / ollama / anthropic / openai.")
    model: Optional[str] = Field(default=None, description="Model id (e.g. llama3.2:3b). None = adapter default.")
    description: str = ""


class Workflow(BaseModel):
    """Parsed workflow.yaml + sibling files. Created by context_loader."""
    name: str
    description: str = ""
    # Which BACKEND (adapter) the workflow prefers — one of
    # ``mock`` / ``ollama`` / ``anthropic`` / ``openai``. The brain
    # falls back to ``BrainConfig.default_model`` (also a backend
    # name, despite the legacy field name) when this isn't set, and a
    # per-call ``start_workflow(backend=...)`` arg overrides both.
    # Previously named ``model`` — that label was misleading because
    # this never named a specific LLM model; it picked the adapter
    # only. The model id used at runtime is configured per-backend on
    # ``BrainConfig.<backend>_model`` (e.g. ``ollama_model``) and can
    # be pinned per-workflow via ``preferred_model`` below.
    preferred_backend: str = "mock"
    # Optional pin on the model id (e.g. ``llama3.2:3b``,
    # ``claude-opus-4-8``). When set, this overrides the backend's
    # default model just for this workflow's runs. Useful for
    # workflows whose tool-call behaviour is sensitive to model
    # quirks — ``take_a_note`` pins ``llama3.2:3b`` because
    # ``llama3.1:8b`` fails its schema interpretation on the
    # ``write_memory`` arg shape. See TESTING_RESULTS.md.
    preferred_model: Optional[str] = None
    # Operator-curated alternates to ``preferred_*``. Surfaced via the
    # brain panel's configuration dropdown so the operator can flick
    # between saved (backend, model) combos without editing yaml. Read
    # by the brain via ``start_workflow(configuration=<name>)`` — the
    # engine looks up the entry and substitutes its backend + model
    # before the run starts.
    configurations: List[RunConfiguration] = Field(default_factory=list)
    max_steps: int = 8
    timeout_seconds: int = 120
    max_tokens_per_run: Optional[int] = None
    requires_human_approval: bool = False
    inputs: Dict[str, WorkflowInput] = Field(default_factory=dict)
    steps: List[WorkflowStep] = Field(default_factory=lambda: [WorkflowStep()])
    context: List[str] = Field(
        default_factory=list,
        description="Paths to memory files to pull into model context at start.",
    )
    allowed_tools: AllowedTools = Field(default_factory=AllowedTools)
    # Engine-driven termination — see ToolTerminationCondition. When
    # non-empty, the engine terminates as success as soon as ALL listed
    # actions have been called successfully at least once in this run.
    # Empty (default) preserves the legacy done-from-model behavior.
    terminate_on: List[ToolTerminationCondition] = Field(default_factory=list)
    # Engine-enforced exit-phrase interceptor. See ExitOnPhrase.
    # When set, the engine spawns a watcher task at run start that
    # subscribes to the topic, matches incoming text against the
    # patterns, and force-terminates the run on match. Long-running
    # workflows (conversation_servo, conversation_session) use this
    # so the operator can always escape regardless of model drift.
    exit_on_phrase: Optional[ExitOnPhrase] = None
    # Fast-path for tools that return a timeout marker (e.g. chat's
    # ``listen``). On match, engine re-dispatches the tool without an
    # LLM round trip. See LoopOnTimeout.
    loop_on_timeout: Optional[LoopOnTimeout] = None
    # Sliding conversation window. When set, the engine trims the
    # messages array after each turn to keep only the system message
    # + the last N entries. Bounds token usage on long-running
    # workflows without losing the system prompt or recent context.
    # ``None`` (default) keeps the full history.
    message_window_size: Optional[int] = None
    prompt_md: str = ""
    success_md: str = ""
    failure_md: str = ""


# ─── chat / model interface ─────────────────────────────────────────


class ChatMessage(BaseModel):
    """OpenAI-shaped chat message — every modern adapter normalises here."""
    role: Literal["system", "user", "assistant", "tool"]
    content: str
    # Optional fields for tool-message threads.
    tool_call_id: Optional[str] = None
    name: Optional[str] = None
    # When the engine appends an assistant message AFTER a tool call,
    # adapters that need the full tool-call shape (anthropic's
    # ``tool_use`` block, openai's ``tool_calls`` array) reconstruct
    # it from ``tool_call_id`` + ``name`` + ``tool_args``. Required for
    # anthropic to thread the follow-up turn's ``tool_result`` to its
    # originating ``tool_use_id``; ignored by adapters that don't care.
    tool_args: Optional[Dict[str, Any]] = None


class ToolDescriptor(BaseModel):
    """JSON-Schema'd tool advertised to the model. Derived from the
    service's @service_method args_schema + the bus topic the action
    is dispatched to.

    Adapters translate this into the provider's native tool format
    (OpenAI functions, Anthropic tool_use, Ollama tools)."""
    topic: str = Field(..., description="e.g. /video/video-1/control")
    action: str = Field(..., description="e.g. capture_frame")
    description: str = ""
    parameters: Dict[str, Any] = Field(
        default_factory=dict,
        description="JSON Schema for the action's arguments.",
    )

    @property
    def name(self) -> str:
        """Stable identifier used in tool-call response routing.
        Provider tool name has to be a single string — we encode the
        topic + action via ``::`` so the parser can split on it."""
        return f"{self.topic}::{self.action}"


class ProposedAction(BaseModel):
    """The model's output, parsed into something the brain can validate.

    Either a tool call or a terminal ``done`` signal. Adapters return
    one of these from .complete() — never raw text. If the model
    rambles instead of using a tool, MockAdapter (and real adapters
    via the no-tool-call path) emit ``ProposedAction(kind="done")``
    with the rambling text as ``rationale``.
    """
    kind: Literal["tool", "done"]
    topic: Optional[str] = None
    action: Optional[str] = None
    args: Dict[str, Any] = Field(default_factory=dict)
    rationale: str = Field(default="", description="The model's explanation / chain-of-thought.")
    tool_call_id: Optional[str] = None  # round-trips through the chat history


class ModelUsage(BaseModel):
    """Token accounting per ``complete()`` call. Adapters fill what they know."""
    input_tokens: int = 0
    output_tokens: int = 0


class ModelResponse(BaseModel):
    """Everything an adapter returns from .complete()."""
    action: ProposedAction
    raw: Dict[str, Any] = Field(default_factory=dict, description="provider-specific response")
    usage: ModelUsage = Field(default_factory=ModelUsage)


# ─── safety + execution ─────────────────────────────────────────────


class SafetyVerdict(BaseModel):
    allowed: bool
    reason: str = ""
    # Filled when a guard short-circuited (max_steps / max_tokens / approval).
    guard: Optional[Literal["allow_list", "block_list", "max_steps", "max_tokens", "timeout", "approval", "unknown_target", "schema"]] = None


class ToolResult(BaseModel):
    """What we record after publishing a tool call + getting the reply."""
    status: Literal["ok", "error", "timeout"] = "ok"
    value: Any = None
    error: Optional[str] = None
    duration_ms: int = 0


# ─── run record (the thing logged to disk + bus) ─────────────────────


class StepRecord(BaseModel):
    ts: str  # iso-8601 UTC
    step: int
    model: str
    prompt_summary: str
    response_raw: Dict[str, Any] = Field(default_factory=dict)
    action: ProposedAction
    verdict: SafetyVerdict
    tool_call_id: Optional[str] = None
    usage: ModelUsage = Field(default_factory=ModelUsage)


class ToolCallRecord(BaseModel):
    ts: str
    step: int
    tool_call_id: str
    topic: str
    action: str
    args: Dict[str, Any]
    result: ToolResult


class RunRecord(BaseModel):
    """Top-level summary of a single workflow run."""
    run_id: str
    workflow: str
    started_at: str
    ended_at: Optional[str] = None
    status: Literal["pending", "running", "awaiting_approval", "success", "failure", "cancelled"] = "pending"
    inputs: Dict[str, Any] = Field(default_factory=dict)
    # The ADAPTER (provider) the run is using. One of ``mock`` /
    # ``ollama`` / ``anthropic`` / ``openai``. Previously the field was
    # called ``model`` which was misleading — it never named a specific
    # LLM model, only the adapter. Renamed 2026-06-04; no alias.
    backend: str = "mock"
    # The actual LLM model id (e.g. ``llama3.2:3b``, ``claude-opus-4-8``).
    # None means "use the adapter's configured default
    # (BrainConfig.<backend>_model)". Set when the workflow's
    # ``preferred_model`` is non-null or when the operator overrode at
    # start time via ``start_workflow(model=...)``.
    model_id: Optional[str] = None
    steps_used: int = 0
    tokens_used: int = 0
    result_summary: str = ""
    failure_reason: Optional[str] = None
