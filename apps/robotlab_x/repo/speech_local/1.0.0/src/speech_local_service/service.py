"""SpeechLocalService — fully-offline text-to-speech with Piper.

The whole control surface (say / stop / mute / set_voice / list_voices /
set_volume / set_rate / clear_cache), the WAV cache, and the interruptible
real-time frame streaming are inherited from ``rlx_audio.SpeechServiceBase``.
This file implements ONLY the two engine hooks:

  _synthesize(text, out_path, opts) — render one utterance to a WAV with Piper
  _list_voices()                    — curated voices + whatever's on disk

Piper (``piper-tts``) is a fast neural TTS whose wheel bundles onnxruntime +
espeak-ng, so synthesis is fully local and cross-platform. A voice is a pair
of files (``<id>.onnx`` + ``<id>.onnx.json``); the first use of a voice
downloads it into ``<cache>/voices/`` via ``python -m piper.download_voices``.
``piper`` is imported lazily so this module loads without it (unit tests patch
``_load_voice``).
"""
from __future__ import annotations

import logging
import subprocess
import sys
import threading
import wave
from pathlib import Path
from typing import Any, Dict, List, Optional

from rlx_audio import SpeechServiceBase

logger = logging.getLogger(__name__)

DEFAULT_VOICE = "en_US-lessac-medium"

# Curated, commonly-used English Piper voices surfaced in the voice picker.
# Any other ``*.onnx`` the user drops in the voices dir is listed too. The
# full Piper catalogue (30+ languages, 100+ voices) is downloadable by id.
_CURATED_VOICES: List[Dict[str, str]] = [
    {"id": "en_US-lessac-medium", "label": "Lessac (US, medium)"},
    {"id": "en_US-lessac-high", "label": "Lessac (US, high)"},
    {"id": "en_US-amy-medium", "label": "Amy (US, medium)"},
    {"id": "en_US-ryan-high", "label": "Ryan (US, high)"},
    {"id": "en_US-hfc_female-medium", "label": "HFC Female (US, medium)"},
    {"id": "en_US-hfc_male-medium", "label": "HFC Male (US, medium)"},
    {"id": "en_GB-alan-medium", "label": "Alan (GB, medium)"},
]


class SpeechLocalService(SpeechServiceBase):
    """Cross-platform offline TTS. See module docstring."""

    source = "local"

    def __init__(self, proxy_id, bus) -> None:
        super().__init__(proxy_id, bus)
        self._voice_cache: Dict[str, Any] = {}   # voice id → loaded PiperVoice
        self._dl_lock = threading.Lock()

    @property
    def voices_dir(self) -> Path:
        return self.cache_dir / "voices"

    # ─── engine hooks ─────────────────────────────────────────────────
    def _synthesize(self, text: str, out_path: str, opts: Dict[str, Any]) -> None:
        voice_id = (opts.get("voice") or DEFAULT_VOICE)
        rate = float(opts.get("rate") or 1.0)
        voice = self._load_voice(voice_id)
        # Piper: length_scale > 1 is SLOWER, so invert our (higher = faster)
        # rate multiplier. Volume is applied live at stream time, not baked in.
        syn = self._syn_config(length_scale=1.0 / max(0.1, rate))
        with wave.open(out_path, "wb") as wav:
            if syn is not None:
                voice.synthesize_wav(text, wav, syn_config=syn)
            else:
                voice.synthesize_wav(text, wav)

    def _list_voices(self) -> List[Dict[str, Any]]:
        on_disk = {p.stem for p in self.voices_dir.glob("*.onnx")} if self.voices_dir.is_dir() else set()
        out: List[Dict[str, Any]] = []
        seen = set()
        for v in _CURATED_VOICES:
            out.append({**v, "downloaded": v["id"] in on_disk})
            seen.add(v["id"])
        # Surface any extra voices the user downloaded that aren't curated.
        for vid in sorted(on_disk - seen):
            out.append({"id": vid, "label": vid, "downloaded": True})
        return out

    # ─── Piper plumbing ───────────────────────────────────────────────
    def _syn_config(self, *, length_scale: float):
        """Build a SynthesisConfig if this Piper build exposes one; else None
        (older builds take only positional defaults)."""
        try:
            from piper import SynthesisConfig  # noqa: PLC0415
        except Exception:  # noqa: BLE001
            return None
        return SynthesisConfig(length_scale=length_scale)

    def _load_voice(self, voice_id: str):
        """Return a loaded PiperVoice for ``voice_id``, downloading the model
        on first use. Cached for the life of the process."""
        cached = self._voice_cache.get(voice_id)
        if cached is not None:
            return cached
        from piper import PiperVoice  # noqa: PLC0415 — lazy so the module imports without piper
        model = self._ensure_model(voice_id)
        voice = PiperVoice.load(str(model))
        self._voice_cache[voice_id] = voice
        return voice

    def _ensure_model(self, voice_id: str) -> Path:
        """Path to ``<voices>/<voice_id>.onnx``, downloading it if absent."""
        self.voices_dir.mkdir(parents=True, exist_ok=True)
        model = self.voices_dir / f"{voice_id}.onnx"
        if model.is_file():
            return model
        with self._dl_lock:
            if model.is_file():   # another caller won the race
                return model
            logger.info("speech_local %s: downloading voice %s", self.proxy_id, voice_id)
            self._download_voice(voice_id)
        if not model.is_file():
            raise RuntimeError(f"voice model {voice_id} not found after download")
        return model

    def _download_voice(self, voice_id: str) -> None:
        """Fetch a voice's .onnx + .onnx.json via Piper's downloader CLI."""
        try:
            subprocess.run(
                [sys.executable, "-m", "piper.download_voices", voice_id,
                 "--data-dir", str(self.voices_dir)],
                check=True, capture_output=True, text=True, timeout=300,
            )
        except subprocess.CalledProcessError as exc:
            raise RuntimeError(
                f"piper.download_voices {voice_id} failed: {exc.stderr or exc.stdout or exc}"
            ) from exc
