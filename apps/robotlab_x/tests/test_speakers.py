# unmanaged
"""Speaker services — host playback (sounddevice mocked) + browser relay.

The shared control interface is covered by test_rlx_audio; here we test the
two transports: speaker_local opens a raw output stream and its callback
drains the playback buffer; speaker_browser relays control to the browser
and never renders audio itself.
"""
from __future__ import annotations

import struct
import sys
from pathlib import Path
from typing import Any, List
from unittest.mock import MagicMock

import pytest

_REPO = Path(__file__).resolve().parents[1] / "repo"
for _p in (_REPO / "speaker_local" / "1.0.0" / "src", _REPO / "speaker_browser" / "1.0.0" / "src"):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from speaker_local_service import service as spk_local      # noqa: E402
from speaker_browser_service import service as spk_browser  # noqa: E402
from rlx_audio import encode_frame                          # noqa: E402


class FakeBus:
    def __init__(self) -> None:
        self.published: List[tuple] = []

    async def publish(self, topic: str, payload: Any, *, retained: bool = False, **_: Any) -> None:
        self.published.append((topic, payload, retained))

    def last(self, suffix: str):
        for t, p, _ in reversed(self.published):
            if t.endswith(suffix):
                return p
        raise AssertionError(f"no publish ending in {suffix!r}")


# ─── speaker_local (PortAudio output mocked) ──────────────────────────


class FakeOutStream:
    def __init__(self, **kw: Any) -> None:
        self.kw = kw
        self.callback = kw.get("callback")
        self.started = False
        self.closed = False

    def start(self) -> None: self.started = True
    def stop(self) -> None: self.started = False
    def close(self) -> None: self.closed = True


class FakeSd:
    def __init__(self) -> None:
        self.default = MagicMock()
        self.default.device = (1, 2)   # output default = index 2
        self.last_stream: FakeOutStream | None = None

    def query_devices(self):
        return [
            {"name": "Mic Only", "max_output_channels": 0},
            {"name": "USB Speaker", "max_output_channels": 2},
            {"name": "HDMI Audio", "max_output_channels": 2},
        ]

    def RawOutputStream(self, **kw: Any) -> FakeOutStream:
        self.last_stream = FakeOutStream(**kw)
        return self.last_stream


@pytest.fixture
def fake_sd(monkeypatch):
    sd = FakeSd()
    monkeypatch.setattr(spk_local, "_sd", lambda: sd)
    return sd


def _local():
    return spk_local.SpeakerLocalService("speaker-1", FakeBus())


@pytest.mark.asyncio
async def test_local_enumerates_output_devices_only(fake_sd):
    spk = _local()
    devs = await spk._enumerate_devices()
    assert [d["id"] for d in devs] == ["1", "2"]   # index 0 has 0 outputs
    assert devs[1]["label"] == "HDMI Audio"
    assert devs[1]["default"] is True              # default output = index 2


@pytest.mark.asyncio
async def test_local_connect_opens_output_stream(fake_sd):
    spk = _local()
    await spk.m_connect()
    s = fake_sd.last_stream
    assert s is not None and s.started is True
    assert s.kw["dtype"] == "int16"
    assert spk._connected is True


@pytest.mark.asyncio
async def test_local_plays_into_buffer_and_callback_drains(fake_sd):
    spk = _local()
    await spk.m_connect()
    pcm = struct.pack("<4h", 5, 6, 7, 8)
    await spk._on_sink_frame(encode_frame(1, 0.0, 16000, 1, pcm))
    assert bytes(spk._buf) == pcm
    # Output callback pulls from the buffer + pads with silence.
    out = bytearray(len(pcm) + 4)
    fake_sd.last_stream.callback(out, len(out) // 2, None, None)
    assert bytes(out[: len(pcm)]) == pcm
    assert bytes(out[len(pcm):]) == b"\x00\x00\x00\x00"
    assert len(spk._buf) == 0


@pytest.mark.asyncio
async def test_local_disconnect_stops_and_clears(fake_sd):
    spk = _local()
    await spk.m_connect()
    stream = fake_sd.last_stream
    await spk._on_sink_frame(encode_frame(1, 0.0, 16000, 1, struct.pack("<2h", 1, 2)))
    await spk.m_disconnect()
    assert stream.started is False and stream.closed is True
    assert len(spk._buf) == 0


# ─── speaker_browser (relay) ──────────────────────────────────────────


def _browser():
    return spk_browser.SpeakerBrowserService("speaker-2", FakeBus())


@pytest.mark.asyncio
async def test_browser_connect_relays_cmd():
    spk = _browser()
    await spk.m_connect()
    cmd = spk.bus.last("/speaker/speaker-2/cmd")
    assert cmd["action"] == "connect"
    assert spk.bus.last("/speaker/speaker-2/state")["source"] == "browser"


@pytest.mark.asyncio
async def test_browser_does_not_render_audio():
    spk = _browser()
    await spk.m_connect()
    # Even a connected browser speaker plays nothing backend-side.
    await spk._on_sink_frame(encode_frame(1, 0.0, 16000, 1, struct.pack("<2h", 1, 2)))
    # _play_pcm is a no-op; nothing to assert beyond "did not raise".


@pytest.mark.asyncio
async def test_browser_report_folds_and_stale():
    spk = _browser()
    await spk._on_report({"devices": [{"id": "default", "label": "Speakers"}], "connected": True, "level_rms": 0.3})
    state = spk.bus.last("/speaker/speaker-2/state")
    assert state["connected"] is True
    assert state["devices"][0]["label"] == "Speakers"
    import time as _t
    spk._connected = True
    spk._last_report_ts = _t.time() - 999
    assert await spk._check_stale() is True
    assert spk.bus.last("/speaker/speaker-2/state")["last_error"] == "no browser client"


# ─── generic player: input selection + decode ─────────────────────────


def _wav_bytes(sample_rate=16000, channels=1, samples=(100, -200, 300, -400)):
    import io, wave
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels); w.setsampwidth(2); w.setframerate(sample_rate)
        w.writeframes(struct.pack("<%dh" % len(samples), *samples))
    return buf.getvalue()


def test_local_decode_wav_stdlib(fake_sd):
    # WAV at the configured rate decodes with the stdlib (no miniaudio).
    spk = _local()
    pcm = struct.pack("<4h", 100, -200, 300, -400)
    data = _wav_bytes()
    assert spk._decode(data, "clip.wav") == pcm


@pytest.mark.asyncio
async def test_local_reader_plays_file(fake_sd, tmp_path):
    # Selecting a file input decodes it + the player fills the output buffer.
    spk = _local()
    f = tmp_path / "clip.wav"
    f.write_bytes(_wav_bytes(samples=tuple([0] * 16000)))   # 1s @16k mono
    await spk.m_connect()
    await spk.m_select_input("file", str(f))
    import asyncio
    await asyncio.sleep(0.1)            # let the player task fill the buffer
    state = spk.bus.last("/speaker/speaker-1/state")
    assert state["input_kind"] == "file"
    assert state["playing"] is True    # 1s clip still playing
    assert state["duration_s"] > 0
    assert spk._pos > 0                # cursor advanced
    assert len(spk._buf) > 0           # PCM queued for the output device


@pytest.mark.asyncio
async def test_browser_select_input_relays_cmd():
    spk = _browser()
    await spk.m_select_input("url", "https://example.com/a.mp3")
    cmd = spk.bus.last("/speaker/speaker-2/cmd")
    assert cmd["action"] == "set_input"
    assert cmd["input_kind"] == "url"
    assert cmd["input_ref"] == "https://example.com/a.mp3"
    assert spk.bus.last("/speaker/speaker-2/state")["input_ref"] == "https://example.com/a.mp3"


@pytest.mark.asyncio
async def test_local_browse_files_lists_audio_and_dirs(fake_sd, tmp_path):
    (tmp_path / "sub").mkdir()
    (tmp_path / "song.wav").write_bytes(b"RIFF....")
    (tmp_path / "clip.mp3").write_bytes(b"ID3....")
    (tmp_path / "notes.txt").write_text("nope")
    (tmp_path / ".hidden.wav").write_bytes(b"x")
    spk = _local()
    out = await spk.m_browse_files(str(tmp_path))
    assert out["path"] == str(tmp_path)
    assert out["parent"] == str(tmp_path.parent)
    assert out["dirs"] == ["sub"]
    names = sorted(f["name"] for f in out["files"])
    assert names == ["clip.mp3", "song.wav"]      # .txt excluded, dotfile excluded
    assert any(r["label"] == "Home" for r in out["roots"])
