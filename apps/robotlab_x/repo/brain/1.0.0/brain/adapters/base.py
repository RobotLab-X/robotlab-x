# unmanaged
"""ModelAdapter ABC. Adapters return ``ModelResponse`` from
``complete()`` — never raw text; the parsing-into-an-action burden
lives in the adapter, not the workflow engine."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from brain.schemas import ChatMessage, ModelResponse, ToolDescriptor


class ModelAdapter(ABC):
    """Common interface every model backend implements.

    The workflow engine calls ``await adapter.complete(messages, tools)``
    once per step. Implementations should:
      * Translate ``tools`` into the provider's native tool-calling
        format (OpenAI functions, Anthropic tool_use, Ollama tools).
      * Parse the provider's response into a ``ProposedAction`` — a
        tool call or a terminal ``done``.
      * Fill ``ModelUsage`` if the provider reports it; workflows
        rely on this for ``max_tokens_per_run`` enforcement.
    """

    name: str = "abstract"

    @abstractmethod
    async def complete(
        self,
        messages: List[ChatMessage],
        tools: Optional[List[ToolDescriptor]] = None,
        *,
        model: Optional[str] = None,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ) -> ModelResponse:
        """Run one chat completion.

        ``model`` overrides the adapter's default model id for this
        single call. Used by workflows that pin ``preferred_model``
        (e.g. ``take_a_note`` pins ``llama3.2:3b``). When None the
        adapter uses its configured ``self.model``.
        """
        ...

    def encode_tools_for_log(
        self, tools: List[ToolDescriptor],
    ) -> List[Dict[str, Any]]:
        """Return the wire-format tools array — what the LLM
        actually receives — for run-folder logging. Default falls
        back to the brain's internal ``ToolDescriptor`` shape;
        provider adapters override to return their native format
        (Ollama / OpenAI ``{type: "function", function: {…}}``,
        Anthropic ``{name, description, input_schema}``).

        Used by ``WorkflowEngine`` when writing ``runs/<id>/tools.json``
        + the ``tools`` field of each ``requests.jsonl`` entry so the
        operator can read exactly what got sent to the provider.
        Adapters that don't override get the bookkeeping shape, which
        is fine — those are stub/test adapters that never reach a
        real API."""
        return [t.model_dump() for t in tools]
