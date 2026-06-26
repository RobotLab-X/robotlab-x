# unmanaged
"""OllamaAdapter tests — v1 milestone 2.

The adapter's only dependency on the outside world is the httpx POST.
Tests inject a scripted ``post`` callable that returns Ollama JSON
verbatim, so the full round-trip from ChatMessage → wire request →
fake provider → ModelResponse is exercised without any network.

The headline test (``test_observe_room_via_ollama``) is the same
observe_room scenario from ``test_brain.py`` — running it again with
OllamaAdapter proves the adapter is a drop-in replacement for
MockAdapter (which is the v1 success criterion for milestone 2).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List

import pytest

_BRAIN_PKG = Path(__file__).resolve().parents[1] / "repo" / "brain" / "1.0.0"
sys.path.insert(0, str(_BRAIN_PKG))

from brain.adapters.ollama import (  # noqa: E402
    OllamaAdapter, _encode_message, _encode_tools, _parse_response,
    _raise_for_ollama_error, _salvage_text_tool_call,
)
from brain.context_loader import load_workflow  # noqa: E402
from brain.memory import read_memory  # noqa: E402
from brain.schemas import (  # noqa: E402
    ChatMessage,
    ToolDescriptor,
    ToolResult,
    Workflow,
)
from brain.workflow_engine import WorkflowEngine  # noqa: E402


# ─── fixtures ───────────────────────────────────────────────────────


@pytest.fixture
def workspace(tmp_path):
    ws = tmp_path / "ws"
    (ws / "memory").mkdir(parents=True)
    (ws / "runs").mkdir()
    return ws


@pytest.fixture
def tool_catalog():
    return {
        f"{t.topic}::{t.action}": t
        for t in [
            ToolDescriptor(
                topic="/video/video-1/control",
                action="capture_frame",
                description="Capture frame",
                parameters={"type": "object", "properties": {"camera": {"type": "integer"}}},
            ),
            ToolDescriptor(
                topic="/video/video-1/control",
                action="detect_objects",
                description="Detect objects",
                parameters={"type": "object", "properties": {"frame_id": {"type": "string"}}, "required": ["frame_id"]},
            ),
            ToolDescriptor(
                topic="/speech/speech-1/control",
                action="speak",
                description="Speak text",
                parameters={"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
            ),
            ToolDescriptor(
                topic="/brain/brain-1/control",
                action="write_memory",
                description="Save observation",
                parameters={
                    "type": "object",
                    "properties": {"kind": {"type": "string"}, "content": {"type": "string"}},
                    "required": ["kind", "content"],
                },
            ),
        ]
    }


def _bundled_observe_room() -> Workflow:
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        return load_workflow("observe_room", Path(td))


# ─── unit tests on encode/parse ─────────────────────────────────────


def test_encode_tools_uses_action_name_when_unique():
    """Tools encode under their action name when it matches the
    provider regex + doesn't collide. Models see the human name in
    the prompt ("call write_memory") and now match it directly."""
    tools = [
        ToolDescriptor(topic="/video/video-1/control", action="capture_frame"),
        ToolDescriptor(topic="/brain/brain-1/control", action="write_memory"),
    ]
    encoded, decode = _encode_tools(tools)
    assert encoded[0]["function"]["name"] == "capture_frame"
    assert encoded[1]["function"]["name"] == "write_memory"
    assert decode["capture_frame"].topic == "/video/video-1/control"
    assert decode["write_memory"].action == "write_memory"


def test_encode_tools_falls_back_to_indexed_on_collision():
    """When two tools share the same action name (same method on two
    proxies), the second one falls back to the indexed ``tool_NNN``
    form so neither collides in the provider's name registry."""
    tools = [
        ToolDescriptor(topic="/video/video-1/control", action="capture_frame"),
        ToolDescriptor(topic="/video/video-2/control", action="capture_frame"),
    ]
    encoded, decode = _encode_tools(tools)
    assert encoded[0]["function"]["name"] == "capture_frame"
    assert encoded[1]["function"]["name"] == "tool_001"
    assert decode["capture_frame"].topic == "/video/video-1/control"
    assert decode["tool_001"].topic == "/video/video-2/control"
    # Description carries the original topic/action so a human staring
    # at the wire is unconfused.
    assert "/video/video-1/control" in encoded[0]["function"]["description"]


def test_parse_response_tool_call():
    """Standard Ollama response with one tool call → ProposedAction(tool)."""
    decode = {"tool_000": ToolDescriptor(topic="/x/x-1/control", action="do_it")}
    body = {
        "message": {
            "role": "assistant",
            "content": "",
            "tool_calls": [{"function": {"name": "tool_000", "arguments": {"k": "v"}}}],
        },
        "done": True,
        "prompt_eval_count": 42,
        "eval_count": 17,
    }
    resp = _parse_response(body, decode)
    assert resp.action.kind == "tool"
    assert resp.action.topic == "/x/x-1/control"
    assert resp.action.action == "do_it"
    assert resp.action.args == {"k": "v"}
    assert resp.usage.input_tokens == 42
    assert resp.usage.output_tokens == 17


def test_parse_response_text_only_becomes_done():
    """No tool_calls → terminal ``done`` with the assistant's content."""
    body = {"message": {"role": "assistant", "content": "all good"}, "done": True}
    resp = _parse_response(body, {})
    assert resp.action.kind == "done"
    assert resp.action.rationale == "all good"


def test_parse_response_unknown_tool_becomes_done():
    """Model hallucinated a name we didn't advertise — fall through to
    done so the brain doesn't try to dispatch to a phantom tool."""
    body = {
        "message": {"tool_calls": [{"function": {"name": "tool_999", "arguments": {}}}]},
        "done": True,
    }
    resp = _parse_response(body, {"tool_000": ToolDescriptor(topic="/a/a-1/control", action="x")})
    assert resp.action.kind == "done"
    assert "unknown tool" in resp.action.rationale


def test_parse_response_string_arguments_decoded():
    """Defensive: some OpenAI-compatible servers stringify arguments."""
    decode = {"tool_000": ToolDescriptor(topic="/x/x-1/control", action="do_it")}
    body = {
        "message": {
            "tool_calls": [{"function": {"name": "tool_000", "arguments": json.dumps({"k": "v"})}}],
        },
    }
    resp = _parse_response(body, decode)
    assert resp.action.args == {"k": "v"}


# ─── round-trip through the adapter's HTTP layer ────────────────────


@pytest.mark.asyncio
async def test_adapter_posts_to_chat_endpoint():
    """The adapter targets /api/chat with the model + messages + tools
    payload, and parses the JSON response back into a ModelResponse."""
    calls: List[Dict[str, Any]] = []

    async def fake_post(url: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        calls.append({"url": url, "payload": payload})
        return {
            "message": {
                "role": "assistant",
                "content": "",
                "tool_calls": [{"function": {"name": "do_it", "arguments": {"x": 1}}}],
            },
            "prompt_eval_count": 10,
            "eval_count": 5,
        }

    adapter = OllamaAdapter(base_url="http://o:11434", model="llama3.1", post=fake_post)
    resp = await adapter.complete(
        messages=[ChatMessage(role="user", content="hi")],
        tools=[ToolDescriptor(topic="/x/x-1/control", action="do_it")],
    )

    assert len(calls) == 1
    assert calls[0]["url"] == "http://o:11434/api/chat"
    assert calls[0]["payload"]["model"] == "llama3.1"
    assert calls[0]["payload"]["stream"] is False
    # Tools now encode under the action name when valid + unique.
    assert calls[0]["payload"]["tools"][0]["function"]["name"] == "do_it"

    assert resp.action.kind == "tool"
    assert resp.action.topic == "/x/x-1/control"
    assert resp.action.action == "do_it"
    assert resp.action.args == {"x": 1}
    assert resp.usage.input_tokens == 10


# ─── headline observe_room test, run via OllamaAdapter ──────────────


@pytest.mark.asyncio
async def test_observe_room_via_ollama(workspace, tool_catalog):
    """Same workflow as test_brain.test_observe_room, but the model
    side is OllamaAdapter wired to a scripted fake_post.

    This is the v1 milestone 2 success criterion: the engine is
    adapter-agnostic — swapping MockAdapter for OllamaAdapter
    (against a fake provider) gives an identical run."""
    wf = _bundled_observe_room()

    # Map (topic, action) → which indexed tool name the adapter will
    # send. The brain's allowed_tool_descriptors() filters the catalog
    # to the workflow's allowed set BEFORE handing to the adapter,
    # which then assigns tool_000..tool_N. We have 4 allowed
    # descriptors in observe_room — order is determined by the
    # adapter's _encode_tools, which preserves the input order.
    #
    # The engine builds the filtered list by iterating tool_catalog
    # values, so we have to know the iteration order. Build it
    # explicitly here to be deterministic.

    # The 4 (topic, action) pairs the workflow allows:
    expected_order_pairs = [
        ("/video/video-1/control", "capture_frame"),
        ("/video/video-1/control", "detect_objects"),
        ("/speech/speech-1/control", "speak"),
        ("/brain/brain-1/control", "write_memory"),
    ]
    # CPython 3.7+ dict preserves insertion order. Our tool_catalog
    # fixture inserts these in this same order, so the engine's
    # filtered list will too.

    # Scripted Ollama responses — one per call. _encode_tools now
    # uses action names directly when they're unique. The four allowed
    # actions in this workflow (capture_frame, detect_objects, speak,
    # write_memory) are all unique → each encodes under its action name.
    responses = [
        # step 0: capture_frame
        {"message": {"tool_calls": [{"function": {"name": "capture_frame", "arguments": {"camera": 0}}}]},
         "prompt_eval_count": 100, "eval_count": 20},
        # step 1: detect_objects
        {"message": {"tool_calls": [{"function": {"name": "detect_objects", "arguments": {"frame_id": "f-001"}}}]},
         "prompt_eval_count": 120, "eval_count": 25},
        # step 2: speak
        {"message": {"tool_calls": [{"function": {"name": "speak", "arguments": {"text": "Saw a red cube."}}}]},
         "prompt_eval_count": 140, "eval_count": 22},
        # step 3: write_memory
        {"message": {"tool_calls": [{"function": {"name": "write_memory", "arguments": {"kind": "observations", "content": "Saw a red cube."}}}]},
         "prompt_eval_count": 160, "eval_count": 18},
        # step 4: done
        {"message": {"role": "assistant", "content": "Room observed."},
         "prompt_eval_count": 180, "eval_count": 8},
    ]
    call_count = {"n": 0}

    async def fake_post(url: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        assert url.endswith("/api/chat"), url
        assert "tools" in payload
        i = call_count["n"]
        call_count["n"] += 1
        if i >= len(responses):
            raise AssertionError(f"unexpected {i + 1}th call — script has only {len(responses)} responses")
        return responses[i]

    adapter = OllamaAdapter(base_url="http://ollama", model="llama3.1", post=fake_post)

    # Stub tool_caller — identical to test_brain's
    tool_responses = {
        ("/video/video-1/control", "capture_frame"): {"frame_id": "f-001"},
        ("/video/video-1/control", "detect_objects"): {"objects": [{"label": "cube"}]},
        ("/speech/speech-1/control", "speak"): {"spoken": True},
        ("/brain/brain-1/control", "write_memory"): {"written": True},
    }

    async def fake_tool_caller(topic: str, action: str, args):
        if topic.startswith("/brain/") and action == "write_memory":
            from brain.memory import write_observation
            write_observation(workspace, args["kind"], args["content"])
        value = tool_responses.get((topic, action))
        assert value is not None, f"unexpected tool call: {topic}::{action}"
        return ToolResult(status="ok", value=value, duration_ms=5)

    engine = WorkflowEngine(
        workflow=wf,
        workspace_dir=workspace,
        adapter=adapter,
        tool_caller=fake_tool_caller,
        publish=lambda *a, **kw: None,
        bus_prefix="/brain/brain-1",
        tool_catalog=tool_catalog,
    )
    record = await engine.run()

    assert record.status == "success", record.failure_reason
    assert record.steps_used == 5
    # Token accounting from the adapter rolls up into the record.
    assert record.tokens_used == sum(r["prompt_eval_count"] + r["eval_count"] for r in responses), \
        f"tokens_used={record.tokens_used}"

    # Memory got the observation
    assert "Saw a red cube." in read_memory(workspace, "observations")

    # All 5 Ollama calls happened.
    assert call_count["n"] == 5


# ─── error translation (regression) ───────────────────────────────────
#
# When a configuration points at a model tag that isn't pulled on the
# Ollama host, Ollama returns 404 {"error":"model 'x' not found"} even
# though the server itself is healthy. The adapter must surface that as
# an actionable message naming the model + host — not a bare
# HTTPStatusError 404 (which is what the operator saw before).


def test_raise_for_ollama_error_model_not_found_names_model():
    with pytest.raises(RuntimeError) as ei:
        _raise_for_ollama_error(404, "model 'llama3.1:8b' not found",
                                "llama3.1:8b", "http://cerebellum.local:11434")
    msg = str(ei.value)
    assert "llama3.1:8b" in msg
    assert "cerebellum.local:11434" in msg
    assert "pull" in msg.lower()


def test_raise_for_ollama_error_bare_404_still_helpful():
    # Even with no body, a 404 on /api/chat means "model missing".
    with pytest.raises(RuntimeError) as ei:
        _raise_for_ollama_error(404, "", "mystery:1b", "http://o:11434")
    assert "mystery:1b" in str(ei.value)


def test_raise_for_ollama_error_other_status_surfaces_detail():
    with pytest.raises(RuntimeError) as ei:
        _raise_for_ollama_error(500, "internal boom", "llama3.1", "http://o:11434")
    msg = str(ei.value)
    assert "500" in msg and "internal boom" in msg


def test_raise_for_ollama_error_noop_on_success():
    # 2xx must not raise.
    _raise_for_ollama_error(200, "", "llama3.1", "http://o:11434")


# ─── text-narrated tool-call salvage (regression) ─────────────────────
#
# llama3.1 (and similar) often NARRATE a tool call as prose/fenced JSON
# instead of emitting a structured tool_call. Without salvage the
# adapter parsed it as a no-op ``done`` → workflow "success, 0 tool
# calls". These lock the recovery using the exact strings observed from
# brain_test_2 runs.

_DECODE = {"listen": ToolDescriptor(topic="/chat/chat-1/control", action="listen"),
           "speak": ToolDescriptor(topic="/chat/chat-1/control", action="speak")}


def test_salvage_fenced_tool_call_with_python_none():
    # Verbatim shape from the failing run (note Python ``None``).
    content = (
        "To start the loop I will first call the `listen` action.\n"
        '```\n{"name": "listen", "parameters": {"timeout_seconds": 30, "bearing": None}}\n```'
    )
    action = _salvage_text_tool_call(content, _DECODE)
    assert action is not None
    assert action.kind == "tool"
    assert action.topic == "/chat/chat-1/control"
    assert action.action == "listen"
    assert action.args == {"timeout_seconds": 30, "bearing": None}


def test_salvage_takes_first_offered_tool_when_multiple_narrated():
    content = (
        '{"name": "listen", "parameters": {"timeout_seconds": 10, "bearing": None}} '
        '{"name": "speak", "parameters": {"text": "Hello!"}}'
    )
    action = _salvage_text_tool_call(content, _DECODE)
    assert action.action == "listen"  # first one wins; engine is one-call-per-step


def test_salvage_accepts_arguments_key_too():
    action = _salvage_text_tool_call('{"name": "speak", "arguments": {"text": "hi"}}', _DECODE)
    assert action.action == "speak"
    assert action.args == {"text": "hi"}


def test_salvage_ignores_unoffered_tool_name():
    # A name we never advertised must NOT be salvaged (no phantom calls).
    assert _salvage_text_tool_call('{"name": "drive", "parameters": {"speed": 1}}', _DECODE) is None


def test_salvage_returns_none_for_plain_prose():
    assert _salvage_text_tool_call("Sure, I can help with that!", _DECODE) is None


def test_parse_response_salvages_narrated_call_instead_of_done():
    # End-to-end through _parse_response: a content-only message that
    # narrates a known tool becomes a tool action, not a done.
    body = {"message": {"role": "assistant",
                        "content": '```{"name": "listen", "parameters": {"timeout_seconds": 8}}```'}}
    resp = _parse_response(body, _DECODE)
    assert resp.action.kind == "tool"
    assert resp.action.action == "listen"


def test_parse_response_still_done_when_no_salvageable_call():
    body = {"message": {"role": "assistant", "content": "All finished, goodbye!"}}
    resp = _parse_response(body, _DECODE)
    assert resp.action.kind == "done"


# ─── llama 3.1 <|python_tag|> function-call salvage (regression) ──────
#
# llama 3.1 emits tool calls in TWO non-structured ways via Ollama:
# JSON (covered above) AND its native ``<|python_tag|>name(kwargs)``
# function-call syntax. Verbatim shape from a brain_test_2 run:
#   done — <|python_tag|>speak(text="Hello! It's nice to meet you.")


def test_salvage_python_tag_speak_call():
    content = '<|python_tag|>speak(text="Hello! It\'s nice to meet you.")'
    action = _salvage_text_tool_call(content, _DECODE)
    assert action is not None
    assert action.kind == "tool"
    assert action.topic == "/chat/chat-1/control"
    assert action.action == "speak"
    assert action.args == {"text": "Hello! It's nice to meet you."}


def test_salvage_python_call_without_tag_and_numeric_arg():
    action = _salvage_text_tool_call('listen(timeout_seconds=10)', _DECODE)
    assert action.action == "listen"
    assert action.args == {"timeout_seconds": 10}


def test_salvage_python_call_ignores_unoffered_name():
    assert _salvage_text_tool_call('<|python_tag|>drive(speed=1.0)', _DECODE) is None


def test_salvage_python_call_skips_unknown_then_takes_known():
    # An unknown call followed by a real one — the offered tool wins.
    content = 'think(about="stuff") then <|python_tag|>speak(text="hi")'
    action = _salvage_text_tool_call(content, _DECODE)
    assert action.action == "speak"
    assert action.args == {"text": "hi"}


def test_salvage_python_call_non_literal_args_returns_none():
    # Non-literal kwarg (a bare name) can't be recovered safely.
    assert _salvage_text_tool_call('speak(text=some_variable)', _DECODE) is None


def test_parse_response_salvages_python_tag_call():
    body = {"message": {"role": "assistant",
                        "content": '<|python_tag|>listen(timeout_seconds=8)'}}
    resp = _parse_response(body, _DECODE)
    assert resp.action.kind == "tool"
    assert resp.action.action == "listen"
    assert resp.action.args == {"timeout_seconds": 8}


# ─── assistant tool-call is threaded back (regression) ────────────────
#
# If the assistant's prior tool call isn't reconstructed in the history
# sent to Ollama, the model can't see it already acted and RE-EMITS the
# same call — observed: qwen3 speaking the identical line twice before
# continuing (duplicate replies). _encode_message must rebuild tool_calls
# from name + tool_args.


def test_encode_message_reconstructs_assistant_tool_call():
    from brain.schemas import ChatMessage
    m = ChatMessage(role="assistant", content="", name="speak",
                    tool_call_id="tc-1", tool_args={"text": "hi"})
    enc = _encode_message(m)
    assert enc["role"] == "assistant"
    assert enc["tool_calls"] == [{"function": {"name": "speak", "arguments": {"text": "hi"}}}]


def test_encode_message_tool_result_has_no_tool_calls():
    from brain.schemas import ChatMessage
    m = ChatMessage(role="tool", content="OK", name="/chat/chat-1/control::speak",
                    tool_call_id="tc-1")
    enc = _encode_message(m)
    assert enc["role"] == "tool"
    assert "tool_calls" not in enc
    assert enc["content"] == "OK"
    assert enc["name"] == "/chat/chat-1/control::speak"


def test_encode_message_plain_user_untouched():
    from brain.schemas import ChatMessage
    enc = _encode_message(ChatMessage(role="user", content="hello"))
    assert enc == {"role": "user", "content": "hello"}


# ─── num_ctx + {"action": ...} salvage (regression) ───────────────────


@pytest.mark.asyncio
async def test_adapter_sends_num_ctx():
    """Ollama defaults to 2048-token context and truncates large
    tool-heavy requests; the adapter must pin num_ctx."""
    captured = {}
    async def fake_post(url, payload):
        captured.update(payload)
        return {"message": {"role": "assistant", "content": "hi"}}
    a = OllamaAdapter(base_url="http://o:11434", model="qwen3:8b", post=fake_post, num_ctx=8192)
    from brain.schemas import ChatMessage
    await a.complete([ChatMessage(role="user", content="x")])
    assert captured["options"]["num_ctx"] == 8192


def test_salvage_action_shape():
    """qwen3 narrates tool calls as {"action": "listen"} (no "name")."""
    a = _salvage_text_tool_call('```json\n{ "action": "listen" }\n```', _DECODE)
    assert a is not None and a.action == "listen"


def test_salvage_action_shape_with_inline_args():
    a = _salvage_text_tool_call('{"action": "speak", "text": "hello"}', _DECODE)
    assert a.action == "speak"
    assert a.args == {"text": "hello"}


def test_salvage_action_unoffered_ignored():
    assert _salvage_text_tool_call('{"action": "explode"}', _DECODE) is None
