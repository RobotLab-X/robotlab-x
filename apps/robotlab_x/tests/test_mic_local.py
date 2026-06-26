# unmanaged
"""MicLocalService unit tests — host capture hooks with sounddevice mocked.

The real subprocess venv has sounddevice (PortAudio); this venv doesn't, so
we patch ``_sd`` with a fake. We test device enumeration (input-only), that
_open starts a raw int16 stream, that its callback streams PCM, and that
_close stops it. The control interface itself is covered by test_rlx_audio.
"""
from __future__ import annotations

import struct
import sys
from pathlib import Path
from typing import Any, List
from unittest.mock import MagicMock

import pytest

_SRC = Path(__file__).resolve().parents[1] / "repo" / "mic_local" / "1.0.0" / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from mic_local_service import service as mic_service  # noqa: E402


class FakeBus:
    def __init__(self) -> None:
        self.published: List[tuple] = []

    async def publish(self, topic: str, payload: Any, *, retained: bool = False, **_: Any) -> None:
        self.published.append((topic, payload, retained))


class FakeStream:
    def __init__(self, **kw: Any) -> None:
        self.kw = kw
        self.callback = kw.get("callback")
        self.started = False
        self.closed = False

    def start(self) -> None:
        self.started = True

    def stop(self) -> None:
        self.started = False

    def close(self) -> None:
        self.closed = True


class FakeSd:
    def __init__(self) -> None:
        self.default = MagicMock()
        self.default.device = (1, 0)   # input default = index 1
        self.last_stream: FakeStream | None = None

    def query_devices(self):
        return [
            {"name": "HDMI Out", "max_input_channels": 0},
            {"name": "USB Mic", "max_input_channels": 2},
            {"name": "Webcam Mic", "max_input_channels": 1},
        ]

    def RawInputStream(self, **kw: Any) -> FakeStream:
        self.last_stream = FakeStream(**kw)
        return self.last_stream


@pytest.fixture
def fake_sd(monkeypatch):
    sd = FakeSd()
    monkeypatch.setattr(mic_service, "_sd", lambda: sd)
    return sd


def _mic():
    return mic_service.MicLocalService("microphone-1", FakeBus())


@pytest.mark.asyncio
async def test_enumerate_input_devices_only(fake_sd):
    mic = _mic()
    devs = await mic._enumerate_devices()
    ids = [d["id"] for d in devs]
    assert ids == ["1", "2"]                       # index 0 has 0 inputs → skipped
    assert devs[0]["label"] == "USB Mic"
    assert devs[0]["default"] is True              # default input = index 1
    assert devs[1]["default"] is False


@pytest.mark.asyncio
async def test_open_starts_raw_int16_stream(fake_sd):
    mic = _mic()
    await mic.m_set_params(sample_rate=16000, channels=1, frame_ms=20)
    await mic.m_connect()
    s = fake_sd.last_stream
    assert s is not None and s.started is True
    assert s.kw["dtype"] == "int16"
    assert s.kw["samplerate"] == 16000
    assert s.kw["channels"] == 1
    assert s.kw["blocksize"] == int(16000 * 20 / 1000)
    assert mic._connected is True


@pytest.mark.asyncio
async def test_callback_streams_pcm(fake_sd):
    mic = _mic()
    captured: List[bytes] = []
    mic.emit_pcm_threadsafe = lambda b: captured.append(b)  # type: ignore[assignment]
    await mic.m_connect()
    pcm = struct.pack("<3h", 11, 22, 33)
    fake_sd.last_stream.callback(pcm, 3, None, None)
    assert captured == [pcm]


@pytest.mark.asyncio
async def test_stop_closes_stream(fake_sd):
    mic = _mic()
    await mic.m_connect()
    stream = fake_sd.last_stream
    await mic.m_disconnect()
    assert stream.started is False
    assert stream.closed is True
    assert mic._stream is None
