# unmanaged
"""AnthropicAdapter tests — v2 milestone, first half.

Same observe_room scenario as the Mock and Ollama tests — the engine
should run identically through any adapter. Network is mocked via
the adapter's ``post=`` injection point.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List

import pytest

_BRAIN_PKG = Path(__file__).resolve().parents[1] / "repo" / "brain" / "1.0.0"
sys.path.insert(0, str(_BRAIN_PKG))

from brain.adapters.anthropic import (  # noqa: E402
    ANTHROPIC_API_VERSION,
    AnthropicAdapter,
    _encode_tools,
    _parse_response,
    _split_system,
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
                           parameters={"type": "object", "properties": {"frame_id": {"type": "string"}},
                                       "required": ["frame_id"]}),
            ToolDescriptor(topic="/speech/speech-1/control", action="speak",
                           description="Speak text",
                           parameters={"type": "object", "properties": {"text": {"type": "string"}},
                                       "required": ["text"]}),
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


def test_split_system_pulls_out_system_role():
    """Claude wants ``system`` as a top-level field, not in messages."""
    msgs = [
        ChatMessage(role="system", content="you are X"),
        ChatMessage(role="user", content="hello"),
        ChatMessage(role="assistant", content="hi"),
    ]
    system, body = _split_system(msgs)
    assert system == "you are X"
    assert len(body) == 2
    assert body[0]["role"] == "user"
    assert body[1]["role"] == "assistant"


def test_split_system_converts_tool_result_to_user_block():
    """role=tool maps to Anthropic's user-message-with-tool_result."""
    msgs = [
        ChatMessage(role="user", content="do X"),
        ChatMessage(role="assistant", content="ok", tool_call_id="toolu_abc"),
        ChatMessage(role="tool", content="result body", tool_call_id="toolu_abc"),
    ]
    _, body = _split_system(msgs)
    assert body[-1]["role"] == "user"
    assert body[-1]["content"][0]["type"] == "tool_result"
    assert body[-1]["content"][0]["tool_use_id"] == "toolu_abc"
    assert body[-1]["content"][0]["content"] == "result body"


def test_encode_tools_action_names_with_input_schema():
    """Anthropic uses ``input_schema`` (not ``parameters``) and tools
    now encode under their action name when unique (parity with the
    ollama adapter)."""
    tools = [ToolDescriptor(topic="/x/x-1/control", action="do_it",
                            parameters={"type": "object", "properties": {"k": {"type": "string"}}})]
    encoded, decode = _encode_tools(tools)
    assert encoded[0]["name"] == "do_it"
    assert "input_schema" in encoded[0]
    assert encoded[0]["input_schema"]["properties"]["k"]["type"] == "string"
    assert decode["do_it"].topic == "/x/x-1/control"


def test_parse_response_tool_use_block():
    """A tool_use content block → ProposedAction(kind=tool)."""
    decode = {"tool_000": ToolDescriptor(topic="/x/x-1/control", action="do_it")}
    body = {
        "content": [
            {"type": "text", "text": "Calling the tool now."},
            {"type": "tool_use", "id": "toolu_xyz", "name": "tool_000", "input": {"k": "v"}},
        ],
        "stop_reason": "tool_use",
        "usage": {"input_tokens": 200, "output_tokens": 30},
    }
    resp = _parse_response(body, decode)
    assert resp.action.kind == "tool"
    assert resp.action.topic == "/x/x-1/control"
    assert resp.action.action == "do_it"
    assert resp.action.args == {"k": "v"}
    assert resp.action.tool_call_id == "toolu_xyz"
    assert resp.action.rationale == "Calling the tool now."
    assert resp.usage.input_tokens == 200
    assert resp.usage.output_tokens == 30


def test_parse_response_text_only_becomes_done():
    """No tool_use block → terminal done with concatenated text."""
    body = {
        "content": [{"type": "text", "text": "Nothing to do."}],
        "stop_reason": "end_turn",
        "usage": {"input_tokens": 50, "output_tokens": 5},
    }
    resp = _parse_response(body, {})
    assert resp.action.kind == "done"
    assert resp.action.rationale == "Nothing to do."


# ─── adapter wire round-trip ────────────────────────────────────────


@pytest.mark.asyncio
async def test_adapter_posts_to_messages_endpoint():
    """Verify URL, headers, payload shape."""
    captured: List[Dict[str, Any]] = []

    async def fake_post(url: str, payload: Dict[str, Any], headers: Dict[str, str]) -> Dict[str, Any]:
        captured.append({"url": url, "payload": payload, "headers": headers})
        return {
            "content": [{"type": "tool_use", "id": "toolu_x", "name": "tool_000", "input": {"k": "v"}}],
            "usage": {"input_tokens": 1, "output_tokens": 1},
        }

    adapter = AnthropicAdapter(api_key="sk-test", post=fake_post, model="claude-3-5-sonnet-20241022")
    await adapter.complete(
        messages=[
            ChatMessage(role="system", content="be helpful"),
            ChatMessage(role="user", content="go"),
        ],
        tools=[ToolDescriptor(topic="/x/x-1/control", action="do_it")],
        max_tokens=128,
    )

    assert len(captured) == 1
    c = captured[0]
    assert c["url"] == "https://api.anthropic.com/v1/messages"
    # Auth header + pinned API version
    assert c["headers"]["x-api-key"] == "sk-test"
    assert c["headers"]["anthropic-version"] == ANTHROPIC_API_VERSION
    # System pulled out of messages, max_tokens carried through
    assert c["payload"]["system"] == "be helpful"
    assert c["payload"]["max_tokens"] == 128
    assert c["payload"]["model"] == "claude-3-5-sonnet-20241022"
    # System NOT present in messages array
    assert all(m["role"] != "system" for m in c["payload"]["messages"])


def test_no_api_key_no_post_raises():
    """The adapter refuses to construct in a state that can never succeed."""
    with pytest.raises(ValueError, match="api_key is required"):
        AnthropicAdapter(api_key=None)


# ─── headline observe_room via AnthropicAdapter ─────────────────────


@pytest.mark.asyncio
async def test_observe_room_via_anthropic(workspace, tool_catalog):
    """observe_room runs identically through AnthropicAdapter as it
    does through Mock + Ollama. Same v1 acceptance, new adapter."""
    wf = _bundled_observe_room()

    responses = [
        # step 0: capture_frame — tools encode under action names now.
        {"content": [{"type": "tool_use", "id": "toolu_0", "name": "capture_frame", "input": {"camera": 0}}],
         "usage": {"input_tokens": 100, "output_tokens": 20}},
        # step 1: detect_objects
        {"content": [{"type": "tool_use", "id": "toolu_1", "name": "detect_objects", "input": {"frame_id": "f-001"}}],
         "usage": {"input_tokens": 120, "output_tokens": 25}},
        # step 2: speak (with some leading thought text — should land in rationale)
        {"content": [
            {"type": "text", "text": "Calling speech."},
            {"type": "tool_use", "id": "toolu_2", "name": "speak", "input": {"text": "Saw a red cube."}},
         ],
         "usage": {"input_tokens": 140, "output_tokens": 22}},
        # step 3: write_memory
        {"content": [{"type": "tool_use", "id": "toolu_3", "name": "write_memory",
                      "input": {"kind": "observations", "content": "Saw a red cube."}}],
         "usage": {"input_tokens": 160, "output_tokens": 18}},
        # step 4: done — text only, no tool_use
        {"content": [{"type": "text", "text": "Room observed."}],
         "stop_reason": "end_turn",
         "usage": {"input_tokens": 180, "output_tokens": 8}},
    ]
    n = {"i": 0}

    async def fake_post(url: str, payload: Dict[str, Any], headers: Dict[str, str]) -> Dict[str, Any]:
        assert url.endswith("/v1/messages")
        # Anthropic requires max_tokens — adapter defaults if engine doesn't set it.
        assert "max_tokens" in payload
        i = n["i"]; n["i"] += 1
        if i >= len(responses):
            raise AssertionError(f"unexpected {i + 1}th call — script has only {len(responses)}")
        return responses[i]

    adapter = AnthropicAdapter(api_key="sk-test", post=fake_post)

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
    # Token accounting rolls up from the Anthropic usage shape
    assert record.tokens_used == sum(r["usage"]["input_tokens"] + r["usage"]["output_tokens"] for r in responses)
    assert n["i"] == 5
