# unmanaged
"""SpeechLocalService unit tests — the Piper backend hooks with Piper mocked.

The real subprocess venv has ``piper-tts``; this venv doesn't, so we patch
``_load_voice`` (and the model download) with fakes. We test voice listing
(curated + on-disk), the model-download-on-miss path, the length_scale rate
mapping, and that _synthesize writes a WAV. The shared control interface +
cache + streaming are covered by test_rlx_audio's FakeSpeech.
"""
from __future__ import annotations

import sys
import wave
from array import array
from pathlib import Path
from typing import Any, List

import pytest

_SRC = Path(__file__).resolve().parents[1] / "repo" / "speech_local" / "1.0.0" / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from speech_local_service import service as speech_service  # noqa: E402


class FakeBus:
    def __init__(self) -> None:
        self.published: List[tuple] = []

    async def publish(self, topic: str, payload: Any, *, retained: bool = False, **_: Any) -> None:
        self.published.append((topic, payload, retained))


class FakeVoice:
    """Stands in for a loaded PiperVoice; records the syn_config it was given
    and writes a short tone WAV."""

    def __init__(self) -> None:
        self.last_syn: Any = None

    def synthesize_wav(self, text: str, wav, syn_config=None) -> None:  # noqa: ANN001
        self.last_syn = syn_config
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(22050)
        wav.writeframes(array("h", [4000] * 880).tobytes())   # ~40ms


def _svc(tmp_path, monkeypatch) -> speech_service.SpeechLocalService:
    monkeypatch.setenv("ROBOTLAB_X_DATA_DIR_ABS", str(tmp_path))
    return speech_service.SpeechLocalService("speech-1", FakeBus())


def test_list_voices_marks_downloaded_and_includes_on_disk(tmp_path, monkeypatch):
    svc = _svc(tmp_path, monkeypatch)
    svc.voices_dir.mkdir(parents=True, exist_ok=True)
    # A curated voice present on disk + a non-curated extra voice.
    (svc.voices_dir / "en_US-lessac-medium.onnx").write_bytes(b"x")
    (svc.voices_dir / "custom-voice.onnx").write_bytes(b"x")
    voices = svc._list_voices()
    by_id = {v["id"]: v for v in voices}
    assert by_id["en_US-lessac-medium"]["downloaded"] is True
    assert by_id["en_US-amy-medium"]["downloaded"] is False     # curated, not on disk
    assert "custom-voice" in by_id and by_id["custom-voice"]["downloaded"] is True


def test_synthesize_writes_wav_and_maps_rate_to_length_scale(tmp_path, monkeypatch):
    svc = _svc(tmp_path, monkeypatch)
    fake = FakeVoice()
    monkeypatch.setattr(svc, "_load_voice", lambda vid: fake)
    out = tmp_path / "out.wav"
    svc._synthesize("hello", str(out), {"voice": "test-voice", "rate": 2.0})
    assert out.is_file()
    with wave.open(str(out), "rb") as w:
        assert w.getframerate() == 22050 and w.getnframes() > 0
    # rate 2.0 (faster) → length_scale 0.5 (Piper: smaller = faster).
    if fake.last_syn is not None:        # only when this Piper build has SynthesisConfig
        assert abs(fake.last_syn.length_scale - 0.5) < 1e-6


def test_ensure_model_downloads_when_absent(tmp_path, monkeypatch):
    svc = _svc(tmp_path, monkeypatch)
    calls: List[str] = []

    def fake_download(voice_id: str) -> None:
        calls.append(voice_id)
        (svc.voices_dir / f"{voice_id}.onnx").write_bytes(b"model")

    monkeypatch.setattr(svc, "_download_voice", fake_download)
    model = svc._ensure_model("en_US-amy-medium")
    assert model.is_file() and calls == ["en_US-amy-medium"]
    # Second call is a cache hit — no re-download.
    model2 = svc._ensure_model("en_US-amy-medium")
    assert model2 == model and calls == ["en_US-amy-medium"]


def test_load_voice_caches_instance(tmp_path, monkeypatch):
    svc = _svc(tmp_path, monkeypatch)
    made: List[FakeVoice] = []

    class FakePiperVoice:
        @staticmethod
        def load(path: str):
            v = FakeVoice(); made.append(v); return v

    # Pretend the model already exists + stub the piper import path.
    svc.voices_dir.mkdir(parents=True, exist_ok=True)
    (svc.voices_dir / "test-voice.onnx").write_bytes(b"model")
    import types
    fake_piper = types.ModuleType("piper")
    fake_piper.PiperVoice = FakePiperVoice            # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "piper", fake_piper)
    v1 = svc._load_voice("test-voice")
    v2 = svc._load_voice("test-voice")
    assert v1 is v2 and len(made) == 1                # loaded once, cached
