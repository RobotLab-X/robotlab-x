"""MicLocalService — host-side microphone capture (PortAudio).

The control interface + publish shape are entirely inherited from
``rlx_audio.MicrophoneServiceBase``. This file implements ONLY the three
transport hooks for the local data path:

  _enumerate_devices() — sounddevice.query_devices(), input-capable only
  _open()              — a raw int16 InputStream whose callback streams PCM
  _close()             — stop the stream

``sounddevice`` is imported lazily (via ``_sd()``) so this module imports
fine in environments without PortAudio — unit tests patch ``_sd``.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from rlx_audio import MicrophoneServiceBase

logger = logging.getLogger(__name__)


def _sd():
    """Lazy import of sounddevice — keeps the module importable without
    PortAudio present (tests patch this)."""
    import sounddevice  # noqa: PLC0415
    return sounddevice


class MicLocalService(MicrophoneServiceBase):
    """Cross-platform host microphone. See module docstring."""

    source = "local"

    def __init__(self, proxy_id, bus) -> None:
        super().__init__(proxy_id, bus)
        self._stream: Optional[Any] = None

    # ─── transport hooks ──────────────────────────────────────────────
    async def _enumerate_devices(self) -> List[Dict[str, Any]]:
        sd = _sd()
        try:
            default_in = sd.default.device[0]
        except Exception:  # noqa: BLE001
            default_in = None
        out: List[Dict[str, Any]] = []
        for idx, dev in enumerate(sd.query_devices()):
            if int(dev.get("max_input_channels", 0)) <= 0:
                continue
            out.append({
                "id": str(idx),
                "label": dev.get("name") or f"device {idx}",
                "default": idx == default_in,
            })
        return out

    async def _open(self) -> None:
        if self._stream is not None:
            await self._close()
        sd = _sd()
        device = int(self.config.device_id) if self.config.device_id not in (None, "") else None
        stream = sd.RawInputStream(
            samplerate=self.config.sample_rate,
            blocksize=self.frame_samples,
            channels=self.config.channels,
            dtype="int16",
            device=device,
            callback=self._on_audio,
        )
        stream.start()
        self._stream = stream
        logger.info("mic_local %s: capture started (device=%s rate=%s ch=%s)",
                    self.proxy_id, device, self.config.sample_rate, self.config.channels)

    async def _close(self) -> None:
        stream, self._stream = self._stream, None
        if stream is None:
            return
        try:
            stream.stop()
            stream.close()
        except Exception:  # noqa: BLE001
            logger.exception("mic_local %s: stream close failed", self.proxy_id)

    # ─── PortAudio callback (runs on its own thread) ──────────────────
    def _on_audio(self, indata, frames, time_info, status) -> None:  # noqa: ANN001
        if status:
            logger.debug("mic_local %s: stream status %s", self.proxy_id, status)
        # indata is a CFFI buffer for RawInputStream; bytes() copies the
        # interleaved int16 PCM out. Marshal onto the service loop.
        self.emit_pcm_threadsafe(bytes(indata))
