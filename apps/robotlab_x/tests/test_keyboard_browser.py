# unmanaged
"""Unit tests for the keyboard_browser relay service.

Verifies the relay half of the browser ``keyboard`` capability: control
actions are relayed to the browser as /cmd messages, browser key events are
folded through the keymap, browser reports update capturing state, and a
stale heartbeat fires the keymap all-stop. rlx_input is installed in the app
venv; the service src is added to sys.path so it imports from the top-level
test venv.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List

import pytest

_KB_SRC = Path(__file__).resolve().parents[1] / "repo" / "keyboard_browser" / "1.0.0" / "src"
if str(_KB_SRC) not in sys.path:
    sys.path.insert(0, str(_KB_SRC))


class _FakeBus:
    def __init__(self) -> None:
        self.published: List[Dict[str, Any]] = []
        self.subscribed: List[str] = []

    async def publish(self, topic: str, payload: Any, *, retained: bool = False) -> None:
        self.published.append({"topic": topic, "payload": payload, "retained": retained})

    async def subscribe(self, topic: str, handler):
        self.subscribed.append(topic)

    def by_topic_suffix(self, suffix: str) -> List[Dict[str, Any]]:
        return [m for m in self.published if m["topic"].endswith(suffix)]

    def to_topic(self, topic: str) -> List[Dict[str, Any]]:
        return [m for m in self.published if m["topic"] == topic]


@pytest.fixture
def svc(monkeypatch):
    from keyboard_browser_service.service import KeyboardBrowserService
    s = KeyboardBrowserService("kb-1", _FakeBus())
    async def _record_update(patch):
        for k, v in patch.items():
            setattr(s.config, k, v)
    monkeypatch.setattr(s, "update_config", _record_update)
    return s


@pytest.mark.asyncio
async def test_start_capture_relays_cmd_to_browser(svc):
    await svc.m_start_capture()
    cmds = [m for m in svc.bus.by_topic_suffix("/cmd")]
    assert cmds and cmds[-1]["payload"]["action"] == "start"
    assert svc._capturing is True


@pytest.mark.asyncio
async def test_stop_capture_relays_and_all_stops(svc):
    svc.config.bindings = [{"id": "fwd", "combo": "KeyW", "topic": "/drive",
                            "on_down": {"v": 1}, "on_up": {"v": 0}}]
    await svc.m_stop_capture()
    assert svc.bus.by_topic_suffix("/cmd")[-1]["payload"]["action"] == "stop"
    # all-stop fired the binding's on_up
    assert svc.bus.to_topic("/drive")[-1]["payload"] == {"v": 0}


@pytest.mark.asyncio
async def test_on_event_runs_keymap(svc):
    svc.config.bindings = [{"id": "fwd", "combo": "KeyW", "topic": "/drive",
                            "on_down": {"v": 1}, "on_up": {"v": 0}}]
    await svc._on_event({"type": "down", "code": "KeyW", "ts": 1.0})
    assert svc.bus.to_topic("/drive")[-1]["payload"] == {"v": 1}
    assert "keyw" in svc._snapshot()["pressed"]


@pytest.mark.asyncio
async def test_on_report_folds_capturing(svc):
    await svc._on_report({"capturing": True, "ts": 1.0})
    assert svc._capturing is True
    await svc._on_report({"capturing": False, "error": "denied"})
    assert svc._capturing is False
    assert svc._snapshot()["last_error"] == "denied"


@pytest.mark.asyncio
async def test_set_scope_and_suppress_relay(svc):
    await svc.m_set_scope("document")
    assert svc.bus.by_topic_suffix("/cmd")[-1]["payload"] == {"action": "set_scope", "scope": "document"}
    await svc.m_set_suppress(True)
    assert svc.bus.by_topic_suffix("/cmd")[-1]["payload"] == {"action": "set_suppress", "suppress": True}


@pytest.mark.asyncio
async def test_stale_clears_capturing_and_all_stops(svc):
    import time
    svc.config.bindings = [{"id": "fwd", "combo": "KeyW", "topic": "/drive",
                            "on_down": {"v": 1}, "on_up": {"v": 0}}]
    svc._capturing = True
    svc._last_report_ts = time.time() - 10.0  # older than _STALE_AFTER_S
    went_stale = await svc._check_stale()
    assert went_stale is True
    assert svc._capturing is False
    assert svc._snapshot()["last_error"] == "no browser client"
    assert svc.bus.to_topic("/drive")[-1]["payload"] == {"v": 0}
