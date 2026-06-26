# unmanaged
"""MicBrowserService unit tests — the relay half of the browser microphone.

Control actions become commands on /microphone/{id}/cmd; browser reports
fold into the canonical /state; a stale heartbeat marks the client gone.
The audio bytes never pass through this service (the browser publishes them
to /microphone/{id}/audio directly), so there's nothing audio-path to test
here — that shape is locked by test_rlx_audio.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Any, List

import pytest

_SRC = Path(__file__).resolve().parents[1] / "repo" / "mic_browser" / "1.0.0" / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from mic_browser_service import service as mic_service  # noqa: E402


class FakeBus:
    def __init__(self) -> None:
        self.published: List[tuple] = []

    async def publish(self, topic: str, payload: Any, *, retained: bool = False, **_: Any) -> None:
        self.published.append((topic, payload, retained))

    def lasts(self, suffix: str):
        return [p for t, p, _ in self.published if t.endswith(suffix)]

    def last(self, suffix: str):
        items = self.lasts(suffix)
        assert items, f"no publish ending in {suffix!r}"
        return items[-1]


def _mic():
    return mic_service.MicBrowserService("microphone-1", FakeBus())


@pytest.mark.asyncio
async def test_connect_relays_cmd_to_browser():
    mic = _mic()
    await mic.m_connect()
    cmd = mic.bus.last("/microphone/microphone-1/cmd")
    assert cmd["action"] == "connect"
    assert cmd["sample_rate"] == mic.config.sample_rate
    # State reports the browser source.
    assert mic.bus.last("/microphone/microphone-1/state")["source"] == "browser"


@pytest.mark.asyncio
async def test_disconnect_relays_cmd():
    mic = _mic()
    await mic.m_disconnect()
    assert mic.bus.last("/microphone/microphone-1/cmd")["action"] == "disconnect"


@pytest.mark.asyncio
async def test_list_devices_relays_enumerate():
    mic = _mic()
    await mic.m_list_devices()
    actions = [c["action"] for c in mic.bus.lasts("/microphone/microphone-1/cmd")]
    assert "enumerate" in actions


@pytest.mark.asyncio
async def test_report_folds_into_state():
    mic = _mic()
    await mic._on_report({
        "devices": [{"id": "default", "label": "Built-in Mic", "default": True}],
        "connected": True,
        "level_rms": 0.42,
        "ts": time.time(),
    })
    state = mic.bus.last("/microphone/microphone-1/state")
    assert state["devices"][0]["label"] == "Built-in Mic"
    assert state["connected"] is True
    assert state["level_rms"] == 0.42
    assert state["last_error"] is None


@pytest.mark.asyncio
async def test_report_error_surfaces():
    mic = _mic()
    await mic._on_report({"error": "permission denied", "connected": False})
    assert mic.bus.last("/microphone/microphone-1/state")["last_error"] == "permission denied"


@pytest.mark.asyncio
async def test_check_stale_marks_client_gone():
    mic = _mic()
    mic._connected = True
    mic._last_report_ts = time.time() - 999      # last heartbeat long ago
    assert await mic._check_stale() is True
    state = mic.bus.last("/microphone/microphone-1/state")
    assert state["connected"] is False
    assert state["last_error"] == "no browser client"


@pytest.mark.asyncio
async def test_check_stale_noop_when_fresh():
    mic = _mic()
    mic._connected = True
    mic._last_report_ts = time.time()            # fresh heartbeat
    assert await mic._check_stale() is False
    assert mic._connected is True
