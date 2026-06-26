# unmanaged
"""AnthropicAdapter — httpx → POST https://api.anthropic.com/v1/messages.

Claude's Messages API is shape-close to OpenAI but has three notable
differences the adapter handles:

  * No ``system`` ROLE in the messages array — the system prompt is
    a top-level ``system`` field on the request.
  * Tool results travel BACK as a ``role: user`` message with
    ``content: [{type: tool_result, tool_use_id: ..., content: ...}]``
    instead of OpenAI's ``role: tool`` message.
  * ``max_tokens`` is REQUIRED on every request. We default to 4096
    so it's never accidentally unset.

Auth: ``x-api-key`` header. Pinned API version ``2023-06-01``
(stable; future-major changes are opt-in).

Tool format: ``{name, description, input_schema}`` — JSON Schema in
``input_schema`` (not ``parameters`` like OpenAI/Ollama).

Response: ``content[]`` is a heterogeneous list of blocks; the first
``tool_use`` block (if any) becomes the proposed action, otherwise
the first ``text`` block's content becomes the terminal ``done``
rationale.
"""
from __future__ import annotations

import logging
import re
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


# Same shape as OllamaAdapter's PostFn — bound async POST that
# returns the decoded JSON body. Tests inject; production builds
# httpx.AsyncClient lazily.
PostFn = Callable[[str, Dict[str, Any], Dict[str, str]], Awaitable[Dict[str, Any]]]

ANTHROPIC_API_VERSION = "2023-06-01"
DEFAULT_MAX_TOKENS = 4096


class AnthropicAdapter(ModelAdapter):
    """Claude Messages API adapter."""

    name = "anthropic"

    def __init__(
        self,
        *,
        api_key: Optional[str] = None,
        base_url: str = "https://api.anthropic.com",
        model: str = "claude-3-5-sonnet-20241022",
        post: Optional[PostFn] = None,
        timeout: float = 60.0,
    ):
        if not api_key and post is None:
            raise ValueError(
                "AnthropicAdapter: api_key is required (or pass post= for tests)"
            )
        self.api_key = api_key or ""
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        self._post = post
        self._client: Optional[httpx.AsyncClient] = None

    def encode_tools_for_log(self, tools):
        """Return the wire-format tools array — exactly what gets
        sent to Anthropic's /v1/messages in the ``tools`` field
        (``{name, description, input_schema}`` per entry)."""
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
        # action_name → wire_name so _split_system can construct
        # tool_use blocks for assistant messages that followed a tool
        # call. Keys are the action names the engine sees; values are
        # what we encoded for the API. For typical action names that
        # match the regex + are unique, key == value.
        name_map = {desc.action: wire for wire, desc in decode.items()}
        system_prompt, body_messages = _split_system(messages, name_map)

        payload: Dict[str, Any] = {
            "model": model or self.model,
            "messages": body_messages,
            "max_tokens": max_tokens or DEFAULT_MAX_TOKENS,
            "tools": encoded_tools,
        }
        if system_prompt:
            payload["system"] = system_prompt
        if temperature is not None:
            payload["temperature"] = temperature

        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": ANTHROPIC_API_VERSION,
            "content-type": "application/json",
        }
        body = await self._do_post("/v1/messages", payload, headers)
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


def _split_system(
    messages: List[ChatMessage],
    name_map: Optional[Dict[str, str]] = None,
) -> Tuple[str, List[Dict[str, Any]]]:
    """Anthropic's API has no system role in the messages array.

    Concatenate every ``system`` message into a single top-level prompt,
    drop those entries from the body, and convert tool messages into
    Anthropic's tool_result block shape.

    For assistant messages following a tool call (carrying
    ``tool_call_id`` + ``name`` + ``tool_args``), emit a content
    array with a ``tool_use`` block. Anthropic requires the
    ``tool_use_id`` referenced by a later ``tool_result`` to resolve
    to a ``tool_use`` block in an earlier assistant message — without
    this, the API returns 400 on the follow-up turn after a tool call.

    ``name_map`` maps action-name → on-wire encoded tool name (built
    by ``_encode_tools``). The engine only knows the action name; the
    adapter translates here so the tool_use block uses the same wire
    name that originally went out in the request.
    """
    name_map = name_map or {}
    system_parts: List[str] = []
    body: List[Dict[str, Any]] = []
    for m in messages:
        if m.role == "system":
            if m.content:
                system_parts.append(m.content)
            continue
        if m.role == "tool":
            # role=tool → user-message with a tool_result content block.
            body.append({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": m.tool_call_id or "",
                    "content": m.content or "",
                }],
            })
            continue
        if m.role == "assistant" and m.tool_call_id and m.name:
            # Assistant emitted a tool call — reconstruct the
            # tool_use block. Anthropic threads the upcoming
            # tool_result via tool_use_id; without this block, the
            # API can't find the originating call.
            wire_name = name_map.get(m.name, m.name)
            content_blocks: List[Dict[str, Any]] = []
            if m.content:
                content_blocks.append({"type": "text", "text": m.content})
            content_blocks.append({
                "type": "tool_use",
                "id": m.tool_call_id,
                "name": wire_name,
                "input": m.tool_args or {},
            })
            body.append({"role": "assistant", "content": content_blocks})
            continue
        # user / assistant text pass through.
        body.append({"role": m.role, "content": m.content or ""})
    return ("\n\n".join(system_parts).strip(), body)


_VALID_TOOL_NAME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_-]{0,63}$")


def _encode_tools(
    tools: List[ToolDescriptor],
) -> Tuple[List[Dict[str, Any]], Dict[str, ToolDescriptor]]:
    """Brain tools → Anthropic tool definitions + reverse map.

    Tool names go on the wire as the action name itself when it
    matches Anthropic's regex + is unique within this tool list
    (matches what operators write in workflow prompts: "call
    write_memory"). Falls back to ``tool_NNN`` indexed names on
    collision or invalid action characters.

    Also returns a forward map (action_name → on-wire name) so the
    engine's assistant-message reconstruction
    (``_split_system`` tool_use block) can look up the right
    encoded name when threading the conversation back to Anthropic.
    """
    encoded: List[Dict[str, Any]] = []
    decode: Dict[str, ToolDescriptor] = {}
    used: set = set()
    for i, t in enumerate(tools):
        candidate = t.action if _VALID_TOOL_NAME_RE.match(t.action or "") else ""
        if not candidate or candidate in used:
            candidate = f"tool_{i:03d}"
        used.add(candidate)
        decode[candidate] = t
        encoded.append({
            "name": candidate,
            "description": (t.description or "").strip()[:1024]
                            + f"\n[topic: {t.topic}, action: {t.action}]",
            "input_schema": t.parameters or {"type": "object", "properties": {}},
        })
    return encoded, decode


def _parse_response(
    body: Dict[str, Any],
    decode: Dict[str, ToolDescriptor],
) -> ModelResponse:
    """Anthropic Messages response → ModelResponse.

    The ``content`` array can be a mix of text + tool_use blocks. We
    walk in order — first ``tool_use`` wins; if there's none, the
    concatenated text becomes the terminal ``done`` rationale.
    """
    content = body.get("content") or []
    usage_obj = body.get("usage") or {}
    usage = ModelUsage(
        input_tokens=int(usage_obj.get("input_tokens") or 0),
        output_tokens=int(usage_obj.get("output_tokens") or 0),
    )

    text_parts: List[str] = []
    for block in content:
        btype = block.get("type")
        if btype == "tool_use":
            flat_name = block.get("name") or ""
            args = block.get("input") or {}
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
                    args=args if isinstance(args, dict) else {},
                    rationale="\n".join(text_parts).strip(),
                    tool_call_id=block.get("id"),
                ),
                raw=body,
                usage=usage,
            )
        if btype == "text":
            t = block.get("text") or ""
            if t:
                text_parts.append(t)

    # No tool_use block — terminal done with whatever the model said.
    return ModelResponse(
        action=ProposedAction(
            kind="done",
            rationale="\n".join(text_parts).strip() or "no tool call, no content",
        ),
        raw=body,
        usage=usage,
    )
