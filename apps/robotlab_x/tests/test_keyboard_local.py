# unmanaged
"""Unit tests for the keyboard_local host-capture service.

Covers the pure keycode→canonical mapping, the backend selection logic, and
the service wiring (start/stop drive the backend, events flow through the
keymap, device enumeration). The actual evdev/pynput library calls are
seams; a FakeBackend stands in so the suite runs anywhere without hardware
or those libraries installed.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import pytest

_KL_SRC = Path(__file__).resolve().parents[1] / "repo" / "keyboard_local" / "1.0.0" / "src"
if str(_KL_SRC) not in sys.path:
    sys.path.insert(0, str(_KL_SRC))


# ─────────────────────────────────────────────────────────────────────
# keycodes — pure mapping
# ─────────────────────────────────────────────────────────────────────
def test_evdev_to_canonical():
    from keyboard_local_service.keycodes import evdev_to_canonical
    assert evdev_to_canonical("KEY_W") == ("KeyW", "w")
    assert evdev_to_canonical("W") == ("KeyW", "w")  # prefix optional
    assert evdev_to_canonical("KEY_1") == ("Digit1", "1")
    assert evdev_to_canonical("KEY_LEFTSHIFT") == ("ShiftLeft", "shift")
    assert evdev_to_canonical("KEY_UP") == ("ArrowUp", "arrowup")
    # unknown → ("", lowered)
    assert evdev_to_canonical("KEY_BRIGHTNESSUP") == ("", "brightnessup")


def test_pynput_to_canonical():
    from keyboard_local_service.keycodes import pynput_to_canonical
    assert pynput_to_canonical(None, "w") == ("KeyW", "w")
    assert pynput_to_canonical(None, "W") == ("KeyW", "w")
    assert pynput_to_canonical(None, "5") == ("Digit5", "5")
    assert pynput_to_canonical("ctrl_l", None) == ("ControlLeft", "ctrl")
    assert pynput_to_canonical("space", None) == ("Space", " ")
    assert pynput_to_canonical("f4", None) == ("F4", "f4")


def test_modifier_of_code():
    from keyboard_local_service.keycodes import MODIFIER_OF_CODE
    assert MODIFIER_OF_CODE["ShiftLeft"] == "shift"
    assert MODIFIER_OF_CODE["ControlRight"] == "ctrl"
    assert "KeyW" not in MODIFIER_OF_CODE


# ─────────────────────────────────────────────────────────────────────
# backend selection
# ─────────────────────────────────────────────────────────────────────
def test_select_backend_explicit_unavailable_raises(monkeypatch):
    from keyboard_local_service import keyboard_capture as kc
    monkeypatch.setattr(kc.EvdevBackend, "available", staticmethod(lambda: False))
    with pytest.raises(RuntimeError, match="not available"):
        kc.select_backend("evdev")


def test_select_backend_auto_prefers_evdev(monkeypatch):
    from keyboard_local_service import keyboard_capture as kc
    monkeypatch.setattr(kc.EvdevBackend, "available", staticmethod(lambda: True))
    monkeypatch.setattr(kc.PynputBackend, "available", staticmethod(lambda: True))
    assert kc.select_backend("auto").name == "evdev"
    monkeypatch.setattr(kc.EvdevBackend, "available", staticmethod(lambda: False))
    assert kc.select_backend("auto").name == "pynput"


def test_select_backend_none_available(monkeypatch):
    from keyboard_local_service import keyboard_capture as kc
    monkeypatch.setattr(kc.EvdevBackend, "available", staticmethod(lambda: False))
    monkeypatch.setattr(kc.PynputBackend, "available", staticmethod(lambda: False))
    with pytest.raises(RuntimeError, match="no keyboard capture backend"):
        kc.select_backend("auto")


# ─────────────────────────────────────────────────────────────────────
# service wiring (with a fake backend)
# ─────────────────────────────────────────────────────────────────────
class _FakeBackend:
    name = "fake"

    def __init__(self) -> None:
        self.started = 0
        self.stopped = 0
        self.start_kwargs: Dict[str, Any] = {}
        self.on_event: Optional[Callable[[Dict[str, Any]], None]] = None

    def list_devices(self) -> List[Dict[str, Any]]:
        return [{"id": "/dev/input/event3", "name": "Fake Keyboard"}]

    def start(self, on_event, *, grab=False, device_id=None, scope="global") -> None:
        self.started += 1
        self.on_event = on_event
        self.start_kwargs = {"grab": grab, "device_id": device_id, "scope": scope}

    def stop(self) -> None:
        self.stopped += 1


class _FakeBus:
    def __init__(self) -> None:
        self.published: List[Dict[str, Any]] = []

    async def publish(self, topic: str, payload: Any, *, retained: bool = False) -> None:
        self.published.append({"topic": topic, "payload": payload, "retained": retained})

    async def subscribe(self, topic: str, handler):  # pragma: no cover
        pass

    def to_topic(self, topic: str) -> List[Dict[str, Any]]:
        return [m for m in self.published if m["topic"] == topic]

    def by_topic_suffix(self, suffix: str) -> List[Dict[str, Any]]:
        return [m for m in self.published if m["topic"].endswith(suffix)]


@pytest.fixture
def svc(monkeypatch):
    from keyboard_local_service.service import KeyboardLocalService
    s = KeyboardLocalService("kbl-1", _FakeBus())
    fake = _FakeBackend()
    # Pin the backend so _ensure_backend() never touches real libs.
    s._backend = fake
    s._fake = fake  # type: ignore[attr-defined]
    async def _record_update(patch):
        for k, v in patch.items():
            setattr(s.config, k, v)
    monkeypatch.setattr(s, "update_config", _record_update)
    return s


def test_config_defaults():
    from keyboard_local_service.service import KeyboardLocalConfig
    c = KeyboardLocalConfig()
    assert c.backend == "auto"
    assert c.device_id is None
    assert c.grab is False
    assert c.scope == "global"


@pytest.mark.asyncio
async def test_start_capture_drives_backend(svc):
    svc.config.grab = True
    svc.config.device_id = "/dev/input/event3"
    await svc.m_start_capture()
    assert svc._fake.started == 1
    assert svc._fake.start_kwargs == {"grab": True, "device_id": "/dev/input/event3", "scope": "global"}
    assert svc._capturing is True


@pytest.mark.asyncio
async def test_emitted_event_publishes_and_runs_keymap(svc):
    # A binding + a started backend; simulate the capture thread firing.
    svc.config.bindings = [{"id": "fwd", "combo": "KeyW", "topic": "/drive",
                            "on_down": {"v": 1}, "on_up": {"v": 0}}]
    await svc.emit_event({"type": "down", "code": "KeyW", "ts": 1.0, "source": "local"})
    # canonical event published for consumers
    assert svc.bus.by_topic_suffix("/event")
    # keymap dispatched the bound message
    assert svc.bus.to_topic("/drive")[-1]["payload"] == {"v": 1}


@pytest.mark.asyncio
async def test_list_devices(svc):
    res = await svc.m_list_devices()
    assert res["devices"][0]["name"] == "Fake Keyboard"
    snap = svc._snapshot()
    assert snap["backend"] == "fake"
    assert snap["devices"][0]["id"] == "/dev/input/event3"


@pytest.mark.asyncio
async def test_set_grab_restarts_when_capturing(svc):
    await svc.m_start_capture()
    svc._fake.started = 0  # reset to observe restart
    await svc.m_set_grab(True)
    assert svc.config.grab is True
    # restart = stop + start
    assert svc._fake.stopped >= 1 and svc._fake.started == 1


@pytest.mark.asyncio
async def test_stop_capture_all_stops(svc):
    svc.config.bindings = [{"id": "fwd", "combo": "KeyW", "topic": "/drive",
                            "on_down": {"v": 1}, "on_up": {"v": 0}}]
    await svc.m_start_capture()
    await svc.m_stop_capture()
    assert svc._fake.stopped >= 1
    assert svc.bus.to_topic("/drive")[-1]["payload"] == {"v": 0}
