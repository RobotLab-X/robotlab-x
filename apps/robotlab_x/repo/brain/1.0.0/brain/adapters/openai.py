# unmanaged
"""OpenAIAdapter — httpx → POST https://api.openai.com/v1/chat/completions.

OpenAI's chat-completions API with function-calling. Most of the
wire shape is the same as Ollama's ``/api/chat`` (Ollama is
deliberately OpenAI-compatible for tools); the two real differences
this adapter handles:

  * ``arguments`` comes back as a JSON-encoded STRING — not a parsed
    dict — so we ``json.loads`` it.
  * Tool result messages use ``role: tool`` (not Anthropic's
    user-with-tool_result block shape) — passes through unchanged
    from our ChatMessage(role="tool", tool_call_id=…) wire shape.

Auth: ``Authorization: Bearer <key>``.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

import httpx

from brain.adapters.base import ModelAdapter
from brain.schemas import (
    ChatMessage,
    ModelResponse,
    ModelUsage,
    ProposedAction,
    ToolDescriptor,
)


logger = logging.getLogger(__name__)


PostFn = Callable[[str, Dict[str, Any], Dict[str, str]], Awaitable[Dict[str, Any]]]


class OpenAIAdapter(ModelAdapter):
    """OpenAI chat-completions adapter."""

    name = "openai"

    def __init__(
        self,
        *,
        api_key: Optional[str] = None,
        base_url: str = "https://api.openai.com",
        model: str = "gpt-4o-mini",
        post: Optional[PostFn] = None,
        timeout: float = 60.0,
    ):
        if not api_key and post is None:
            raise ValueError(
                "OpenAIAdapter: api_key is required (or pass post= for tests)"
            )
        self.api_key = api_key or ""
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        self._post = post
        self._client: Optional[httpx.AsyncClient] = None

    def encode_tools_for_log(self, tools):
        """Return the wire-format tools array — exactly what gets
        sent to OpenAI's /v1/chat/completions in the ``tools`` field
        (``{type: "function", function: {name, description, parameters}}``
        per entry)."""
        encoded, _decode = _encode_tools(tools or [])
        return encoded

    async def complete(
        self,
        messages: List[ChatMessage],
        tools: Optional[List[ToolDescriptor]] = None,
        *,
        model: Optional[str] = None,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ) -> ModelResponse:
        encoded_tools, decode = _encode_tools(tools or [])
        payload: Dict[str, Any] = {
            "model": model or self.model,
            "messages": [_encode_message(m) for m in messages],
            "tools": encoded_tools,
        }
        if max_tokens is not None:
            payload["max_completion_tokens"] = max_tokens
        if temperature is not None:
            payload["temperature"] = temperature

        headers = {
            "authorization": f"Bearer {self.api_key}",
            "content-type": "application/json",
        }
        body = await self._do_post("/v1/chat/completions", payload, headers)
        return _parse_response(body, decode)

    # ─── internals ────────────────────────────────────────────────

    async def _do_post(
        self,
        path: str,
        payload: Dict[str, Any],
        headers: Dict[str, str],
    ) -> Dict[str, Any]:
        url = f"{self.base_url}{path}"
        if self._post is not None:
            return await self._post(url, payload, headers)
        client = await self._get_client()
        resp = await client.post(url, json=payload, headers=headers, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self.timeout)
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None


# ─── helpers ────────────────────────────────────────────────────────


def _encode_message(m: ChatMessage) -> Dict[str, Any]:
    """ChatMessage → OpenAI message dict.

    OpenAI uses ``role: tool`` (same shape as our wire). The
    ``tool_call_id`` field on the message is what threads a tool
    result back to the call that produced it.
    """
    out: Dict[str, Any] = {"role": m.role, "content": m.content or ""}
    if m.name:
        out["name"] = m.name
    if m.tool_call_id:
        out["tool_call_id"] = m.tool_call_id
    return out


def _encode_tools(
    tools: List[ToolDescriptor],
) -> Tuple[List[Dict[str, Any]], Dict[str, ToolDescriptor]]:
    """OpenAI tool descriptors: ``{type: function, function: {...}}``
    with ``parameters`` as JSON Schema."""
    encoded: List[Dict[str, Any]] = []
    decode: Dict[str, ToolDescriptor] = {}
    for i, t in enumerate(tools):
        flat = f"tool_{i:03d}"
        decode[flat] = t
        encoded.append({
            "type": "function",
            "function": {
                "name": flat,
                "description": (t.description or "").strip()[:1024]
                                + f"\n[topic: {t.topic}, action: {t.action}]",
                "parameters": t.parameters or {"type": "object", "properties": {}},
            },
        })
    return encoded, decode


def _parse_response(
    body: Dict[str, Any],
    decode: Dict[str, ToolDescriptor],
) -> ModelResponse:
    """OpenAI chat-completion response → ModelResponse.

    Tool calls live at ``choices[0].message.tool_calls[]``. Arguments
    come back as a JSON-encoded string — defensive ``json.loads``
    here.
    """
    choices = body.get("choices") or []
    if not choices:
        return ModelResponse(
            action=ProposedAction(kind="done", rationale="no choices in response"),
            raw=body,
        )

    msg = choices[0].get("message") or {}
    tool_calls = msg.get("tool_calls") or []
    usage_obj = body.get("usage") or {}
    usage = ModelUsage(
        input_tokens=int(usage_obj.get("prompt_tokens") or 0),
        output_tokens=int(usage_obj.get("completion_tokens") or 0),
    )

    if not tool_calls:
        return ModelResponse(
            action=ProposedAction(
                kind="done",
                rationale=(msg.get("content") or "").strip() or "no tool call, no content",
            ),
            raw=body,
            usage=usage,
        )

    call = tool_calls[0]
    fn = call.get("function") or {}
    flat_name = fn.get("name") or ""
    args_raw = fn.get("arguments")
    args: Dict[str, Any]
    if isinstance(args_raw, str):
        try:
            args = json.loads(args_raw) if args_raw else {}
        except json.JSONDecodeError:
            args = {}
    elif isinstance(args_raw, dict):
        args = args_raw
    else:
        args = {}

    descriptor = decode.get(flat_name)
    if descriptor is None:
        return ModelResponse(
            action=ProposedAction(
                kind="done",
                rationale=f"model called unknown tool {flat_name!r}",
            ),
            raw=body,
            usage=usage,
        )

    return ModelResponse(
        action=ProposedAction(
            kind="tool",
            topic=descriptor.topic,
            action=descriptor.action,
            args=args,
            rationale=(msg.get("content") or "").strip(),
            tool_call_id=call.get("id"),
        ),
        raw=body,
        usage=usage,
    )
