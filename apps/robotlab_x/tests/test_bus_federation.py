# unmanaged
"""Step 2a tests — bus-side ``@<id>`` suffix parsing + routing decisions.

Verifies:
  * parse_id_suffix() shape: returns (base, peer_id|None) per the
    [a-z][a-z0-9-]{1,62} grammar.
  * publish to ``/foo@<local-id>`` strips suffix and delivers locally
  * publish to ``/foo@<peer-id>`` routes through peer_manager.publish_remote
    and does NOT touch local subscribers
  * subscribe to ``/foo@<local-id>`` strips suffix
  * subscribe to ``/foo@<peer-id>`` keeps suffix locally AND notifies
    peer_manager.on_local_subscribe
  * Unsubscribe (last consumer gone) notifies on_local_unsubscribe
  * Bad suffixes (uppercase, spaces, special chars) are NOT treated as
    federation addresses — they pass through as literal topic strings
"""
from __future__ import annotations

import asyncio
from typing import Any, List

import pytest

from robotlab_x.runtime.bus import Bus, parse_id_suffix
from robotlab_x.runtime import peer_manager


@pytest.fixture(autouse=True)
def _reset_peer_manager() -> None:
    """Stub peer_manager records into module-level lists; clear them
    between tests."""
    peer_manager.reset_for_tests()
    yield
    peer_manager.reset_for_tests()


@pytest.fixture
def bus_with_id() -> Bus:
    """Fresh bus, local id set to 'witty-gizmo' (no global state)."""
    b = Bus()
    b.set_local_id("witty-gizmo")
    return b


# ─────────────────────────────────────────────────────────────────────
# parse_id_suffix
# ─────────────────────────────────────────────────────────────────────


def test_parse_no_suffix_returns_none():
    assert parse_id_suffix("/foo/bar") == ("/foo/bar", None)


def test_parse_well_formed_suffix():
    assert parse_id_suffix("/foo@silly-droid") == ("/foo", "silly-droid")


def test_parse_handles_topic_segments():
    assert parse_id_suffix("/servo/servo-1/state@silly-droid") == (
        "/servo/servo-1/state", "silly-droid",
    )


def test_parse_rejects_bad_suffix_format():
    """If the suffix doesn't match the id grammar, the @ is treated as
    a literal — the caller gets the topic unchanged so they're aware
    something's off rather than getting a silent wrong-routing."""
    # Uppercase
    assert parse_id_suffix("/foo@BAD") == ("/foo@BAD", None)
    # Spaces
    assert parse_id_suffix("/foo@bad id") == ("/foo@bad id", None)
    # Empty suffix
    assert parse_id_suffix("/foo@") == ("/foo@", None)


def test_parse_rpartition_handles_embedded_at():
    """If a topic legitimately contains @, only the FINAL @-suffix is
    considered. Earlier @s pass through verbatim."""
    assert parse_id_suffix("/email/user@example.com@silly-droid") == (
        "/email/user@example.com", "silly-droid",
    )


def test_parse_rejects_non_string():
    assert parse_id_suffix(None) == (None, None)        # type: ignore[arg-type]
    assert parse_id_suffix(123) == (123, None)          # type: ignore[arg-type]


# ─────────────────────────────────────────────────────────────────────
# Publish — self-id strips, peer-id routes
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_publish_self_id_strips_and_delivers_local(bus_with_id):
    """Publishing to /foo@witty-gizmo on witty-gizmo should hit any
    local subscriber on /foo as if no suffix was there."""
    captured: List[Any] = []
    async def consume():
        async for msg in bus_with_id.subscribe("/foo", "test-listener"):
            captured.append(msg.payload)
            return

    loop = asyncio.get_running_loop()
    task = loop.create_task(consume())
    await asyncio.sleep(0.01)
    delivered = bus_with_id.publish_sync("/foo@witty-gizmo", {"x": 1})
    await asyncio.wait_for(task, timeout=1.0)

    assert captured == [{"x": 1}]
    assert delivered == 1
    # Peer manager NOT involved — self-id routes locally
    assert peer_manager.pending_publishes() == []


def test_publish_peer_id_routes_to_peer_manager(bus_with_id):
    """Publishing to /foo@silly-droid (NOT our id) must NOT touch
    local subscribers. Without a connected peer, returns 0 and no
    retained state lands locally — the remote bus owns retained
    payloads for remote topics."""
    delivered = bus_with_id.publish_sync(
        "/foo@silly-droid", {"v": 42}, retained=True,
    )
    # No peer connected → publish_remote returns 0 (delivered to nobody)
    assert delivered == 0
    # Nothing landed in the local retained map under either form
    assert not bus_with_id.has_retained("/foo@silly-droid")
    assert not bus_with_id.has_retained("/foo")


def test_publish_unsuffixed_topic_unchanged(bus_with_id):
    """Topics without an @-suffix go through the existing path with no
    federation involvement."""
    bus_with_id.publish_sync("/foo", {"v": 1}, retained=True)
    assert bus_with_id.has_retained("/foo")
    assert peer_manager.pending_publishes() == []


# ─────────────────────────────────────────────────────────────────────
# Subscribe — self-id strips, peer-id keeps suffix + notifies
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_subscribe_self_id_strips(bus_with_id):
    """Subscribing to /foo@witty-gizmo on witty-gizmo is equivalent to
    subscribing to /foo — the bus stores the subscription under the
    stripped topic and a local publish to /foo reaches it."""
    captured: List[Any] = []
    async def consume():
        async for msg in bus_with_id.subscribe("/foo@witty-gizmo", "test"):
            captured.append(msg.payload)
            return

    task = asyncio.get_running_loop().create_task(consume())
    await asyncio.sleep(0.01)
    bus_with_id.publish_sync("/foo", {"v": "ok"})
    await asyncio.wait_for(task, timeout=1.0)
    assert captured == [{"v": "ok"}]
    # No peer-manager notification for self-id
    assert peer_manager.open_subscriptions() == {}


@pytest.mark.asyncio
async def test_subscribe_peer_id_keeps_suffix_and_notifies(bus_with_id):
    """Subscribing to /foo@silly-droid registers locally under the
    suffixed name AND fires on_local_subscribe so the manager can
    open the upstream connection."""
    async def consume():
        async for msg in bus_with_id.subscribe("/foo@silly-droid", "test"):
            return msg

    task = asyncio.get_running_loop().create_task(consume())
    # Wait briefly for the subscribe coroutine to register the sub.
    await asyncio.sleep(0.02)
    opens = peer_manager.open_subscriptions()
    assert opens == {"silly-droid": {"/foo"}}
    # Subscriber count is on the SUFFIXED topic — that's the local view
    assert bus_with_id.subscriber_count("/foo@silly-droid") == 1
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


@pytest.mark.asyncio
async def test_unsubscribe_last_listener_notifies(bus_with_id):
    """When the last local listener on /foo@silly-droid drops, the
    peer manager should be told to close the upstream subscription."""
    async def consume():
        async for _ in bus_with_id.subscribe("/foo@silly-droid", "test"):
            return

    task = asyncio.get_running_loop().create_task(consume())
    await asyncio.sleep(0.02)
    assert peer_manager.open_subscriptions() == {"silly-droid": {"/foo"}}

    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    # Final block of subscribe() runs the unsubscribe hook
    await asyncio.sleep(0.02)
    assert peer_manager.open_subscriptions() == {}


# ─────────────────────────────────────────────────────────────────────
# Local id not set → suffixes pass through as literal topics
# ─────────────────────────────────────────────────────────────────────


def test_without_local_id_self_routing_disabled():
    """If set_local_id hasn't been called yet (very early boot), the
    suffix logic still parses but no topic matches 'self' — so
    /foo@anything routes to the peer_manager. With no connected
    peer, that delivers to nobody (returns 0). Documents the
    boot-ordering contract: federation routing is deferred until
    set_local_id runs."""
    b = Bus()
    # No set_local_id
    delivered = b.publish_sync("/foo@witty-gizmo", {"v": 1})
    assert delivered == 0
    # And it did NOT deliver locally — no /foo subscriber would have
    # been hit; we don't even check because nothing is subscribed.
    assert not b.has_retained("/foo")
    assert not b.has_retained("/foo@witty-gizmo")
