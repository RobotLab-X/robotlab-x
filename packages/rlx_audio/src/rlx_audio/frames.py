"""Canonical audio-frame schema — shared by every ``microphone`` service.

Both microphone service types (host capture, browser capture) publish the
SAME frame shape on ``/microphone/{id}/audio`` so a consumer (speech-to-
text, recorder, level meter) reads one format regardless of source:

    {
      "seq":         int,        # monotonic per-stream counter
      "ts":          float,      # epoch seconds at capture
      "sample_rate": int,        # Hz (e.g. 16000)
      "channels":    int,        # 1 = mono
      "format":      "pcm_s16le", # signed 16-bit little-endian interleaved
      "data":        str,        # base64 of the raw PCM bytes
    }

Keeping the encode/decode + level math in ONE module is what guarantees
the two service types can't drift apart. PCM is ``s16le`` because it's the
lowest-common-denominator both a PortAudio RawInputStream and a browser
AudioWorklet can produce without extra codecs.
"""
from __future__ import annotations

import array
import base64
import math
import wave
from typing import Any, Dict, Tuple

FORMAT = "pcm_s16le"


def encode_frame(seq: int, ts: float, sample_rate: int, channels: int, pcm: bytes) -> Dict[str, Any]:
    """Build a wire frame from raw ``s16le`` PCM bytes."""
    return {
        "seq": int(seq),
        "ts": float(ts),
        "sample_rate": int(sample_rate),
        "channels": int(channels),
        "format": FORMAT,
        "data": base64.b64encode(pcm).decode("ascii"),
    }


def decode_frame(frame: Dict[str, Any]) -> bytes:
    """Raw PCM bytes back out of a wire frame."""
    return base64.b64decode(frame.get("data") or "")


def level_rms(pcm: bytes) -> float:
    """Normalized RMS level (0.0–1.0) of an ``s16le`` PCM buffer — the
    meter value carried on the state topic. Empty/odd-length input → 0."""
    if not pcm or len(pcm) < 2:
        return 0.0
    samples = array.array("h")
    # Trim a stray trailing byte so frombytes doesn't raise on odd lengths.
    samples.frombytes(pcm[: len(pcm) - (len(pcm) % 2)])
    if not samples:
        return 0.0
    acc = 0.0
    for s in samples:
        acc += float(s) * float(s)
    rms = math.sqrt(acc / len(samples))
    return min(1.0, rms / 32768.0)


# ─── PCM conditioning (used by speech services to normalize a synthesized
#     WAV to the configured wire rate/channels so a default speaker plays it
#     unchanged) ──────────────────────────────────────────────────────────


def read_wav_pcm(path: str) -> Tuple[bytes, int, int]:
    """Read a 16-bit PCM WAV file → (s16le_pcm, sample_rate, channels).

    Only handles ``sampwidth == 2`` (what every TTS engine here emits). A
    non-16-bit file raises ValueError rather than returning garbage."""
    with wave.open(path, "rb") as w:
        if w.getsampwidth() != 2:
            raise ValueError(f"{path}: expected 16-bit PCM, got sampwidth={w.getsampwidth()}")
        return w.readframes(w.getnframes()), w.getframerate(), w.getnchannels()


def remix_channels(pcm: bytes, src_ch: int, dst_ch: int) -> bytes:
    """Up/down-mix interleaved s16le between mono and stereo.

    mono→stereo duplicates each sample; stereo→mono averages the pair.
    Other channel counts pass through unchanged (best effort)."""
    if src_ch == dst_ch or src_ch <= 0 or dst_ch <= 0:
        return pcm
    a = array.array("h")
    a.frombytes(pcm[: len(pcm) - (len(pcm) % 2)])
    out = array.array("h")
    if src_ch == 1 and dst_ch == 2:
        for s in a:
            out.append(s); out.append(s)
    elif src_ch == 2 and dst_ch == 1:
        for i in range(0, len(a) - 1, 2):
            out.append(int((a[i] + a[i + 1]) / 2))
    else:
        return pcm
    return out.tobytes()


def resample_s16le(pcm: bytes, src_rate: int, dst_rate: int, channels: int = 1) -> bytes:
    """Linear-interpolation resample of interleaved s16le PCM.

    Dependency-free and good enough for speech (no anti-alias filter — the
    point is to land a synthesized utterance on the configured wire rate so
    a default 16 kHz speaker plays it at the right pitch). Returns the input
    unchanged when the rates already match."""
    if src_rate == dst_rate or src_rate <= 0 or dst_rate <= 0 or not pcm:
        return pcm
    src = array.array("h")
    src.frombytes(pcm[: len(pcm) - (len(pcm) % 2)])
    ch = max(1, channels)
    n_in = len(src) // ch
    if n_in < 2:
        return pcm
    n_out = max(1, int(n_in * dst_rate / src_rate))
    ratio = (n_in - 1) / max(1, (n_out - 1))
    out = array.array("h", [0]) * (n_out * ch)
    for i in range(n_out):
        pos = i * ratio
        i0 = int(pos)
        frac = pos - i0
        i1 = min(i0 + 1, n_in - 1)
        for c in range(ch):
            a = src[i0 * ch + c]
            b = src[i1 * ch + c]
            out[i * ch + c] = int(a + (b - a) * frac)
    return out.tobytes()
