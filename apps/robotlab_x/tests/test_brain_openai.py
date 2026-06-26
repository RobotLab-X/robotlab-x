# unmanaged
"""OpenAIAdapter tests — v2 milestone, second half.

Same observe_room scenario as Mock / Ollama / Anthropic. With four
adapters all running the same workflow against the same engine,
adapter parity is now an enforceable property.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List

import pytest

_BRAIN_PKG = Path(__file__).resolve().parents[1] / "repo" / "brain" / "1.0.0"
sys.path.insert(0, str(_BRAIN_PKG))

from brain.adapters.openai import (  # noqa: E402
    OpenAIAdapter,
    _encode_message,
    _encode_tools,
    _parse_response,
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
            ToolDescriptor(topic="/video/video-1/control", action="capture_frame",
                           description="Capture frame",
                           parameters={"type": "object", "properties": {"camera": {"type": "integer"}}}),
            ToolDescriptor(topic="/video/video-1/control", action="detect_objects",
                           description="Detect objects",
                           parameters={"type": "object", "properties": {"frame_id": {"type": "string"}}, "required": ["frame_id"]}),
            ToolDescriptor(topic="/speech/speech-1/control", action="speak",
                           description="Speak text",
                           parameters={"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}),
            ToolDescriptor(topic="/brain/brain-1/control", action="write_memory",
                           description="Save observation",
                           parameters={"type": "object",
                                       "properties": {"kind": {"type": "string"}, "content": {"type": "string"}},
                                       "required": ["kind", "content"]}),
        ]
    }


def _bundled_observe_room() -> Workflow:
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        return load_workflow("observe_room", Path(td))


# ─── unit tests ─────────────────────────────────────────────────────


def test_encode_message_carries_tool_call_id():
    """role=tool messages must round-trip tool_call_id back to OpenAI
    so the API can link the result to its call."""
    m = ChatMessage(role="tool", content="result", tool_call_id="call_abc", name="tool_000")
    out = _encode_message(m)
    assert out == {"role": "tool", "content": "result", "name": "tool_000", "tool_call_id": "call_abc"}


def test_encode_tools_openai_function_shape():
    """OpenAI uses {type: function, function: {name, description, parameters}}."""
    tools = [ToolDescriptor(topic="/x/x-1/control", action="do_it",
                            parameters={"type": "object", "properties": {"k": {"type": "string"}}})]
    encoded, decode = _encode_tools(tools)
    assert encoded[0]["type"] == "function"
    fn = encoded[0]["function"]
    assert fn["name"] == "tool_000"
    assert fn["parameters"]["properties"]["k"]["type"] == "string"
    assert decode["tool_000"].topic == "/x/x-1/control"


def test_parse_response_tool_call_with_string_arguments():
    """The defining quirk of OpenAI's response: arguments is a
    JSON-encoded STRING that has to be parsed."""
    decode = {"tool_000": ToolDescriptor(topic="/x/x-1/control", action="do_it")}
    body = {
        "choices": [{
            "message": {
                "role": "assistant",
                "content": None,
                "tool_calls": [{
                    "id": "call_abc",
                    "type": "function",
                    "function": {"name": "tool_000", "arguments": json.dumps({"k": "v", "n": 7})},
                }],
            },
        }],
        "usage": {"prompt_tokens": 50, "completion_tokens": 10},
    }
    resp = _parse_response(body, decode)
    assert resp.action.kind == "tool"
    assert resp.action.args == {"k": "v", "n": 7}
    assert resp.action.tool_call_id == "call_abc"
    assert resp.usage.input_tokens == 50
    assert resp.usage.output_tokens == 10


def test_parse_response_text_only_becomes_done():
    body = {
        "choices": [{"message": {"content": "all done", "role": "assistant"}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 3},
    }
    resp = _parse_response(body, {})
    assert resp.action.kind == "done"
    assert resp.action.rationale == "all done"


def test_parse_response_malformed_arguments_string_becomes_empty_dict():
    """Defensive: an unparseable arguments string shouldn't crash the engine."""
    decode = {"tool_000": ToolDescriptor(topic="/x/x-1/control", action="do_it")}
    body = {
        "choices": [{"message": {"tool_calls": [{
            "id": "call_x", "type": "function",
            "function": {"name": "tool_000", "arguments": "not valid json {"},
        }]}}],
    }
    resp = _parse_response(body, decode)
    assert resp.action.kind == "tool"
    assert resp.action.args == {}


def test_parse_response_unknown_tool_name_becomes_done():
    body = {
        "choices": [{"message": {"tool_calls": [{
            "id": "call_x", "type": "function",
            "function": {"name": "tool_999", "arguments": "{}"},
        }]}}],
    }
    resp = _parse_response(body, {})
    assert resp.action.kind == "done"
    assert "unknown tool" in resp.action.rationale


# ─── adapter wire round-trip ────────────────────────────────────────


@pytest.mark.asyncio
async def test_adapter_posts_to_chat_completions():
    captured: List[Dict[str, Any]] = []

    async def fake_post(url: str, payload: Dict[str, Any], headers: Dict[str, str]) -> Dict[str, Any]:
        captured.append({"url": url, "payload": payload, "headers": headers})
        return {
            "choices": [{"message": {
                "tool_calls": [{
                    "id": "call_x", "type": "function",
                    "function": {"name": "tool_000", "arguments": "{\"k\": \"v\"}"},
                }],
            }}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 2},
        }

    adapter = OpenAIAdapter(api_key="sk-test", post=fake_post, model="gpt-4o-mini")
    resp = await adapter.complete(
        messages=[ChatMessage(role="user", content="go")],
        tools=[ToolDescriptor(topic="/x/x-1/control", action="do_it")],
        max_tokens=100,
    )
    assert captured[0]["url"] == "https://api.openai.com/v1/chat/completions"
    assert captured[0]["headers"]["authorization"] == "Bearer sk-test"
    assert captured[0]["payload"]["model"] == "gpt-4o-mini"
    assert captured[0]["payload"]["max_completion_tokens"] == 100
    assert resp.action.kind == "tool"
    assert resp.action.args == {"k": "v"}


def test_no_api_key_no_post_raises():
    with pytest.raises(ValueError, match="api_key is required"):
        OpenAIAdapter(api_key=None)


# ─── headline observe_room via OpenAIAdapter ────────────────────────


@pytest.mark.asyncio
async def test_observe_room_via_openai(workspace, tool_catalog):
    """Fourth adapter, same workflow, same outcome."""
    wf = _bundled_observe_room()

    def _resp(tool_idx: int, args: dict, *, in_tok: int, out_tok: int) -> Dict[str, Any]:
        return {
            "choices": [{"message": {
                "tool_calls": [{
                    "id": f"call_{tool_idx}", "type": "function",
                    "function": {"name": f"tool_{tool_idx:03d}", "arguments": json.dumps(args)},
                }],
            }}],
            "usage": {"prompt_tokens": in_tok, "completion_tokens": out_tok},
        }

    responses = [
        _resp(0, {"camera": 0},                     in_tok=100, out_tok=20),
        _resp(1, {"frame_id": "f-001"},             in_tok=120, out_tok=25),
        _resp(2, {"text": "Saw a red cube."},       in_tok=140, out_tok=22),
        _resp(3, {"kind": "observations", "content": "Saw a red cube."},
                                                    in_tok=160, out_tok=18),
        # Final step: plain text completion → terminal done.
        {"choices": [{"message": {"content": "Room observed.", "role": "assistant"}}],
         "usage": {"prompt_tokens": 180, "completion_tokens": 8}},
    ]
    n = {"i": 0}

    async def fake_post(url: str, payload: Dict[str, Any], headers: Dict[str, str]) -> Dict[str, Any]:
        assert url.endswith("/v1/chat/completions")
        i = n["i"]; n["i"] += 1
        if i >= len(responses):
            raise AssertionError(f"unexpected {i + 1}th call")
        return responses[i]

    adapter = OpenAIAdapter(api_key="sk-test", post=fake_post)

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
    assert "Saw a red cube." in read_memory(workspace, "observations")
    # Sum prompt + completion tokens across all 5 calls
    expected_tokens = 0
    for r in responses:
        u = r["usage"]
        expected_tokens += u["prompt_tokens"] + u["completion_tokens"]
    assert record.tokens_used == expected_tokens
    assert n["i"] == 5
