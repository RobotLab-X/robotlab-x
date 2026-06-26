# unmanaged
"""Brain workflow engine tests — v1 milestone 1 (Mock adapter only).

Exercises the full ABSENT → done path against the bundled
``observe_room`` workflow using a scripted MockAdapter and a stub
tool_caller. No live bus, no live model, no FastAPI app — just the
engine + its dependencies, talking through small interfaces.

These tests are the executable spec for what "observe_room works"
means. Every adapter we add in later milestones has to make the
exact same test pass with its own mocked HTTP layer.

The brain package isn't on PYTHONPATH normally — it lives in
``repo/brain/1.0.0/brain/``. The conftest below prepends that path
so ``import brain`` works.
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pytest

# Put the brain service package on the import path.
_BRAIN_PKG = Path(__file__).resolve().parents[1] / "repo" / "brain" / "1.0.0"
sys.path.insert(0, str(_BRAIN_PKG))

# Imports must happen AFTER the path manipulation.
from brain.adapters.mock import MockAdapter, script_call, script_done  # noqa: E402
from brain.context_loader import list_workflow_dirs, load_workflow  # noqa: E402
from brain.memory import read_memory  # noqa: E402
from brain.safety_gate import _topic_matches, check_max_steps, check_tool_call  # noqa: E402
from brain.schemas import (  # noqa: E402
    AllowedTools, ProposedAction, RunConfiguration, ToolDescriptor,
    ToolPattern, ToolResult, ToolTerminationCondition, Workflow,
)
from brain.workflow_engine import WorkflowEngine  # noqa: E402


# ─── fixtures ───────────────────────────────────────────────────────


@pytest.fixture
def workspace(tmp_path):
    """A per-test workspace with the bundled observe_room workflow
    visible (via list_workflow_dirs) + an empty memory dir."""
    ws = tmp_path / "ws"
    (ws / "memory").mkdir(parents=True)
    (ws / "runs").mkdir()
    return ws


@pytest.fixture
def tool_catalog():
    """A synthetic tool catalog matching what /+/+/meta would produce
    for a runtime with one video, one speech, and the brain itself."""
    descriptors = [
        ToolDescriptor(
            topic="/video/video-1/control",
            action="capture_frame",
            description="Capture one frame from the configured camera",
            parameters={"type": "object", "properties": {"camera": {"type": "integer"}}, "required": []},
        ),
        ToolDescriptor(
            topic="/video/video-1/control",
            action="detect_objects",
            description="Run object detection on a frame_id",
            parameters={"type": "object", "properties": {"frame_id": {"type": "string"}}, "required": ["frame_id"]},
        ),
        ToolDescriptor(
            topic="/speech/speech-1/control",
            action="speak",
            description="Speak a sentence aloud",
            parameters={"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
        ),
        ToolDescriptor(
            topic="/brain/brain-1/control",
            action="write_memory",
            description="Append an observation to memory",
            parameters={
                "type": "object",
                "properties": {"kind": {"type": "string"}, "content": {"type": "string"}},
                "required": ["kind", "content"],
            },
        ),
        # Something the workflow should NOT allow — so the unknown-tool
        # test below has something realistic to point at.
        ToolDescriptor(
            topic="/movement/movement-1/control",
            action="drive",
            description="Drive the robot's base",
            parameters={"type": "object"},
        ),
    ]
    return {f"{d.topic}::{d.action}": d for d in descriptors}


def _bundled_observe_room() -> Workflow:
    """Load the real bundled workflow — same file every adapter has to
    satisfy. Loading it through list_workflow_dirs validates the
    bundled location resolves correctly."""
    bundled_root = _BRAIN_PKG / "workflows"
    assert (bundled_root / "observe_room" / "workflow.yaml").is_file(), (
        f"bundled observe_room missing — looked under {bundled_root}"
    )
    # Use a throwaway workspace just to read; list_workflow_dirs finds
    # the bundled version automatically.
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        return load_workflow("observe_room", Path(td))


# ─── safety gate unit tests ─────────────────────────────────────────


def test_topic_matches_segment_glob():
    assert _topic_matches("/video/*/control", "/video/video-1/control")
    assert _topic_matches("/video/*/control", "/video/cam-2/control")
    # ``*`` does NOT cross segments.
    assert not _topic_matches("/video/*/control", "/video/video-1/extra/control")
    # No federation opt-in → federated topic refused.
    assert not _topic_matches("/video/*/control", "/video/video-1@funny-droid/control")
    # With ``@**`` opt-in, federation works.
    assert _topic_matches("/video/*@**/control", "/video/video-1@funny-droid/control")
    assert _topic_matches("/video/*@**/control", "/video/video-1/control")  # also matches unfederated


def test_safety_gate_allows():
    wf = _bundled_observe_room()
    verdict = check_tool_call(
        wf,
        ProposedAction(kind="tool", topic="/video/video-1/control", action="capture_frame"),
    )
    assert verdict.allowed, verdict.reason


def test_safety_gate_blocks_explicit():
    wf = _bundled_observe_room()
    verdict = check_tool_call(
        wf,
        ProposedAction(kind="tool", topic="/movement/movement-1/control", action="drive"),
    )
    assert not verdict.allowed
    assert verdict.guard == "block_list"


def test_safety_gate_blocks_unknown():
    """Default-deny — nothing in allowed_tools matches, so reject."""
    wf = _bundled_observe_room()
    verdict = check_tool_call(
        wf,
        ProposedAction(kind="tool", topic="/system/system-1/control", action="shutdown"),
    )
    assert not verdict.allowed
    assert verdict.guard in ("allow_list", "block_list")  # /system is also explicitly blocked


def test_safety_gate_unknown_target_when_catalog_provided():
    wf = _bundled_observe_room()
    verdict = check_tool_call(
        wf,
        ProposedAction(kind="tool", topic="/video/nonexistent/control", action="capture_frame"),
        tool_catalog={},
    )
    assert not verdict.allowed
    assert verdict.guard == "unknown_target"


def test_safety_gate_max_steps():
    wf = _bundled_observe_room()
    assert check_max_steps(wf, 0).allowed
    assert check_max_steps(wf, wf.max_steps - 1).allowed
    assert not check_max_steps(wf, wf.max_steps).allowed


# ─── workflow loader tests ──────────────────────────────────────────


def test_bundled_observe_room_loads():
    wf = _bundled_observe_room()
    assert wf.name == "observe_room"
    assert wf.max_steps == 8
    assert wf.allowed_tools.allowed, "observe_room must define some allowed tools"
    assert wf.allowed_tools.blocked, "observe_room must define some blocked tools"


def test_per_instance_overrides_bundled(workspace, tmp_path):
    """An operator workflow at workspace/workflows/<name>/ shadows the
    bundled one of the same name."""
    user_wf = workspace / "workflows" / "observe_room"
    user_wf.mkdir(parents=True)
    (user_wf / "workflow.yaml").write_text(
        "name: observe_room\ndescription: operator override\nmax_steps: 2\npreferred_backend: mock\n"
    )
    (user_wf / "prompt.md").write_text("operator prompt")
    (user_wf / "allowed_tools.yaml").write_text("allowed: []\nblocked: []\n")

    dirs = list_workflow_dirs(workspace)
    assert dirs["observe_room"] == user_wf, "per-instance should shadow bundled"

    wf = load_workflow("observe_room", workspace)
    assert wf.description == "operator override"
    assert wf.max_steps == 2


# ─── headline end-to-end test ──────────────────────────────────────


@pytest.mark.asyncio
async def test_observe_room(workspace, tool_catalog):
    """The full happy path. MockAdapter scripts the model's tool calls;
    a stub tool_caller scripts the responses; the engine runs to
    success and the artifacts are right.
    """
    wf = _bundled_observe_room()

    # Scripted model — proposes each tool in turn, ends with done.
    adapter = MockAdapter(script=[
        script_call("/video/video-1/control", "capture_frame", {"camera": 0}, tool_call_id="tc-1"),
        script_call("/video/video-1/control", "detect_objects", {"frame_id": "f-001"}, tool_call_id="tc-2"),
        script_call("/speech/speech-1/control", "speak", {"text": "Saw a red cube."}, tool_call_id="tc-3"),
        script_call("/brain/brain-1/control", "write_memory", {"kind": "observations", "content": "Saw a red cube."}, tool_call_id="tc-4"),
        script_done("Room observed, all four actions completed."),
    ])

    # Stub tool_caller — returns scripted responses for each topic+action.
    responses = {
        ("/video/video-1/control", "capture_frame"): {"frame_id": "f-001", "size": [640, 480]},
        ("/video/video-1/control", "detect_objects"): {"objects": [{"label": "cube", "color": "red", "confidence": 0.92}]},
        ("/speech/speech-1/control", "speak"): {"spoken": True},
        ("/brain/brain-1/control", "write_memory"): {"written": True, "path": str(workspace / "memory" / "observations.md")},
    }

    async def fake_tool_caller(topic: str, action: str, args):
        # The brain.write_memory tool also needs to actually append —
        # mirror the real behaviour so observations.md gets the line.
        if topic.startswith("/brain/") and action == "write_memory":
            from brain.memory import write_observation
            write_observation(workspace, args["kind"], args["content"])
        value = responses.get((topic, action))
        assert value is not None, f"unexpected tool call: {topic}::{action}"
        return ToolResult(status="ok", value=value, duration_ms=5)

    published = []
    def fake_publish(topic, payload, retained=False):
        published.append((topic, payload, retained))

    engine = WorkflowEngine(
        workflow=wf,
        workspace_dir=workspace,
        adapter=adapter,
        tool_caller=fake_tool_caller,
        publish=fake_publish,
        bus_prefix="/brain/brain-1",
        tool_catalog=tool_catalog,
    )

    record = await engine.run()

    # Terminal state
    assert record.status == "success", record.failure_reason
    assert record.steps_used == 5, f"expected 5 steps (4 tools + done), got {record.steps_used}"
    assert record.result_summary

    # Disk artefacts
    assert (engine.run_dir / "input.json").is_file()
    assert (engine.run_dir / "context.md").is_file()
    assert (engine.run_dir / "result.md").is_file()
    steps = (engine.run_dir / "steps.jsonl").read_text().strip().splitlines()
    tool_calls = (engine.run_dir / "tool_calls.jsonl").read_text().strip().splitlines()
    assert len(steps) == 5, f"expected 5 step records, got {len(steps)}"
    assert len(tool_calls) == 4, f"expected 4 tool_call records, got {len(tool_calls)}"

    # Memory got the observation
    body = read_memory(workspace, "observations")
    assert "Saw a red cube." in body, body

    # Bus messages were emitted (summary retained + step/tool_call streams)
    topics = {topic for topic, _, _ in published}
    assert any(t.endswith("/result") for t in topics), "result topic should have been published"
    assert any("/runs/" in t and t.endswith("/steps") for t in topics), "step events should have been published"


@pytest.mark.asyncio
async def test_blocked_tool_rejected(workspace, tool_catalog):
    """Model proposes a blocked tool → workflow fails with a clear verdict."""
    wf = _bundled_observe_room()
    adapter = MockAdapter(script=[
        script_call("/movement/movement-1/control", "drive", {"speed": 0.5}),
    ])

    async def fake_tool_caller(*_a, **_kw):  # should NOT be called
        raise AssertionError("tool_caller invoked despite blocked tool")

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
    assert record.status == "failure"
    assert "unsafe tool call" in (record.failure_reason or "")
    # Block-list match should be present in the step log.
    steps_text = (engine.run_dir / "steps.jsonl").read_text()
    assert "block_list" in steps_text


@pytest.mark.asyncio
async def test_max_steps_exceeded(workspace, tool_catalog):
    """A workflow that never emits ``done`` hits max_steps and fails."""
    # Hand-build a tiny workflow with max_steps=2 so the test is short.
    user_wf = workspace / "workflows" / "loopy"
    user_wf.mkdir(parents=True)
    (user_wf / "workflow.yaml").write_text(
        "name: loopy\nmax_steps: 2\npreferred_backend: mock\n"
    )
    (user_wf / "prompt.md").write_text("loop")
    (user_wf / "allowed_tools.yaml").write_text(
        "allowed:\n"
        "  - topic: /video/*/control\n"
        "    actions: [capture_frame]\n"
        "blocked: []\n"
    )

    wf = load_workflow("loopy", workspace)

    # Adapter that never says done.
    adapter = MockAdapter(script=[
        script_call("/video/video-1/control", "capture_frame"),
        script_call("/video/video-1/control", "capture_frame"),
        script_call("/video/video-1/control", "capture_frame"),  # 3rd should be blocked by max_steps=2
        script_done(),
    ])

    async def fake_tool_caller(*_a, **_kw):
        return ToolResult(status="ok", value={"frame_id": "f"}, duration_ms=1)

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
    assert record.status == "failure"
    assert "max_steps" in (record.failure_reason or "")


@pytest.mark.asyncio
async def test_done_immediately(workspace, tool_catalog):
    """Trivial workflow: adapter emits ``done`` on first call."""
    wf = _bundled_observe_room()
    adapter = MockAdapter(script=[script_done("nothing to observe")])

    async def fake_tool_caller(*_a, **_kw):
        raise AssertionError("tool_caller invoked for a done-first run")

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
    assert record.status == "success"
    assert record.steps_used == 1


# ─── terminate_on (engine-driven termination) ─────────────────────────

def _terminate_workflow(workspace_path, *, terminate_on_actions, allowed_actions):
    """Minimal workflow with terminate_on configured. Used by the 3
    tests below to keep test setup tight."""
    return Workflow(
        name="terminate_on_test",
        description="",
        preferred_backend="mock",
        max_steps=8,
        timeout_seconds=30,
        allowed_tools=AllowedTools(
            allowed=[ToolPattern(topic="/brain/*/control", actions=list(allowed_actions))],
            blocked=[],
        ),
        terminate_on=[ToolTerminationCondition(action=a) for a in terminate_on_actions],
    )


@pytest.mark.asyncio
async def test_terminate_on_first_call_terminates(workspace, tool_catalog):
    """Engine terminates as success immediately after the first
    listed action returns ok, even if the adapter would have
    produced more turns."""
    wf = _terminate_workflow(
        workspace,
        terminate_on_actions=["write_memory"],
        allowed_actions=["write_memory"],
    )
    # Scripted adapter would loop write_memory forever — the engine
    # should never get to the second call.
    adapter = MockAdapter(script=[
        script_call("/brain/brain-1/control", "write_memory",
                    args={"kind": "reflection", "content": "x"}),
        script_call("/brain/brain-1/control", "write_memory",
                    args={"kind": "reflection", "content": "y"}),
        script_call("/brain/brain-1/control", "write_memory",
                    args={"kind": "reflection", "content": "z"}),
    ])
    call_count = {"n": 0}

    async def fake_tool_caller(topic, action, args):
        call_count["n"] += 1
        return ToolResult(status="ok", value={"written": True}, duration_ms=1)

    engine = WorkflowEngine(
        workflow=wf, workspace_dir=workspace, adapter=adapter,
        tool_caller=fake_tool_caller, publish=lambda *a, **kw: None,
        bus_prefix="/brain/brain-1", tool_catalog=tool_catalog,
    )
    record = await engine.run()
    assert record.status == "success"
    assert call_count["n"] == 1, "engine should have stopped after the first OK call"
    assert "terminate_on satisfied" in (record.result_summary or "")


@pytest.mark.asyncio
async def test_terminate_on_failed_call_does_not_terminate(workspace, tool_catalog):
    """A failed tool call does NOT satisfy terminate_on — the engine
    keeps going (and the model gets another turn). Confirms the
    'failed != success' rule we agreed on during ideation."""
    wf = _terminate_workflow(
        workspace,
        terminate_on_actions=["write_memory"],
        allowed_actions=["write_memory"],
    )
    adapter = MockAdapter(script=[
        script_call("/brain/brain-1/control", "write_memory",
                    args={"kind": "reflection", "content": "fails"}),
        script_call("/brain/brain-1/control", "write_memory",
                    args={"kind": "reflection", "content": "succeeds"}),
        script_done("safety net"),  # never reached if logic is correct
    ])
    statuses = ["error", "ok"]

    async def fake_tool_caller(topic, action, args):
        status = statuses.pop(0)
        return ToolResult(
            status=status,
            value={"written": status == "ok"},
            error="boom" if status == "error" else None,
            duration_ms=1,
        )

    engine = WorkflowEngine(
        workflow=wf, workspace_dir=workspace, adapter=adapter,
        tool_caller=fake_tool_caller, publish=lambda *a, **kw: None,
        bus_prefix="/brain/brain-1", tool_catalog=tool_catalog,
    )
    record = await engine.run()
    assert record.status == "success"
    # First call failed → must NOT have terminated; second call
    # succeeded → terminated. Steps = 2.
    assert record.steps_used == 2


@pytest.mark.asyncio
async def test_workflow_events_published(workspace, tool_catalog):
    """Engine publishes started + ended on /brain/<id>/workflow_events
    with the canonical payload shape."""
    wf = _terminate_workflow(
        workspace,
        terminate_on_actions=["write_memory"],
        allowed_actions=["write_memory"],
    )
    adapter = MockAdapter(script=[
        script_call("/brain/brain-1/control", "write_memory",
                    args={"kind": "reflection", "content": "hello"}),
    ])

    async def fake_tool_caller(topic, action, args):
        return ToolResult(status="ok", value={"written": True}, duration_ms=1)

    events = []

    def fake_publish(topic, payload, **_kw):
        if "/workflow_events" in topic:
            events.append((topic, payload))

    engine = WorkflowEngine(
        workflow=wf, workspace_dir=workspace, adapter=adapter,
        tool_caller=fake_tool_caller, publish=fake_publish,
        bus_prefix="/brain/brain-1", tool_catalog=tool_catalog,
        inputs={"topic": "Why a robot might want to keep a journal."},
    )
    record = await engine.run()
    assert record.status == "success"

    # Exactly two events: started + ended.
    assert len(events) == 2, f"expected 2 events, got {len(events)}: {events}"
    assert all(t == "/brain/brain-1/workflow_events" for t, _ in events)
    started = events[0][1]
    ended = events[1][1]
    assert started["event"] == "started"
    assert started["workflow"] == "terminate_on_test"
    assert started["run_id"] == engine.run_id
    assert "started_at" in started
    assert started["inputs"]["topic"].startswith("Why")
    assert started["model"] == "mock"
    assert ended["event"] == "ended"
    assert ended["workflow"] == "terminate_on_test"
    assert ended["run_id"] == engine.run_id
    assert ended["status"] == "success"
    assert ended["tool_calls_count"] == 1
    assert ended["duration_ms"] is not None and ended["duration_ms"] >= 0


def test_terminate_on_validation_rejects_unreachable_action(workspace, tmp_path):
    """A workflow whose terminate_on lists an action not in
    allowed_tools is rejected at load time — it could never terminate
    by the engine-driven path."""
    wf_dir = tmp_path / "workflows" / "bad_terminate_on"
    wf_dir.mkdir(parents=True)
    (wf_dir / "workflow.yaml").write_text(
        "name: bad_terminate_on\n"
        "preferred_backend: mock\n"
        "max_steps: 4\n"
        "timeout_seconds: 30\n"
        "terminate_on:\n"
        "  - action: never_allowed\n"
        "steps:\n"
        "  - id: default\n"
        "    prompt: prompt.md\n"
        "    on_success: success.md\n"
        "    on_failure: failure.md\n"
    )
    (wf_dir / "allowed_tools.yaml").write_text(
        "allowed:\n  - topic: /brain/*/control\n    actions: [write_memory]\n"
        "blocked: []\n"
    )
    (wf_dir / "prompt.md").write_text("test")
    (wf_dir / "success.md").write_text("")
    (wf_dir / "failure.md").write_text("")

    with pytest.raises(ValueError, match="never_allowed"):
        load_workflow("bad_terminate_on", tmp_path)


def test_terminate_on_validation_passes_with_wildcard(workspace, tmp_path):
    """A workflow with allowed_tools actions=[\"*\"] (wildcard) accepts
    any terminate_on action — no rejection."""
    wf_dir = tmp_path / "workflows" / "wild_terminate_on"
    wf_dir.mkdir(parents=True)
    (wf_dir / "workflow.yaml").write_text(
        "name: wild_terminate_on\n"
        "preferred_backend: mock\n"
        "terminate_on:\n"
        "  - action: anything\n"
        "steps:\n"
        "  - id: default\n"
        "    prompt: prompt.md\n"
        "    on_success: success.md\n"
        "    on_failure: failure.md\n"
    )
    (wf_dir / "allowed_tools.yaml").write_text(
        "allowed:\n  - topic: /brain/*/control\n    actions: [\"*\"]\n"
        "blocked: []\n"
    )
    (wf_dir / "prompt.md").write_text("test")
    (wf_dir / "success.md").write_text("")
    (wf_dir / "failure.md").write_text("")

    wf = load_workflow("wild_terminate_on", tmp_path)
    assert len(wf.terminate_on) == 1
    assert wf.terminate_on[0].action == "anything"


@pytest.mark.asyncio
async def test_terminate_on_done_without_tool_call_fails(workspace, tool_catalog):
    """When terminate_on is set, ``done`` from the model is NOT
    legitimate until the required tools have actually been called.
    Models that emit done with zero tool calls (e.g., qwen2.5-coder
    which emits JSON-as-text) should fail honestly, not silently
    succeed."""
    wf = _terminate_workflow(
        workspace,
        terminate_on_actions=["write_memory"],
        allowed_actions=["write_memory"],
    )
    # Model emits done immediately — never calls any tool.
    adapter = MockAdapter(script=[script_done("I'm finished")])

    async def fake_tool_caller(*_a, **_kw):
        raise AssertionError("tool_caller should never run")

    engine = WorkflowEngine(
        workflow=wf, workspace_dir=workspace, adapter=adapter,
        tool_caller=fake_tool_caller, publish=lambda *a, **kw: None,
        bus_prefix="/brain/brain-1", tool_catalog=tool_catalog,
    )
    record = await engine.run()
    assert record.status == "failure"
    assert "terminate_on" in (record.failure_reason or "")
    assert "write_memory" in (record.failure_reason or "")


@pytest.mark.asyncio
async def test_terminate_on_done_after_tool_call_succeeds(workspace, tool_catalog):
    """Counterpart to the above: once terminate_on IS satisfied, a
    subsequent ``done`` from the model is legitimate. (This shouldn't
    happen in practice because the engine terminates at the tool-call
    success — but the path is here for safety in case of mid-run
    state changes.)"""
    wf = _terminate_workflow(
        workspace,
        terminate_on_actions=["write_memory"],
        allowed_actions=["write_memory"],
    )
    # tool_caller returns ok the first time, then the adapter wraps
    # in a done that the engine would still need to handle gracefully
    # if it reached step 1 (it doesn't, due to terminate_on at step 0)
    adapter = MockAdapter(script=[
        script_call("/brain/brain-1/control", "write_memory",
                    args={"kind": "reflection", "content": "x"}),
    ])

    async def fake_tool_caller(*_a, **_kw):
        return ToolResult(status="ok", value={"written": True}, duration_ms=1)

    engine = WorkflowEngine(
        workflow=wf, workspace_dir=workspace, adapter=adapter,
        tool_caller=fake_tool_caller, publish=lambda *a, **kw: None,
        bus_prefix="/brain/brain-1", tool_catalog=tool_catalog,
    )
    record = await engine.run()
    assert record.status == "success"


# ─── preferred_model (per-workflow model pin) ─────────────────────────

@pytest.mark.asyncio
async def test_preferred_model_passed_to_adapter(workspace, tool_catalog):
    """``Workflow.preferred_model`` should flow through the engine to
    ``adapter.complete(model=...)`` on every call. Regression-safe
    contract for the pin documented in TESTING_RESULTS.md (e.g.
    take_a_note → llama3.2:3b)."""
    wf = Workflow(
        name="pinned",
        description="",
        preferred_backend="mock",
        preferred_model="llama3.2:3b",
        max_steps=4,
        timeout_seconds=30,
        allowed_tools=AllowedTools(allowed=[], blocked=[]),
    )
    adapter = MockAdapter(script=[script_done("ok")])

    async def noop_tool_caller(*_a, **_kw):
        return ToolResult(status="ok", value={}, duration_ms=0)

    engine = WorkflowEngine(
        workflow=wf, workspace_dir=workspace, adapter=adapter,
        tool_caller=noop_tool_caller, publish=lambda *a, **kw: None,
        bus_prefix="/brain/brain-1", tool_catalog=tool_catalog,
    )
    record = await engine.run()
    assert record.status == "success"
    assert len(adapter.calls) >= 1
    assert adapter.calls[0]["model"] == "llama3.2:3b"


@pytest.mark.asyncio
async def test_preferred_model_unset_passes_none(workspace, tool_catalog):
    """When ``preferred_model`` is not set, the adapter sees
    ``model=None`` and falls back to its configured default."""
    wf = Workflow(
        name="default",
        description="",
        preferred_backend="mock",
        # preferred_model intentionally omitted — should default to None
        max_steps=4,
        timeout_seconds=30,
        allowed_tools=AllowedTools(allowed=[], blocked=[]),
    )
    adapter = MockAdapter(script=[script_done("ok")])

    async def noop_tool_caller(*_a, **_kw):
        return ToolResult(status="ok", value={}, duration_ms=0)

    engine = WorkflowEngine(
        workflow=wf, workspace_dir=workspace, adapter=adapter,
        tool_caller=noop_tool_caller, publish=lambda *a, **kw: None,
        bus_prefix="/brain/brain-1", tool_catalog=tool_catalog,
    )
    await engine.run()
    assert adapter.calls[0]["model"] is None


def test_context_loader_accepts_legacy_model_alias(workspace):
    """Existing workspaces with the old ``model:`` key still load —
    the loader maps it to ``preferred_backend`` for one release."""
    wf_dir = workspace / "workflows" / "legacy"
    wf_dir.mkdir(parents=True)
    (wf_dir / "workflow.yaml").write_text(
        "name: legacy\nmodel: mock\nmax_steps: 2\n"
    )
    (wf_dir / "prompt.md").write_text("legacy")
    (wf_dir / "allowed_tools.yaml").write_text("allowed: []\nblocked: []\n")
    from brain.context_loader import load_workflow
    wf = load_workflow("legacy", workspace)
    assert wf.preferred_backend == "mock"
    assert wf.preferred_model is None


# ─── save_workflow_preferences (ruamel.yaml round-trip) ──────────────

def test_save_workflow_preferences_round_trip(workspace):
    """Writing preferred_* should preserve other keys + inline
    comments via ruamel.yaml round-trip mode."""
    from ruamel.yaml import YAML
    wf_dir = workspace / "workflows" / "tinker"
    wf_dir.mkdir(parents=True)
    original = (
        "# Notable comment about this workflow.\n"
        "name: tinker\n"
        "preferred_backend: mock\n"
        "# A model pin would go below.\n"
        "max_steps: 8\n"
        "timeout_seconds: 120\n"
    )
    (wf_dir / "workflow.yaml").write_text(original)
    (wf_dir / "prompt.md").write_text("p")
    (wf_dir / "allowed_tools.yaml").write_text("allowed: []\nblocked: []\n")

    # Do the round-trip manually — mirrors what m_save_workflow_preferences
    # does. Don't instantiate BrainService here (heavy fixture chain);
    # we're verifying the ruamel write semantics, not the service
    # dispatch path.
    yaml = YAML()
    yaml.preserve_quotes = True
    with open(wf_dir / "workflow.yaml", "r") as f:
        data = yaml.load(f)
    data["preferred_backend"] = "ollama"
    data["preferred_model"] = "qwen3:8b"
    with open(wf_dir / "workflow.yaml", "w") as f:
        yaml.dump(data, f)

    new_text = (wf_dir / "workflow.yaml").read_text()
    # Comments preserved
    assert "# Notable comment about this workflow." in new_text
    assert "# A model pin would go below." in new_text
    # Keys updated / added
    assert "preferred_backend: ollama" in new_text
    assert "preferred_model: qwen3:8b" in new_text
    # Other keys still present
    assert "max_steps: 8" in new_text
    assert "timeout_seconds: 120" in new_text

    # And the loader picks up the new values.
    from brain.context_loader import load_workflow
    wf = load_workflow("tinker", workspace)
    assert wf.preferred_backend == "ollama"
    assert wf.preferred_model == "qwen3:8b"


def test_save_workflow_preferences_clears_model_when_blank(workspace):
    """Empty/blank preferred_model should remove the key so the
    adapter falls back to its configured default."""
    from ruamel.yaml import YAML
    wf_dir = workspace / "workflows" / "pinned"
    wf_dir.mkdir(parents=True)
    (wf_dir / "workflow.yaml").write_text(
        "name: pinned\npreferred_backend: ollama\npreferred_model: llama3.2:3b\nmax_steps: 4\n"
    )
    (wf_dir / "prompt.md").write_text("p")
    (wf_dir / "allowed_tools.yaml").write_text("allowed: []\nblocked: []\n")

    yaml = YAML()
    with open(wf_dir / "workflow.yaml", "r") as f:
        data = yaml.load(f)
    data["preferred_backend"] = "ollama"
    data.pop("preferred_model", None)  # mirrors the "clear when blank" branch
    with open(wf_dir / "workflow.yaml", "w") as f:
        yaml.dump(data, f)

    from brain.context_loader import load_workflow
    wf = load_workflow("pinned", workspace)
    assert wf.preferred_backend == "ollama"
    assert wf.preferred_model is None


# ─── named run configurations (Stage 1) ──────────────────────────────

def _write_minimal_workflow(workspace, name, yaml_text):
    wf_dir = workspace / "workflows" / name
    wf_dir.mkdir(parents=True)
    (wf_dir / "workflow.yaml").write_text(yaml_text)
    (wf_dir / "prompt.md").write_text("p")
    (wf_dir / "allowed_tools.yaml").write_text("allowed: []\nblocked: []\n")


def test_loader_parses_configurations(workspace):
    """Workflow.configurations should round-trip from yaml."""
    _write_minimal_workflow(workspace, "cfgs", """
name: cfgs
preferred_backend: ollama
preferred_model: llama3.2:3b
configurations:
  - name: fast
    backend: ollama
    model: llama3.2:3b
    description: smallest validated
  - name: smart
    backend: ollama
    model: qwen3:8b
  - name: production
    backend: anthropic
    model: claude-opus-4-8
max_steps: 4
""")
    from brain.context_loader import load_workflow
    wf = load_workflow("cfgs", workspace)
    assert len(wf.configurations) == 3
    assert wf.configurations[0].name == "fast"
    assert wf.configurations[0].backend == "ollama"
    assert wf.configurations[0].model == "llama3.2:3b"
    assert wf.configurations[0].description == "smallest validated"
    assert wf.configurations[1].name == "smart"
    assert wf.configurations[2].name == "production"
    assert wf.configurations[2].backend == "anthropic"


def test_loader_skips_invalid_configurations(workspace):
    """Entries missing name or backend (or with wrong types) are
    dropped silently — operator-mistyped yaml shouldn't brick a
    workflow they were trying to enrich. Valid entries still load."""
    _write_minimal_workflow(workspace, "bad_cfgs", """
name: bad_cfgs
preferred_backend: mock
configurations:
  - {backend: ollama, model: x}        # missing name → skip
  - {name: ok, backend: ollama}        # valid
  - {name: "", backend: ollama}        # empty name → skip
  - {name: nobackend}                  # missing backend → skip
  - name: also_ok
    backend: anthropic
    model: claude-haiku
""")
    from brain.context_loader import load_workflow
    wf = load_workflow("bad_cfgs", workspace)
    assert [c.name for c in wf.configurations] == ["ok", "also_ok"]


def test_loader_dedupes_configuration_names(workspace):
    """First occurrence of each name wins; duplicates dropped."""
    _write_minimal_workflow(workspace, "dupes", """
name: dupes
preferred_backend: mock
configurations:
  - {name: fast, backend: ollama, model: a}
  - {name: fast, backend: anthropic, model: b}
  - {name: slow, backend: openai, model: c}
""")
    from brain.context_loader import load_workflow
    wf = load_workflow("dupes", workspace)
    assert [c.name for c in wf.configurations] == ["fast", "slow"]
    assert wf.configurations[0].model == "a"  # first wins


def test_loader_empty_configurations_when_absent(workspace):
    """No configurations key → empty list. Backwards-compatible."""
    _write_minimal_workflow(workspace, "no_cfgs", """
name: no_cfgs
preferred_backend: mock
""")
    from brain.context_loader import load_workflow
    wf = load_workflow("no_cfgs", workspace)
    assert wf.configurations == []


# ─── named run configurations (Stage 2 — CRUD round-trip) ─────────────
#
# These exercise the ruamel.yaml mutation paths in the brain's
# save/delete/set_default actions directly, mirroring what
# m_save_run_configuration etc. do. Avoiding a full BrainService
# instance keeps the test setup tight; the service methods are thin
# wrappers around the same yaml mutations.


def test_save_run_configuration_appends_new(workspace):
    """First save appends a new entry to configurations[]. Other
    keys (preferred_backend, max_steps, etc.) survive the round-trip."""
    from ruamel.yaml import YAML
    wf_dir = workspace / "workflows" / "appendable"
    wf_dir.mkdir(parents=True)
    (wf_dir / "workflow.yaml").write_text(
        "name: appendable\npreferred_backend: ollama\nmax_steps: 4\n"
    )
    (wf_dir / "prompt.md").write_text("p")
    (wf_dir / "allowed_tools.yaml").write_text("allowed: []\nblocked: []\n")

    yaml = YAML()
    yaml.preserve_quotes = True
    with open(wf_dir / "workflow.yaml", "r") as f:
        data = yaml.load(f)
    configs = list(data.get("configurations") or [])
    configs.append({"name": "fast", "backend": "ollama", "model": "llama3.2:3b"})
    data["configurations"] = configs
    with open(wf_dir / "workflow.yaml", "w") as f:
        yaml.dump(data, f)

    from brain.context_loader import load_workflow
    wf = load_workflow("appendable", workspace)
    assert len(wf.configurations) == 1
    assert wf.configurations[0].name == "fast"
    assert wf.preferred_backend == "ollama"  # untouched
    assert wf.max_steps == 4  # untouched


def test_save_run_configuration_updates_in_place(workspace):
    """Saving an existing name replaces that entry, doesn't dup."""
    from ruamel.yaml import YAML
    _write_minimal_workflow(workspace, "updateable", """
name: updateable
preferred_backend: mock
configurations:
  - {name: fast, backend: ollama, model: llama3.2:3b}
  - {name: smart, backend: ollama, model: qwen3:8b}
""")
    yaml = YAML()
    with open(workspace / "workflows" / "updateable" / "workflow.yaml", "r") as f:
        data = yaml.load(f)
    configs = list(data.get("configurations") or [])
    # Update "fast" in place — change to anthropic
    idx = next(
        (i for i, c in enumerate(configs)
         if isinstance(c, dict) and c.get("name") == "fast"),
        None,
    )
    assert idx is not None
    configs[idx] = {"name": "fast", "backend": "anthropic", "model": "claude-haiku"}
    data["configurations"] = configs
    with open(workspace / "workflows" / "updateable" / "workflow.yaml", "w") as f:
        yaml.dump(data, f)

    from brain.context_loader import load_workflow
    wf = load_workflow("updateable", workspace)
    assert len(wf.configurations) == 2  # no duplication
    fast = next(c for c in wf.configurations if c.name == "fast")
    assert fast.backend == "anthropic"
    assert fast.model == "claude-haiku"


def test_delete_run_configuration_removes_entry(workspace):
    from ruamel.yaml import YAML
    _write_minimal_workflow(workspace, "deletable", """
name: deletable
preferred_backend: mock
configurations:
  - {name: keep, backend: ollama, model: a}
  - {name: drop, backend: ollama, model: b}
""")
    yaml = YAML()
    yaml_path = workspace / "workflows" / "deletable" / "workflow.yaml"
    with open(yaml_path, "r") as f:
        data = yaml.load(f)
    configs = [c for c in data.get("configurations") or []
               if not (isinstance(c, dict) and c.get("name") == "drop")]
    if configs:
        data["configurations"] = configs
    else:
        data.pop("configurations", None)
    with open(yaml_path, "w") as f:
        yaml.dump(data, f)

    from brain.context_loader import load_workflow
    wf = load_workflow("deletable", workspace)
    assert [c.name for c in wf.configurations] == ["keep"]


def test_delete_last_configuration_removes_key_entirely(workspace):
    """Removing the final config drops the ``configurations:`` key
    so the yaml stays tidy (loader treats missing as empty)."""
    from ruamel.yaml import YAML
    _write_minimal_workflow(workspace, "last", """
name: last
preferred_backend: mock
configurations:
  - {name: only, backend: ollama, model: a}
""")
    yaml = YAML()
    yaml_path = workspace / "workflows" / "last" / "workflow.yaml"
    with open(yaml_path, "r") as f:
        data = yaml.load(f)
    configs = [c for c in data.get("configurations") or []
               if not (isinstance(c, dict) and c.get("name") == "only")]
    if configs:
        data["configurations"] = configs
    else:
        data.pop("configurations", None)
    with open(yaml_path, "w") as f:
        yaml.dump(data, f)

    new_text = yaml_path.read_text()
    assert "configurations" not in new_text
    from brain.context_loader import load_workflow
    wf = load_workflow("last", workspace)
    assert wf.configurations == []


@pytest.mark.asyncio
async def test_start_workflow_configuration_resolves_through_engine(workspace, tool_catalog):
    """``configuration="fast"`` looks up wf.configurations[name=='fast']
    and uses its backend+model. Per-call ``backend=`` / ``model=`` args
    still win over the configuration's values."""
    wf = Workflow(
        name="cfg-resolve",
        description="",
        preferred_backend="mock",
        preferred_model=None,
        configurations=[
            RunConfiguration(name="fast", backend="mock", model="llama3.2:3b"),
            RunConfiguration(name="smart", backend="mock", model="qwen3:8b"),
        ],
        max_steps=4,
        timeout_seconds=30,
        allowed_tools=AllowedTools(allowed=[], blocked=[]),
    )
    adapter = MockAdapter(script=[script_done("ok")])

    async def noop_tool_caller(*_a, **_kw):
        return ToolResult(status="ok", value={}, duration_ms=0)

    # Construct engine with the resolved values from the "fast"
    # configuration — mirrors what m_start_workflow does.
    picked = next(c for c in wf.configurations if c.name == "fast")
    engine = WorkflowEngine(
        workflow=wf, workspace_dir=workspace, adapter=adapter,
        tool_caller=noop_tool_caller, publish=lambda *a, **kw: None,
        bus_prefix="/brain/brain-1", tool_catalog=tool_catalog,
        backend=picked.backend, model_id=picked.model,
    )
    await engine.run()
    assert adapter.calls[0]["model"] == "llama3.2:3b"
    assert engine.record.backend == "mock"
    assert engine.record.model_id == "llama3.2:3b"


def test_set_default_configuration_copies_into_preferred(workspace):
    """set_default writes the picked config's backend + model into
    preferred_* — leaves the config entry in place."""
    from ruamel.yaml import YAML
    _write_minimal_workflow(workspace, "settable", """
name: settable
preferred_backend: mock
configurations:
  - {name: production, backend: anthropic, model: claude-opus-4-8}
""")
    yaml = YAML()
    yaml_path = workspace / "workflows" / "settable" / "workflow.yaml"
    with open(yaml_path, "r") as f:
        data = yaml.load(f)
    picked = next(
        c for c in data.get("configurations") or []
        if isinstance(c, dict) and c.get("name") == "production"
    )
    data["preferred_backend"] = picked["backend"]
    if picked.get("model"):
        data["preferred_model"] = picked["model"]
    with open(yaml_path, "w") as f:
        yaml.dump(data, f)

    from brain.context_loader import load_workflow
    wf = load_workflow("settable", workspace)
    assert wf.preferred_backend == "anthropic"
    assert wf.preferred_model == "claude-opus-4-8"
    assert len(wf.configurations) == 1  # config still present


# ─── conversation_session: keyword-only termination + multi-turn ──────
#
# Regression coverage for the bundled conversation_session workflow.
# The session must:
#   * run MANY listen/speak exchanges (NOT terminate after the first
#     speak — the old `terminate_on: speak` did exactly that and capped
#     the conversation at one reply);
#   * end as success ONLY when the operator says the exit keyword,
#     detected by the engine's exit_on_phrase watcher on the chat inbox;
#   * survive idle gaps — listen timeouts re-listen via loop_on_timeout
#     without consuming a model turn or a step.


def _bundled_conversation_session() -> Workflow:
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        return load_workflow("conversation_session", Path(td))


def _chat_tool_catalog():
    descriptors = [
        ToolDescriptor(
            topic="/chat/chat-1/control", action="listen",
            description="Listen for one operator utterance",
            parameters={"type": "object", "properties": {"timeout_seconds": {"type": "integer"}}, "required": []},
        ),
        ToolDescriptor(
            topic="/chat/chat-1/control", action="speak",
            description="Speak a reply",
            parameters={"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
        ),
    ]
    return {f"{d.topic}::{d.action}": d for d in descriptors}


def test_conversation_session_config_is_keyword_only():
    """Static guard: the bundled workflow's termination config is the
    keyword watcher, not a speak-counter."""
    wf = _bundled_conversation_session()
    assert wf.terminate_on == [], "terminate_on must be empty — it would end the session after the first speak"
    assert wf.exit_on_phrase is not None
    assert wf.exit_on_phrase.matches == ["goodbye"]
    assert wf.exit_on_phrase.case_insensitive is True
    assert wf.exit_on_phrase.whole_message is False
    assert wf.exit_on_phrase.listen_topic == "/chat/+/inbox"
    assert wf.loop_on_timeout is not None
    assert wf.loop_on_timeout.tool == "listen"
    assert wf.loop_on_timeout.field == "timeout"
    assert wf.loop_on_timeout.value is True


@pytest.mark.asyncio
async def test_conversation_session_multi_turn_until_keyword(workspace):
    """Many exchanges happen, and the run ends as success only via the
    exit_on_phrase watcher when 'goodbye' lands on the chat inbox."""
    from robotlab_x.runtime.bus import get_bus

    wf = _bundled_conversation_session()
    catalog = _chat_tool_catalog()

    # Strictly alternate listen/speak, far more turns than we'll use —
    # the keyword cancels us long before the script runs out (so a
    # script-exhaustion `done` can't masquerade as the keyword exit).
    script = []
    for i in range(20):
        script.append(script_call("/chat/chat-1/control", "listen", {"timeout_seconds": 8}, tool_call_id=f"l{i}"))
        script.append(script_call("/chat/chat-1/control", "speak", {"text": f"reply {i}"}, tool_call_id=f"s{i}"))
    adapter = MockAdapter(script=script)

    utterances = ["hello", "how are you", "tell me about cubes", "ok goodbye now"]
    speak_count = 0
    listen_count = 0

    async def tool_caller(topic, action, args):
        nonlocal speak_count, listen_count
        if action == "speak":
            speak_count += 1
            return ToolResult(status="ok", value={"spoken": args.get("text"), "ts": 0.0}, duration_ms=1)
        if action == "listen":
            idx = listen_count
            listen_count += 1
            text = utterances[idx] if idx < len(utterances) else "still here"
            # The operator's words travel on /chat/<id>/inbox exactly as
            # the real chat service publishes them — the same topic the
            # exit_on_phrase watcher subscribes to.
            get_bus().publish_local_only("/chat/chat-1/inbox", {"text": text, "ts": 0.0})
            # Yield so the watcher task can register (first turn) and then
            # observe the just-published message before we return.
            for _ in range(3):
                await asyncio.sleep(0)
            return ToolResult(status="ok", value={"text": text, "bearing": None, "timeout": False}, duration_ms=1)
        raise AssertionError(f"unexpected action {action!r}")

    def fake_publish(topic, payload, retained=False):
        pass

    engine = WorkflowEngine(
        workflow=wf, workspace_dir=workspace, adapter=adapter,
        tool_caller=tool_caller, publish=fake_publish,
        bus_prefix="/brain/brain-1", tool_catalog=catalog,
    )
    record = await engine.run()

    # Ended cleanly, and specifically via the keyword watcher (not the
    # script-exhaustion done, which would not name the phrase).
    assert record.status == "success", record.failure_reason
    summary = (record.result_summary or "").lower()
    assert "goodbye" in summary or "exit phrase" in summary, record.result_summary
    # Multi-turn proof: it kept replying past the first speak.
    assert speak_count >= 3, f"expected several replies before exit, got {speak_count}"
    # And it stopped at the keyword, not by running the script dry.
    assert adapter.script_remaining > 0, "should have cancelled mid-script via the keyword"


@pytest.mark.asyncio
async def test_conversation_session_loop_on_timeout_re_listens(workspace):
    """Idle listen timeouts re-dispatch silently: no model turn, no step
    consumed, the session waits patiently for the operator."""
    # Drop exit_on_phrase for THIS test so the scripted terminal ``done``
    # is allowed to end the run (phrase-terminated workflows now reject a
    # model ``done`` — see the done-guard tests). loop_on_timeout, the
    # behaviour under test, is retained.
    wf = _bundled_conversation_session().model_copy(update={"exit_on_phrase": None})
    catalog = _chat_tool_catalog()

    adapter = MockAdapter(script=[
        script_call("/chat/chat-1/control", "listen", {"timeout_seconds": 8}, tool_call_id="l0"),
        script_call("/chat/chat-1/control", "speak", {"text": "hi"}, tool_call_id="s0"),
        script_done("done"),
    ])

    calls = []
    timeouts_remaining = 3

    async def tool_caller(topic, action, args):
        nonlocal timeouts_remaining
        calls.append(action)
        if action == "listen":
            if timeouts_remaining > 0:
                timeouts_remaining -= 1
                return ToolResult(status="ok", value={"text": "", "bearing": None, "timeout": True}, duration_ms=1)
            return ToolResult(status="ok", value={"text": "hello", "bearing": None, "timeout": False}, duration_ms=1)
        return ToolResult(status="ok", value={"spoken": args.get("text")}, duration_ms=1)

    engine = WorkflowEngine(
        workflow=wf, workspace_dir=workspace, adapter=adapter,
        tool_caller=tool_caller, publish=lambda *a, **k: None,
        bus_prefix="/brain/brain-1", tool_catalog=catalog,
    )
    record = await engine.run()

    assert record.status == "success", record.failure_reason
    # 3 timeout re-dispatches + 1 real utterance = 4 listen tool calls...
    assert calls.count("listen") == 4, calls
    # ...but the model was only asked 3 times (listen, speak, done) —
    # re-dispatches never hit the adapter...
    assert len(adapter.calls) == 3, len(adapter.calls)
    # ...and the whole listen-with-redispatches counts as ONE step.
    assert record.steps_used == 3, record.steps_used


@pytest.mark.asyncio
async def test_conversation_session_model_done_is_honest_failure_no_tools(workspace):
    """A model-emitted ``done`` must NOT end a phrase-terminated workflow
    as a 0-work success. With no live tools (conversation service down),
    the model narrates its calls as text → parses as done → the engine
    fails honestly and names the likely cause."""
    wf = _bundled_conversation_session()
    adapter = MockAdapter(script=[script_done("Hello! How can I help you today?")])

    async def tool_caller(*_a, **_k):
        raise AssertionError("no tool should be called on an immediate done")

    engine = WorkflowEngine(
        workflow=wf, workspace_dir=workspace, adapter=adapter,
        tool_caller=tool_caller, publish=lambda *a, **k: None,
        bus_prefix="/brain/brain-1", tool_catalog={},  # nothing live → 0 tools offered
    )
    record = await engine.run()

    assert record.status == "failure", f"expected failure, got {record.status}"
    reason = record.failure_reason or ""
    assert "exit phrase" in reason, reason
    assert "conversation service" in reason, reason
    assert record.steps_used == 1


@pytest.mark.asyncio
async def test_conversation_session_model_done_failure_when_tools_offered(workspace):
    """Same guard, but tools WERE offered — so the hint points at the
    model not tool-calling rather than a missing service."""
    wf = _bundled_conversation_session()
    adapter = MockAdapter(script=[script_done("done")])

    async def tool_caller(*_a, **_k):
        raise AssertionError("no tool should be called")

    engine = WorkflowEngine(
        workflow=wf, workspace_dir=workspace, adapter=adapter,
        tool_caller=tool_caller, publish=lambda *a, **k: None,
        bus_prefix="/brain/brain-1", tool_catalog=_chat_tool_catalog(),
    )
    record = await engine.run()

    assert record.status == "failure", record.status
    assert "exit phrase" in (record.failure_reason or "")
    assert "tool-calling" in (record.failure_reason or "")


@pytest.mark.asyncio
async def test_clear_runs_removes_completed_keeps_active(workspace):
    """clear_runs deletes finished run dirs under workspace/runs/ but
    skips any run still tracked as active (by trailing run_id), and
    ignores non-dir entries."""
    from types import SimpleNamespace
    from brain.service import BrainService

    runs = workspace / "runs"
    names = [
        "2026-06-21T00-00-00-conv_copy-aaaa1111",
        "2026-06-21T00-00-01-conv_copy-bbbb2222",
        "2026-06-21T00-00-02-observe_room-cccc3333",
        "2026-06-21T00-00-03-conv_copy-dddd4444",   # this one is "active"
    ]
    for n in names:
        (runs / n).mkdir(parents=True)
        (runs / n / "summary.json").write_text("{}")
    (runs / "stray.txt").write_text("not a run dir")

    fake = SimpleNamespace(_workspace=workspace, _runs={"dddd4444": object()})
    res = await BrainService.m_clear_runs(fake)

    assert res == {"removed": 3, "skipped_active": 1, "errors": 0}
    remaining = sorted(p.name for p in runs.iterdir())
    assert remaining == ["2026-06-21T00-00-03-conv_copy-dddd4444", "stray.txt"]


@pytest.mark.asyncio
async def test_clear_runs_empty_dir_is_noop(workspace):
    from types import SimpleNamespace
    from brain.service import BrainService
    fake = SimpleNamespace(_workspace=workspace, _runs={})
    res = await BrainService.m_clear_runs(fake)
    assert res == {"removed": 0, "skipped_active": 0, "errors": 0}
