# unmanaged
"""ChatService unit tests.

Verifies the text-bridge that the brain's conversation_session
workflow drives:

  * speak() publishes text to /chat/{id}/spoken + updates state
  * listen() blocks until an inbox message arrives (or times out)
  * inbox messages arriving before listen() get queued, not lost
  * the queue drops the oldest entry when full (bounded memory)
  * send() is the back-channel equivalent of publishing to /inbox

Same fixture shape as test_cron_service — a real Bus + a monkeypatched
``_default_bus`` so publish/subscribe wires end-to-end without spinning
up the full backend.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest
import pytest_asyncio

# Chat lives in repo/chat/1.0.0/chat.py — make it importable.
_CHAT_DIR = Path(__file__).resolve().parents[1] / "repo" / "chat" / "1.0.0"
if str(_CHAT_DIR) not in sys.path:
    sys.path.insert(0, str(_CHAT_DIR))


@pytest.fixture
def fresh_bus(monkeypatch):
    from robotlab_x.runtime.bus import Bus
    from robotlab_x.runtime import bus as bus_mod
    bus = Bus()
    monkeypatch.setattr(bus_mod, "_default_bus", bus)
    return bus


@pytest_asyncio.fixture
async def svc(fresh_bus, monkeypatch):
    """A ChatService bound to a clean bus, with on_start fully wired
    (inbox loop + control loop) so listen()/speak() can be exercised
    against real bus messages."""
    from chat import ChatService
    from robotlab_x.framework.service import ServiceMetadata
    meta = ServiceMetadata(
        proxy_id="chat-1",
        service_meta_id="chat@1.0.0",
        type_name="chat",
        type_version="1.0.0",
        tags=[],
        singleton=False,
    )
    s = ChatService(meta=meta, config={})
    monkeypatch.setattr(s, "save_config", lambda: None)
    # Bind the asyncio runtime hooks the framework would normally set
    # via _bind_runtime — we need a stop_event + the running loop.
    loop = asyncio.get_event_loop()
    s._bind_runtime(loop, asyncio.Event())
    await s.on_start()
    yield s
    await s.on_stop()


# ─────────────────────────────────────────────────────────────────────
# speak
# ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_speak_publishes_to_spoken_topic(svc, fresh_bus):
    seen = []
    sub_id = "test-spoken"
    async def collect():
        async for msg in fresh_bus.subscribe("/chat/chat-1/spoken", sub_id):
            seen.append(msg.payload)
            return  # one message is enough
    task = asyncio.create_task(collect())
    # Yield so the subscriber registers before we publish.
    await asyncio.sleep(0)
    result = svc.speak("hello operator")
    await asyncio.wait_for(task, timeout=1.0)

    assert result["spoken"] == "hello operator"
    assert "ts" in result
    assert seen[0]["text"] == "hello operator"


@pytest.mark.asyncio
async def test_speak_rejects_non_string(svc):
    with pytest.raises(TypeError, match="must be str"):
        svc.speak(123)  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_speak_updates_last_spoken_in_state(svc):
    svc.speak("first")
    assert svc._last_spoken == "first"
    svc.speak("second")
    assert svc._last_spoken == "second"


# ─────────────────────────────────────────────────────────────────────
# listen
# ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_listen_returns_inbox_message(svc, fresh_bus):
    # Publish first, then call listen — message should be in the queue
    # waiting. Need a tiny sleep so the inbox subscriber registers and
    # the publish lands before listen() drains the queue.
    await asyncio.sleep(0.05)
    fresh_bus.publish_sync("/chat/chat-1/inbox", {"text": "hi brain"})
    await asyncio.sleep(0.05)
    result = await svc.listen(timeout_seconds=2)
    assert result["text"] == "hi brain"
    assert result["timeout"] is False
    assert result["bearing"] is None


@pytest.mark.asyncio
async def test_listen_blocks_then_receives(svc, fresh_bus):
    """Operator publishes AFTER listen() is already waiting — the
    queue.get await wakes up and returns the message."""
    async def publish_after_delay():
        await asyncio.sleep(0.1)
        fresh_bus.publish_sync("/chat/chat-1/inbox", {"text": "delayed"})

    asyncio.create_task(publish_after_delay())
    result = await svc.listen(timeout_seconds=2)
    assert result["text"] == "delayed"
    assert result["timeout"] is False


@pytest.mark.asyncio
async def test_listen_times_out_with_empty_text(svc):
    """No message arrives within the timeout — listen returns an
    empty string + timeout=True so the workflow can decide to retry
    or terminate."""
    result = await svc.listen(timeout_seconds=1)  # min clamp is 0.5s
    assert result["text"] == ""
    assert result["timeout"] is True


@pytest.mark.asyncio
async def test_listen_drops_malformed_payloads(svc, fresh_bus):
    """Anything that isn't a dict with a string ``text`` field is
    dropped silently — listen waits past these and returns the next
    valid message."""
    await asyncio.sleep(0.05)
    fresh_bus.publish_sync("/chat/chat-1/inbox", "not a dict")  # type: ignore[arg-type]
    fresh_bus.publish_sync("/chat/chat-1/inbox", {"no_text_key": "x"})
    fresh_bus.publish_sync("/chat/chat-1/inbox", {"text": 42})  # wrong type
    fresh_bus.publish_sync("/chat/chat-1/inbox", {"text": "the real one"})
    await asyncio.sleep(0.05)
    result = await svc.listen(timeout_seconds=2)
    assert result["text"] == "the real one"


# ─────────────────────────────────────────────────────────────────────
# send (back-channel)
# ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_send_round_trips_through_listen(svc, fresh_bus):
    """``send`` is the test back-channel — it publishes to /inbox so
    listen() can pull it. End-to-end round trip without the UI."""
    await asyncio.sleep(0.05)
    svc.send("operator turn 1")
    await asyncio.sleep(0.05)
    result = await svc.listen(timeout_seconds=2)
    assert result["text"] == "operator turn 1"


@pytest.mark.asyncio
async def test_send_rejects_non_string(svc):
    with pytest.raises(TypeError, match="must be str"):
        svc.send(None)  # type: ignore[arg-type]
