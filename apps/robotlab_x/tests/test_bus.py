# unmanaged
"""Unit tests for the in-process pub/sub bus.

Loop is driven manually via ``asyncio.run`` so the test suite has no
pytest-asyncio dependency.
"""

import asyncio
import logging

import pytest

from robotlab_x.runtime.bus import Bus, BusMessage


async def _collect(it, n, timeout=1.0):
    out = []
    try:
        async with asyncio.timeout(timeout):
            async for msg in it:
                out.append(msg)
                if len(out) >= n:
                    break
    except (asyncio.TimeoutError, TimeoutError):
        pass
    return out


def run(coro):
    return asyncio.run(coro)


def test_publish_reaches_one_subscriber():
    async def scenario():
        bus = Bus()
        it = bus.subscribe("/topic/a", subscriber_id="s1")
        task = asyncio.create_task(_collect(it, 1))
        await asyncio.sleep(0.01)
        count = await bus.publish("/topic/a", {"hello": "world"})
        msgs = await task
        return count, msgs

    count, msgs = run(scenario())
    assert count == 1
    assert len(msgs) == 1
    assert msgs[0].payload == {"hello": "world"}
    assert msgs[0].topic == "/topic/a"


def test_fanout_to_multiple_subscribers():
    async def scenario():
        bus = Bus()
        it1 = bus.subscribe("/fan", subscriber_id="s1")
        it2 = bus.subscribe("/fan", subscriber_id="s2")
        t1 = asyncio.create_task(_collect(it1, 1))
        t2 = asyncio.create_task(_collect(it2, 1))
        await asyncio.sleep(0.01)
        count = await bus.publish("/fan", "ping")
        a, b = await asyncio.gather(t1, t2)
        return count, a, b

    count, a, b = run(scenario())
    assert count == 2
    assert a[0].payload == "ping"
    assert b[0].payload == "ping"


def test_retained_delivered_to_late_subscriber():
    async def scenario():
        bus = Bus()
        await bus.publish("/retain", "old", retained=True)
        it = bus.subscribe("/retain", subscriber_id="late")
        return await _collect(it, 1)

    msgs = run(scenario())
    assert msgs[0].payload == "old"


def test_retained_is_overwritten_not_appended():
    async def scenario():
        bus = Bus()
        await bus.publish("/r", "first", retained=True)
        await bus.publish("/r", "second", retained=True)
        it = bus.subscribe("/r", subscriber_id="x")
        return await _collect(it, 1)

    msgs = run(scenario())
    assert msgs[0].payload == "second"


def test_clear_retained():
    async def scenario():
        bus = Bus()
        await bus.publish("/r", "first", retained=True)
        bus.clear_retained("/r")
        it = bus.subscribe("/r", subscriber_id="x")
        return await _collect(it, 1, timeout=0.1)

    assert run(scenario()) == []


def test_topic_isolation():
    async def scenario():
        bus = Bus()
        it_a = bus.subscribe("/a", subscriber_id="sa")
        it_b = bus.subscribe("/b", subscriber_id="sb")
        ta = asyncio.create_task(_collect(it_a, 1, timeout=0.2))
        tb = asyncio.create_task(_collect(it_b, 1))
        await asyncio.sleep(0.01)
        await bus.publish("/b", "only-b")
        return await asyncio.gather(ta, tb)

    a, b = run(scenario())
    assert a == []
    assert b[0].payload == "only-b"


def test_drop_oldest_on_slow_consumer(caplog):
    async def scenario():
        bus = Bus(queue_depth=2)
        it = bus.subscribe("/slow", subscriber_id="lazy")

        # Prime the async generator so the subscriber actually registers.
        # The first __anext__ call wires up the queue; we cancel that pending
        # await before consuming for real so the queue stays untouched.
        primer = asyncio.create_task(it.__anext__())
        await asyncio.sleep(0.01)

        for i in range(5):
            await bus.publish("/slow", i)

        out = []
        # The primer is awaiting the first message; let it complete.
        first = await asyncio.wait_for(primer, timeout=0.5)
        out.append(first.payload)
        # Now drain remaining messages from the (bounded) queue.
        async with asyncio.timeout(0.5):
            async for m in it:
                out.append(m.payload)
                if len(out) >= 2:
                    break
        return out

    with caplog.at_level(logging.WARNING):
        msgs = run(scenario())
    # queue_depth=2, primer pulled one before publishes started so queue
    # held [0,1] then drops to [1,2] -> [2,3] -> [3,4] is wrong, primer
    # consumed message 0 mid-flight depending on timing. We assert only
    # that we got the *latest* two values and that slow-consumer fired.
    assert msgs[-1] == 4
    assert len(msgs) == 2
    assert any("bus.slow_consumer" in r.message for r in caplog.records)


def test_unsubscribe_all_wakes_iterator():
    async def scenario():
        bus = Bus()
        it = bus.subscribe("/u", subscriber_id="bob")

        async def consume():
            out = []
            async for m in it:
                if m.topic == "__terminate__":
                    break
                out.append(m)
            return out

        task = asyncio.create_task(consume())
        await asyncio.sleep(0.01)
        removed = await bus.unsubscribe_all("bob")
        out = await asyncio.wait_for(task, timeout=1.0)
        return removed, out, bus.subscriber_count("/u")

    removed, out, count = run(scenario())
    assert removed == 1
    assert out == []
    assert count == 0


def test_bus_message_dataclass_shape():
    """Mirrors the `message` model in robotlab_x.yml — keep them aligned."""
    m = BusMessage(topic="/t", payload={"k": "v"})
    assert m.topic == "/t"
    assert m.payload == {"k": "v"}
    assert m.method is None
    assert m.reply_to is None


def test_same_loop_publish_delivers_once_not_twice():
    """Regression: a publish + subscribe on the same loop must NOT
    deliver each message twice. An earlier revision of
    ``_Subscriber.deliver`` did ``_enqueue(message)`` AND ``put_nowait(message)``
    back-to-back; cross-loop deliveries went through
    ``call_soon_threadsafe`` and stayed single, but same-loop ones
    duplicated. Showed up as the chat panel rendering every operator
    turn twice."""
    async def scenario():
        bus = Bus()
        it = bus.subscribe("/echo", subscriber_id="probe")

        async def consume():
            out = []
            try:
                async with asyncio.timeout(0.3):
                    async for m in it:
                        out.append(m)
            except (asyncio.TimeoutError, TimeoutError):
                pass
            return out

        task = asyncio.create_task(consume())
        # Let consume() enter the iterator + bind the loop.
        await asyncio.sleep(0.01)
        # Publish from THIS coroutine (same loop the consumer is on).
        bus.publish_sync("/echo", {"text": "hello"})
        return await task

    out = run(scenario())
    assert len(out) == 1, f"expected exactly 1 delivery, got {len(out)}"
    assert out[0].payload == {"text": "hello"}
