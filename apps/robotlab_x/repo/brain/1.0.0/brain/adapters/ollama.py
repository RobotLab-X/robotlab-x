# unmanaged
"""OllamaAdapter — httpx → POST {base_url}/api/chat.

Ollama exposes an OpenAI-style chat API at ``/api/chat`` with tool-use
support: pass ``tools=[{type: function, function: {...}}]`` and the
model can respond with ``message.tool_calls[]``.

This adapter is the v1 production target — wired up by selecting
``model: ollama`` in workflow.yaml. Adapters are responsible for
mapping the brain's flat (``ChatMessage``, ``ToolDescriptor``) shape
to the provider's JSON, and for parsing the response into a
``ProposedAction``.

Pick a tool-capable model on the Ollama side — qwen2.5-coder,
llama3.1, granite3-dense, etc. — older models without tool support
will silently return text-only responses (which the adapter
converts to a terminal ``done`` action).
"""
from __future__ import annotations

import ast
import json
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


# Type alias for the injected POST hook used by tests. Returns the
# decoded JSON body of the response. Real production code uses
# ``httpx.AsyncClient.post``-style; tests inject a scripted callable.
PostFn = Callable[[str, Dict[str, Any]], Awaitable[Dict[str, Any]]]


class OllamaAdapter(ModelAdapter):
    """Ollama chat-with-tools adapter."""

    name = "ollama"

    def __init__(
        self,
        *,
        base_url: str = "http://localhost:11434",
        model: str = "llama3.1",
        post: Optional[PostFn] = None,
        timeout: float = 60.0,
        num_ctx: int = 8192,
    ):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        # Ollama's DEFAULT context window is only 2048 tokens. A workflow
        # with a big prompt + many tool schemas (e.g. inmoov: a servo map
        # + ~30 servo tools) blows past that, so Ollama silently TRUNCATES
        # the request — the model loses its tool definitions/instructions
        # and narrates instead of calling tools. Send an explicit, roomy
        # num_ctx so the whole request survives. Overridable via config.
        self.num_ctx = num_ctx
        # ``post`` injection lets tests skip httpx entirely. Production
        # path constructs its own client on first call (cheap) and
        # holds onto it for connection reuse.
        self._post = post
        self._client: Optional[httpx.AsyncClient] = None

    def encode_tools_for_log(self, tools):
        """Return the wire-format tools array — exactly what gets
        sent to Ollama's /api/chat in the ``tools`` field. The
        ``decode`` mapping isn't needed for log purposes."""
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
        # Encode tool names → flat IDs the provider accepts; remember
        # the reverse mapping for the response parse below.
        encoded_tools, decode = _encode_tools(tools or [])
        payload: Dict[str, Any] = {
            "model": model or self.model,
            "messages": [_encode_message(m) for m in messages],
            "stream": False,
            "tools": encoded_tools,
        }
        # Always pin num_ctx — without it Ollama defaults to 2048 and
        # truncates large tool-heavy requests (see __init__).
        options: Dict[str, Any] = {"num_ctx": int(self.num_ctx)}
        if max_tokens is not None:
            options["num_predict"] = max_tokens
        if temperature is not None:
            options["temperature"] = temperature
        payload["options"] = options

        body = await self._do_post("/api/chat", payload)
        return _parse_response(body, decode)

    # ─── internals ────────────────────────────────────────────────

    async def _do_post(self, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        url = f"{self.base_url}{path}"
        if self._post is not None:
            return await self._post(url, payload)
        client = await self._get_client()
        resp = await client.post(url, json=payload, timeout=self.timeout)
        if resp.status_code >= 400:
            # Surface Ollama's OWN error body instead of a bare
            # HTTPStatusError — far more actionable. The classic case is
            # a 404 whose body is {"error":"model 'x' not found"} when
            # the requested tag isn't pulled on the server.
            try:
                detail = str((resp.json() or {}).get("error") or "").strip()
            except Exception:  # noqa: BLE001 — body wasn't JSON
                detail = (resp.text or "").strip()
            _raise_for_ollama_error(resp.status_code, detail, payload.get("model"), self.base_url)
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


def _raise_for_ollama_error(status_code: int, detail: str, model: Any, base_url: str) -> None:
    """Translate an Ollama HTTP error into an actionable RuntimeError.

    ``detail`` is Ollama's own error string (from the JSON body) or raw
    text. The common operator mistake is pointing a configuration at a
    model tag that isn't pulled on the server — Ollama answers
    ``404 {"error": "model 'x' not found"}`` even though the server
    itself is healthy. Name the model + host so the fix is obvious."""
    if status_code < 400:
        return
    if status_code == 404 and ("not found" in detail.lower() or not detail):
        raise RuntimeError(
            f"Ollama at {base_url} has no model {model!r} "
            f"({detail or 'model not found'}). Pull it on that host "
            f"(`ollama pull {model}`) or pick an installed model."
        )
    raise RuntimeError(
        f"Ollama request failed: HTTP {status_code}"
        + (f" — {detail}" if detail else "")
    )


def _iter_json_objects(text: str) -> List[str]:
    """Return every brace-balanced ``{...}`` substring of ``text``, in
    order. String-aware so braces inside quoted values don't confuse the
    depth counter. Used to find tool-call objects a model narrated as
    prose (possibly fenced / surrounded by explanation)."""
    objs: List[str] = []
    depth = 0
    start: Optional[int] = None
    in_str = False
    esc = False
    for i, ch in enumerate(text):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}" and depth > 0:
            depth -= 1
            if depth == 0 and start is not None:
                objs.append(text[start:i + 1])
                start = None
    return objs


def _lenient_json(blob: str) -> Optional[Any]:
    """Parse ``blob`` as JSON, tolerating the Python literals models
    often emit (``None``/``True``/``False``). Returns None on failure."""
    try:
        return json.loads(blob)
    except Exception:  # noqa: BLE001
        fixed = re.sub(r"\bNone\b", "null", blob)
        fixed = re.sub(r"\bTrue\b", "true", fixed)
        fixed = re.sub(r"\bFalse\b", "false", fixed)
        try:
            return json.loads(fixed)
        except Exception:  # noqa: BLE001
            return None


def _salvage_python_call(
    content: str,
    decode: Dict[str, ToolDescriptor],
) -> Optional[ProposedAction]:
    """Recover a tool call written in llama 3.1's native function-call
    syntax — e.g. ``<|python_tag|>speak(text="Hello!")`` — which Ollama
    sometimes passes through as content instead of parsing into a
    structured tool_call. Strips llama special tokens (``<|...|>``),
    finds the first ``name(...)`` whose name is an offered tool, and
    evaluates its keyword args as Python literals. Returns None on no
    match / non-literal args."""
    if not content:
        return None
    text = re.sub(r"<\|[^|>]*\|>", " ", content)  # drop <|python_tag|> etc.
    for m in re.finditer(r"([A-Za-z_]\w*)\s*\(", text):
        name = m.group(1)
        if name not in decode:
            continue
        # Balanced-paren match from the '(' so quoted parens don't fool us.
        depth = 0
        in_str = False
        esc = False
        quote = ""
        open_paren = m.end() - 1
        for j in range(open_paren, len(text)):
            ch = text[j]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == quote:
                    in_str = False
                continue
            if ch in "\"'":
                in_str = True
                quote = ch
            elif ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    args = _eval_call_kwargs(text[m.start():j + 1])
                    if args is not None:
                        desc = decode[name]
                        return ProposedAction(
                            kind="tool", topic=desc.topic,
                            action=desc.action, args=args,
                        )
                    break  # parsed the call but args weren't literal — try next
    return None


def _eval_call_kwargs(call_src: str) -> Optional[Dict[str, Any]]:
    """``name(text="hi", n=3)`` → ``{"text": "hi", "n": 3}`` via ast.
    Returns None if it isn't a literal-kwargs call."""
    try:
        node = ast.parse(call_src.strip(), mode="eval").body
    except SyntaxError:
        return None
    if not isinstance(node, ast.Call):
        return None
    args: Dict[str, Any] = {}
    for kw in node.keywords:
        if kw.arg is None:  # **kwargs splat — can't recover
            return None
        try:
            args[kw.arg] = ast.literal_eval(kw.value)
        except (ValueError, SyntaxError):
            return None
    return args


def _salvage_text_tool_call(
    content: str,
    decode: Dict[str, ToolDescriptor],
) -> Optional[ProposedAction]:
    """Recover a tool call a model wrote as prose instead of emitting a
    structured tool_call. Tries two shapes, in order, and returns the
    FIRST match whose name is one of THIS run's offered tools (in
    ``decode``):

      1. JSON object — ``{"name": <tool>, "parameters"|"arguments": {…}}``
         OR ``{"action": <tool>, ...args}`` (qwen3 emits this shape).
      2. llama 3.1 function-call — ``<|python_tag|>speak(text="…")``

    Returns None when nothing usable is found — the caller then falls
    back to treating the text as a terminal ``done``."""
    if not content:
        return None
    for blob in _iter_json_objects(content):
        if '"name"' not in blob and '"action"' not in blob:
            continue
        obj = _lenient_json(blob)
        if not isinstance(obj, dict):
            continue
        # Tool name may be under "name" (OpenAI-ish) or "action" (qwen3 /
        # the brain's own bus-message shape).
        name = obj.get("name")
        if not isinstance(name, str) or name not in decode:
            name = obj.get("action")
        if not isinstance(name, str) or name not in decode:
            continue
        args = obj.get("parameters")
        if not isinstance(args, dict):
            args = obj.get("arguments") if isinstance(obj.get("arguments"), dict) else None
        if args is None:
            # No explicit args object — treat the remaining keys as args
            # (the {"action": "write", "angle": 150} shape).
            args = {k: v for k, v in obj.items() if k not in ("name", "action")}
        desc = decode[name]
        return ProposedAction(
            kind="tool",
            topic=desc.topic,
            action=desc.action,
            args=args or {},
        )
    return _salvage_python_call(content, decode)


def _encode_message(m: ChatMessage) -> Dict[str, Any]:
    """Brain ChatMessage → Ollama message dict.

    Tool messages carry the tool name + a content payload; the
    assistant role's content can be empty when only a tool call was
    emitted. We pass them through as-is — Ollama is OpenAI-compatible
    for the common subset.
    """
    out: Dict[str, Any] = {"role": m.role, "content": m.content or ""}
    # Reconstruct the assistant's tool call so the model SEES it already
    # invoked the tool this turn. Without this, the assistant turn goes
    # back to Ollama as a blank message and the model RE-EMITS the same
    # call — observed with qwen3 speaking the identical line twice before
    # moving on. Mirrors what the anthropic/openai adapters do from
    # ``tool_args`` (ChatMessage carries name + tool_args for exactly
    # this). The tool RESULT message (role="tool") keeps its ``name``.
    if m.role == "assistant" and m.name and m.tool_args is not None:
        out["tool_calls"] = [{"function": {"name": m.name, "arguments": m.tool_args}}]
    elif m.name:
        out["name"] = m.name
    if m.tool_call_id:
        out["tool_call_id"] = m.tool_call_id
    return out


_VALID_TOOL_NAME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_-]{0,63}$")


def _encode_tools(
    tools: List[ToolDescriptor],
) -> Tuple[List[Dict[str, Any]], Dict[str, ToolDescriptor]]:
    """Flatten the brain's ``<topic>::<action>`` names into provider-
    safe identifiers + return the reverse map for response parsing.

    Function-calling APIs (Ollama, OpenAI, Anthropic) constrain tool
    names to ``^[a-zA-Z0-9_-]{1,64}$`` — slashes + ``::`` aren't
    allowed. Strategy: use the bare action name when it's already
    valid + unique among this tool list (matches what operators write
    in workflow prompts: "call write_memory"). Fall back to indexed
    ``tool_NNN`` for collisions or invalid names. The provider only
    sees the encoded names; descriptions still carry the canonical
    topic + action for the model to read.
    """
    encoded: List[Dict[str, Any]] = []
    decode: Dict[str, ToolDescriptor] = {}
    used_names: set = set()
    for i, t in enumerate(tools):
        candidate = t.action if _VALID_TOOL_NAME_RE.match(t.action or "") else ""
        if not candidate or candidate in used_names:
            candidate = f"tool_{i:03d}"
        used_names.add(candidate)
        decode[candidate] = t
        encoded.append({
            "type": "function",
            "function": {
                "name": candidate,
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
    """Ollama JSON response → brain ModelResponse.

    Tool calls appear at ``message.tool_calls[]`` per the Ollama spec.
    The arguments come as a parsed dict (not a JSON-encoded string —
    that's an OpenAI quirk).
    """
    message = body.get("message") or {}
    tool_calls = message.get("tool_calls") or []
    usage = ModelUsage(
        input_tokens=int(body.get("prompt_eval_count") or 0),
        output_tokens=int(body.get("eval_count") or 0),
    )

    if not tool_calls:
        # Some models (notably llama3.1 via Ollama) don't emit a
        # structured tool_call — they NARRATE it as text, often fenced:
        #     ```{"name": "listen", "parameters": {"timeout_seconds": 10}}```
        # That would parse as a no-op ``done``, ending the workflow with
        # 0 tool calls. Before giving up, try to salvage a real tool call
        # from the prose: a JSON-ish object naming one of THIS run's
        # offered tools. This makes the brain usable with models that are
        # weaker at the structured tool-call protocol.
        salvaged = _salvage_text_tool_call(message.get("content") or "", decode)
        if salvaged is not None:
            logger.warning(
                "ollama: model narrated a tool call as text instead of "
                "emitting a structured tool_call — salvaged %s::%s",
                salvaged.topic, salvaged.action,
            )
            return ModelResponse(action=salvaged, raw=body, usage=usage)
        # Plain text response — treat as terminal ``done`` with the
        # assistant's prose as rationale. The workflow ends gracefully.
        return ModelResponse(
            action=ProposedAction(
                kind="done",
                rationale=(message.get("content") or "").strip() or "no tool call, no content",
            ),
            raw=body,
            usage=usage,
        )

    # Take the first tool call. v1 is one tool call per step — chains
    # via the model's subsequent turns. Multi-call-per-step is a
    # future extension.
    call = tool_calls[0]
    fn = call.get("function") or {}
    flat_name = fn.get("name") or ""
    args = fn.get("arguments") or {}
    if isinstance(args, str):
        # Some Ollama builds (or future ones aligning with OpenAI) may
        # pass arguments as a JSON-encoded string. Be defensive.
        import json as _json
        try:
            args = _json.loads(args)
        except Exception:
            args = {}

    descriptor = decode.get(flat_name)
    if descriptor is None:
        # Model hallucinated a name we didn't advertise. Treat as done
        # so the brain doesn't try to dispatch to a non-existent tool.
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
            rationale=(message.get("content") or "").strip(),
        ),
        raw=body,
        usage=usage,
    )
