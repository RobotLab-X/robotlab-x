# unmanaged
"""MockAdapter — deterministic, scripted, for tests + offline workflow
authoring.

Construct with a list of ``ProposedAction`` or ``ModelResponse``
objects; ``complete()`` returns them in order. Records every prompt
it was called with so tests can assert the workflow built the
context correctly.

This is the canonical v1 target — every other adapter has to match
its observable behaviour (action shape, usage accounting, error
handling).
"""
from __future__ import annotations

from typing import Iterable, List, Optional, Sequence, Union

from brain.adapters.base import ModelAdapter
from brain.schemas import ChatMessage, ModelResponse, ModelUsage, ProposedAction, ToolDescriptor


ScriptEntry = Union[ProposedAction, ModelResponse]


class MockAdapter(ModelAdapter):
    """Replay scripted responses in order."""

    name = "mock"

    def __init__(self, script: Sequence[ScriptEntry]):
        self._script: List[ModelResponse] = []
        for entry in script:
            if isinstance(entry, ProposedAction):
                self._script.append(ModelResponse(action=entry))
            elif isinstance(entry, ModelResponse):
                self._script.append(entry)
            else:
                raise TypeError(
                    f"MockAdapter script entries must be ProposedAction or ModelResponse, "
                    f"got {type(entry).__name__}"
                )
        self._cursor = 0
        # Record what we were asked. Tests assert against these.
        self.calls: List[dict] = []

    async def complete(
        self,
        messages: List[ChatMessage],
        tools: Optional[List[ToolDescriptor]] = None,
        *,
        model: Optional[str] = None,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ) -> ModelResponse:
        self.calls.append({
            "messages": [m.model_dump() for m in messages],
            "tools": [t.model_dump() for t in (tools or [])],
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
        })
        if self._cursor >= len(self._script):
            # Script exhausted — emit a terminal done so the workflow
            # ends gracefully instead of looping on stale state.
            return ModelResponse(
                action=ProposedAction(
                    kind="done",
                    rationale="MockAdapter script exhausted — emitting terminal done",
                ),
                usage=ModelUsage(),
            )
        resp = self._script[self._cursor]
        self._cursor += 1
        return resp

    @property
    def script_remaining(self) -> int:
        return max(0, len(self._script) - self._cursor)


def script_done(rationale: str = "done") -> ProposedAction:
    """Tiny helper for tests authoring MockAdapter scripts."""
    return ProposedAction(kind="done", rationale=rationale)


def script_call(topic: str, action: str, args: Optional[dict] = None, *, tool_call_id: Optional[str] = None) -> ProposedAction:
    """Tiny helper for tests authoring MockAdapter scripts."""
    return ProposedAction(
        kind="tool",
        topic=topic,
        action=action,
        args=args or {},
        tool_call_id=tool_call_id,
    )
