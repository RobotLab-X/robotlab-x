# unmanaged
"""Unit tests for rlx_input — the shared keyboard capability.

Covers the canonical key-event schema + keymap matching (pure functions in
rlx_input.events) and KeyboardServiceBase's event ingestion, pressed-set
tracking, and keymap → bus-action dispatch (via a tiny concrete subclass +
a FakeBus). No OS hooks or browser involved.
"""
from __future__ import annotations

from typing import Any, Dict, List

import pytest

from rlx_input import (
    KeyboardServiceBase,
    binding_matches,
    event_matches,
    make_event,
    normalize_combo,
    normalize_event,
)


# ─────────────────────────────────────────────────────────────────────
# events.py — pure schema + matching
# ─────────────────────────────────────────────────────────────────────
def test_make_event_normalizes():
    ev = make_event("down", key="W", code="KeyW", modifiers={"ctrl": True}, repeat=True, ts=5.0, source="browser")
    assert ev["type"] == "down"
    assert ev["modifiers"] == {"ctrl": True, "alt": False, "shift": False, "meta": False}
    assert ev["repeat"] is True and ev["source"] == "browser"
    # unknown type coerces to "down"; "up" stays "up"
    assert make_event("up")["type"] == "up"
    assert make_event("weird")["type"] == "down"


def test_normalize_combo():
    assert normalize_combo("ctrl+shift+KeyS") == ({"ctrl", "shift"}, "keys")
    assert normalize_combo("KeyW") == (set(), "keyw")
    assert normalize_combo("") == (set(), "")


def test_event_matches_exact_modifiers():
    ev = make_event("down", key="s", code="KeyS", modifiers={"ctrl": True})
    mods, key = normalize_combo("ctrl+KeyS")
    assert event_matches(ev, mods, key) is True
    # matches on logical key too
    assert event_matches(ev, *normalize_combo("ctrl+s")) is True
    # exact modifiers: ctrl+shift+s must NOT fire ctrl+s
    mods2, key2 = normalize_combo("ctrl+shift+KeyS")
    assert event_matches(ev, mods2, key2) is False
    # plain w (no mods) must not fire when ctrl is held
    ctrl_w = make_event("down", code="KeyW", modifiers={"ctrl": True})
    assert event_matches(ctrl_w, *normalize_combo("KeyW")) is False


def test_binding_matches():
    ev = make_event("down", code="KeyW")
    assert binding_matches(ev, {"combo": "KeyW"}) is True
    assert binding_matches(ev, {"combo": "KeyA"}) is False


# ─────────────────────────────────────────────────────────────────────
# KeyboardServiceBase — ingestion + keymap dispatch
# ─────────────────────────────────────────────────────────────────────
class _FakeBus:
    def __init__(self) -> None:
        self.published: List[Dict[str, Any]] = []

    async def publish(self, topic: str, payload: Any, *, retained: bool = False) -> None:
        self.published.append({"topic": topic, "payload": payload, "retained": retained})

    async def subscribe(self, topic: str, handler):  # pragma: no cover - unused here
        pass

    def by_topic_suffix(self, suffix: str) -> List[Dict[str, Any]]:
        return [m for m in self.published if m["topic"].endswith(suffix)]

    def to_topic(self, topic: str) -> List[Dict[str, Any]]:
        return [m for m in self.published if m["topic"] == topic]


class _TestKeyboard(KeyboardServiceBase):
    """Concrete subclass with no-op capture hooks for unit testing."""
    source = "local"

    def __init__(self, proxy_id, bus) -> None:
        super().__init__(proxy_id, bus)
        self.started = 0
        self.stopped = 0

    async def _start_capture_backend(self) -> None:
        self.started += 1

    async def _stop_capture_backend(self) -> None:
        self.stopped += 1


@pytest.fixture
def kb(monkeypatch):
    svc = _TestKeyboard("kb-test", _FakeBus())
    # update_config writes through the bus normally — short-circuit to a
    # recorder that mutates the in-memory config (mirrors the arduino tests).
    async def _record_update(patch):
        for k, v in patch.items():
            setattr(svc.config, k, v)
    monkeypatch.setattr(svc, "update_config", _record_update)
    return svc


def test_config_defaults(kb):
    assert kb.config.capturing is False
    assert kb.config.scope == "card"
    assert kb.config.suppress is False
    assert kb.config.bindings == []


@pytest.mark.asyncio
async def test_handle_event_tracks_pressed(kb):
    await kb.handle_event({"type": "down", "code": "KeyW", "ts": 1.0})
    assert "keyw" in kb._snapshot()["pressed"]
    await kb.handle_event({"type": "up", "code": "KeyW", "ts": 1.1})
    assert kb._snapshot()["pressed"] == []
    # state was republished on the transitions
    assert kb.bus.by_topic_suffix("/state")


@pytest.mark.asyncio
async def test_autorepeat_ignored_for_pressed(kb):
    await kb.handle_event({"type": "down", "code": "KeyW", "repeat": True, "ts": 1.0})
    # repeat-only down before a real down should not add to pressed
    assert kb._snapshot()["pressed"] == []


@pytest.mark.asyncio
async def test_keymap_dispatch_publishes_bound_messages(kb):
    kb.config.bindings = [{
        "id": "fwd", "combo": "KeyW", "topic": "/motor_control/mc-1/control",
        "on_down": {"action": "set", "channel": "drive", "value": 1},
        "on_up": {"action": "set", "channel": "drive", "value": 0},
    }]
    await kb.handle_event({"type": "down", "code": "KeyW", "ts": 1.0})
    sent = kb.bus.to_topic("/motor_control/mc-1/control")
    assert sent and sent[-1]["payload"] == {"action": "set", "channel": "drive", "value": 1}
    await kb.handle_event({"type": "up", "code": "KeyW", "ts": 1.1})
    assert kb.bus.to_topic("/motor_control/mc-1/control")[-1]["payload"]["value"] == 0


@pytest.mark.asyncio
async def test_keymap_ignores_autorepeat(kb):
    kb.config.bindings = [{"id": "fwd", "combo": "KeyW", "topic": "/t",
                           "on_down": {"v": 1}, "on_up": {"v": 0}}]
    await kb.handle_event({"type": "down", "code": "KeyW", "repeat": True, "ts": 1.0})
    assert kb.bus.to_topic("/t") == []  # auto-repeat doesn't re-fire the action


@pytest.mark.asyncio
async def test_stop_capture_fires_all_stop(kb):
    kb.config.bindings = [
        {"id": "fwd", "combo": "KeyW", "topic": "/drive", "on_down": {"v": 1}, "on_up": {"v": 0}},
        {"id": "turn", "combo": "KeyA", "topic": "/turn", "on_down": {"v": 1}, "on_up": {"v": 0}},
    ]
    await kb.m_start_capture()
    assert kb.started == 1 and kb._capturing is True
    await kb.handle_event({"type": "down", "code": "KeyW", "ts": 1.0})
    await kb.m_stop_capture()
    assert kb.stopped == 1 and kb._capturing is False
    # every binding's on_up was published as an all-stop, pressed cleared
    assert kb.bus.to_topic("/drive")[-1]["payload"] == {"v": 0}
    assert kb.bus.to_topic("/turn")[-1]["payload"] == {"v": 0}
    assert kb._snapshot()["pressed"] == []


@pytest.mark.asyncio
async def test_bind_unbind(kb):
    await kb.m_bind(combo="KeyW", topic="/drive", id="fwd", on_down={"v": 1})
    assert any(b["id"] == "fwd" for b in kb.config.bindings)
    await kb.m_unbind("fwd")
    assert all(b["id"] != "fwd" for b in kb.config.bindings)


def test_normalize_event_from_browser_payload():
    ev = normalize_event({"type": "up", "key": "A", "code": "KeyA", "modifiers": {"shift": True}})
    assert ev["type"] == "up" and ev["modifiers"]["shift"] is True
