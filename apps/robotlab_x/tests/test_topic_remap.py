# unmanaged
"""ROS-style topic remap tests.

Verifies:
  * publish honours topic_remap (outgoing wire path is rewritten)
  * subscribe honours topic_remap (incoming subscription listens on
    the substitute topic)
  * Empty / missing remap is a no-op (back-compat)
  * Remap survives merge_dict round-trip (persistence shape)
"""
from __future__ import annotations

import asyncio
from typing import Any, Dict, List

import pytest

from rlx_bus import ServiceConfig
from robotlab_x.framework.service import Service, ServiceMetadata
from robotlab_x.runtime.bus import Bus


class _Spy(Service):
    """Minimal Service subclass for testing publish/subscribe wiring."""


def _meta() -> ServiceMetadata:
    return ServiceMetadata(
        proxy_id="spy-1",
        service_meta_id="spy@1.0.0",
        type_name="spy",
        type_version="1.0.0",
        tags=[],
        singleton=False,
    )


@pytest.fixture
def fresh_bus(monkeypatch):
    """Replace the module-level bus singleton with a clean per-test
    instance so subscribers don't bleed across tests."""
    bus = Bus()
    from robotlab_x.runtime import bus as bus_mod
    monkeypatch.setattr(bus_mod, "_default_bus", bus)
    return bus


# ─────────────────────────────────────────────────────────────────────
# resolve_topic
# ─────────────────────────────────────────────────────────────────────


def test_resolve_topic_no_remap_returns_input():
    svc = _Spy(_meta(), {})
    assert svc.resolve_topic("/spy/spy-1/state") == "/spy/spy-1/state"


def test_resolve_topic_applies_exact_match():
    svc = _Spy(_meta(), {"topic_remap": {"/spy/spy-1/state": "/global/state"}})
    assert svc.resolve_topic("/spy/spy-1/state") == "/global/state"
    # Non-matching key passes through unchanged
    assert svc.resolve_topic("/spy/spy-1/heartbeat") == "/spy/spy-1/heartbeat"


def test_resolve_topic_does_not_recurse():
    """Cyclic remap doesn't hang — only one substitution per call."""
    svc = _Spy(_meta(), {"topic_remap": {"/a": "/b", "/b": "/a"}})
    assert svc.resolve_topic("/a") == "/b"
    assert svc.resolve_topic("/b") == "/a"  # NOT /b again


def test_resolve_topic_handles_non_dict_remap():
    """Defensive: if somebody hands us a non-dict remap (bad migration
    or stale serialized config), don't crash — just no-op."""
    svc = _Spy(_meta(), {})
    # Force-set a malformed remap on the live config
    object.__setattr__(svc.config, "topic_remap", "not a dict")
    assert svc.resolve_topic("/x") == "/x"


# ─────────────────────────────────────────────────────────────────────
# publish honours remap
# ─────────────────────────────────────────────────────────────────────


def test_publish_routes_through_remap(fresh_bus):
    svc = _Spy(_meta(), {"topic_remap": {"/spy/spy-1/state": "/external/state"}})

    captured: List[Any] = []
    # Subscribe to the REMAPPED topic (not the conceptual one)
    async def consume():
        async for msg in fresh_bus.subscribe("/external/state", "test-listener"):
            captured.append(msg.payload)
            return

    loop = asyncio.new_event_loop()
    try:
        task = loop.create_task(consume())
        # Give the subscription a chance to register
        loop.run_until_complete(asyncio.sleep(0.01))
        svc.publish("state", {"v": 42})
        loop.run_until_complete(asyncio.wait_for(task, timeout=1.0))
    finally:
        loop.close()

    assert captured == [{"v": 42}]
    # And the original topic should have NOTHING — subscriber count zero
    assert fresh_bus.subscriber_count("/spy/spy-1/state") == 0


def test_publish_without_remap_uses_conceptual_topic(fresh_bus):
    """Sanity: turning the feature off (empty remap) preserves prior behaviour."""
    svc = _Spy(_meta(), {})

    captured: List[Any] = []
    async def consume():
        async for msg in fresh_bus.subscribe("/spy/spy-1/state", "test-listener"):
            captured.append(msg.payload)
            return

    loop = asyncio.new_event_loop()
    try:
        task = loop.create_task(consume())
        loop.run_until_complete(asyncio.sleep(0.01))
        svc.publish("state", {"v": 1})
        loop.run_until_complete(asyncio.wait_for(task, timeout=1.0))
    finally:
        loop.close()
    assert captured == [{"v": 1}]


# ─────────────────────────────────────────────────────────────────────
# subscribe_iter honours remap
# ─────────────────────────────────────────────────────────────────────


def test_subscribe_iter_listens_on_remapped_topic(fresh_bus):
    """The service code says 'subscribe to control' but the user
    remapped /spy/spy-1/control → /external/control. Publishing to the
    REMAPPED topic should reach the service."""
    svc = _Spy(_meta(), {"topic_remap": {"/spy/spy-1/control": "/external/control"}})

    captured: List[Any] = []
    async def consume():
        async for msg in svc.subscribe_iter("control"):
            captured.append(msg.payload)
            return

    loop = asyncio.new_event_loop()
    try:
        task = loop.create_task(consume())
        loop.run_until_complete(asyncio.sleep(0.01))
        # Publish to the EXTERNAL (remapped) topic — should reach svc
        fresh_bus.publish_sync("/external/control", {"action": "go"})
        loop.run_until_complete(asyncio.wait_for(task, timeout=1.0))
    finally:
        loop.close()

    assert captured == [{"action": "go"}]


# ─────────────────────────────────────────────────────────────────────
# persistence shape — merge_dict round-trip
# ─────────────────────────────────────────────────────────────────────


def test_topic_remap_merges_via_merge_dict():
    """The persistence path uses ServiceConfig.merge_dict (e.g. servo's
    m_attach call). topic_remap must survive a partial update without
    being clobbered."""
    cfg = ServiceConfig(topic_remap={"/a": "/b"})
    updated = cfg.merge_dict({"some_field": 7})
    assert updated.topic_remap == {"/a": "/b"}


def test_topic_remap_can_be_replaced_via_merge_dict():
    cfg = ServiceConfig(topic_remap={"/a": "/b"})
    updated = cfg.merge_dict({"topic_remap": {"/x": "/y"}})
    assert updated.topic_remap == {"/x": "/y"}
