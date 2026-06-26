"""SpeakerLocalService — host-side audio playback + generic player.

Control + input selection (topic / file / url) are inherited from
``rlx_audio.SpeakerServiceBase``. This implements the output transport
(a raw int16 OutputStream whose callback drains a buffer) and the file/url
SOURCE reader:

  * topic input  → frames arrive on the bus; base routes them to _play_pcm.
  * file / url   → a reader task decodes the source to PCM at the configured
                   rate, paces it into the output buffer in real time, and
                   republishes frames on /speaker/{id}/audio so the UI meters.

Decoding: WAV is handled by the stdlib ``wave`` module (zero-dependency);
other formats (mp3/ogg/flac) use ``miniaudio`` when present. ``sounddevice``
(PortAudio) is the cross-platform output library. Both imported lazily so
the module loads without them (tests patch ``_sd`` and use WAV).
"""
from __future__ import annotations

import array
import asyncio
import io
import logging
import os
import threading
import time
import urllib.request
import wave
from pathlib import Path
from typing import Any, Dict, List, Optional

from rlx_audio import SpeakerServiceBase, encode_frame
from rlx_bus import service_method

_VIZ_SAMPLES = 64       # decimated samples per viz frame
_VIZ_PERIOD_S = 0.066   # ~15 Hz viz publish

logger = logging.getLogger(__name__)

_MAX_BUFFER_BYTES = 16000 * 2 * 2  # ~2s of 16k mono s16le
_FETCH_TIMEOUT_S = 20
_AUDIO_EXTS = {".wav", ".mp3", ".ogg", ".oga", ".flac", ".m4a", ".aac", ".opus", ".webm", ".aiff", ".aif"}


def _sd():
    import sounddevice  # noqa: PLC0415
    return sounddevice


class SpeakerLocalService(SpeakerServiceBase):
    source = "local"

    def __init__(self, proxy_id, bus) -> None:
        super().__init__(proxy_id, bus)
        self._stream: Optional[Any] = None
        self._buf = bytearray()
        self._lock = threading.Lock()
        self._player_task: Optional[asyncio.Task] = None
        self._pcm: bytes = b""          # decoded file/url source
        self._pos: int = 0              # byte cursor into _pcm
        self._seq = 0

    # ─── device enumeration / open / close ────────────────────────────
    async def _enumerate_devices(self) -> List[Dict[str, Any]]:
        sd = _sd()
        try:
            default_out = sd.default.device[1]
        except Exception:  # noqa: BLE001
            default_out = None
        out: List[Dict[str, Any]] = []
        for idx, dev in enumerate(sd.query_devices()):
            if int(dev.get("max_output_channels", 0)) <= 0:
                continue
            out.append({"id": str(idx), "label": dev.get("name") or f"device {idx}", "default": idx == default_out})
        return out

    async def _open(self) -> None:
        if self._stream is not None:
            await self._close()
        sd = _sd()
        device = int(self.config.device_id) if self.config.device_id not in (None, "") else None
        with self._lock:
            self._buf.clear()
        stream = sd.RawOutputStream(
            samplerate=self.config.sample_rate, blocksize=self.frame_samples,
            channels=self.config.channels, dtype="int16", device=device, callback=self._on_output)
        stream.start()
        self._stream = stream
        logger.info("speaker_local %s: playback open (device=%s)", self.proxy_id, device)
        # Persistent player task: drives file/url playback off the cursor +
        # transport flags. Idle for topic/sink inputs.
        if self._player_task is None or self._player_task.done():
            self._player_task = asyncio.create_task(self._player_loop())
        if (self.config.input_kind or None) in ("file", "url"):
            await self._load_source()

    async def _close(self) -> None:
        task, self._player_task = self._player_task, None
        if task is not None:
            task.cancel()
        stream, self._stream = self._stream, None
        if stream is not None:
            try:
                stream.stop(); stream.close()
            except Exception:  # noqa: BLE001
                logger.exception("speaker_local %s: stream close failed", self.proxy_id)
        with self._lock:
            self._buf.clear()

    async def _on_input_changed(self) -> None:
        # Switch source live (device stays open). Load + autoplay file/url;
        # clear the cursor for topic/sink.
        if not self._connected:
            return
        if (self.config.input_kind or None) in ("file", "url"):
            await self._load_source()
        else:
            self._pcm = b""; self._pos = 0
            self._playing = False; self._duration_s = 0.0; self._position_s = 0.0

    async def _on_transport(self, action: str) -> None:
        if action == "stop":
            self._pos = 0
            with self._lock:
                self._buf.clear()
        elif action == "seek":
            self._pos = max(0, min(len(self._pcm), int(self._position_s * self._bytes_per_sec)))
            with self._lock:
                self._buf.clear()   # drop already-queued audio so seek is snappy
        elif action == "play" and not self._pcm and (self.config.input_kind or None) in ("file", "url"):
            await self._load_source()

    # ─── server-side file browser (for the file input) ────────────────
    @service_method("browse_files")
    async def m_browse_files(self, path: Optional[str] = None) -> Dict[str, Any]:
        """List a directory on the SERVER for the generic-player file
        picker: subdirectories + audio files only. Navigates with the
        returned ``parent``/``dirs``; ``roots`` are quick-jump shortcuts.
        Audio I/O runs on the server, so the file lives on the server."""
        start = (path or "").strip() or os.environ.get("ROBOTLAB_X_DATA_DIR_ABS") or os.path.expanduser("~")
        p = Path(start).expanduser()
        try:
            p = p.resolve()
        except Exception:  # noqa: BLE001
            pass
        if not p.is_dir():
            p = p.parent if p.parent.is_dir() else Path.home()
        dirs: List[str] = []
        files: List[Dict[str, Any]] = []
        warn: Optional[str] = None
        try:
            for entry in sorted(p.iterdir(), key=lambda e: e.name.lower()):
                if entry.name.startswith("."):
                    continue
                try:
                    if entry.is_dir():
                        dirs.append(entry.name)
                    elif entry.suffix.lower() in _AUDIO_EXTS:
                        files.append({"name": entry.name, "size": entry.stat().st_size})
                except OSError:
                    continue
        except PermissionError:
            warn = "permission denied"
        except Exception as exc:  # noqa: BLE001
            warn = str(exc)
        parent = str(p.parent) if str(p.parent) != str(p) else None
        return {"path": str(p), "parent": parent, "dirs": dirs, "files": files,
                "roots": self._fs_roots(), "warn": warn}

    async def _expand_folder(self, path: str) -> List[Dict[str, Any]]:
        """Every audio file in a server folder, as playlist items."""
        p = Path((path or "").strip()).expanduser()
        try:
            p = p.resolve()
        except Exception:  # noqa: BLE001
            pass
        if not p.is_dir():
            return []
        items: List[Dict[str, Any]] = []
        try:
            for e in sorted(p.iterdir(), key=lambda x: x.name.lower()):
                if e.name.startswith("."):
                    continue
                try:
                    if e.is_file() and e.suffix.lower() in _AUDIO_EXTS:
                        items.append({"kind": "file", "ref": str(e), "name": e.name})
                except OSError:
                    continue
        except (PermissionError, OSError):
            pass
        return items

    def _fs_roots(self) -> List[Dict[str, str]]:
        roots = [{"label": "Home", "path": os.path.expanduser("~")}]
        data = os.environ.get("ROBOTLAB_X_DATA_DIR_ABS")
        if data:
            roots.append({"label": "Data", "path": data})
        roots.append({"label": "Root", "path": "/"})
        return roots

    # ─── topic/sink playback (base routes frames here) ────────────────
    async def _play_pcm(self, pcm: bytes, frame: Dict[str, Any]) -> None:
        self._enqueue(self._scale_volume(pcm))

    # ─── file / url generic player ────────────────────────────────────
    @property
    def _bytes_per_sec(self) -> int:
        return self.config.sample_rate * self.config.channels * 2

    async def _load_source(self) -> None:
        """Fetch + decode the current file/url source, then autoplay from 0."""
        kind = self.config.input_kind
        ref = (self.config.input_ref or "").strip()
        self._pcm = b""; self._pos = 0; self._duration_s = 0.0; self._position_s = 0.0
        if not ref:
            self._last_error = f"{kind} input has no reference"
            await self._publish_state(); return
        try:
            data = await asyncio.to_thread(self._fetch, kind, ref)
            self._pcm = await asyncio.to_thread(self._decode, data, ref)
        except Exception as exc:  # noqa: BLE001
            logger.exception("speaker_local %s: load %s failed", self.proxy_id, ref)
            self._last_error = f"play {ref}: {exc}"
            await self._publish_state(); return
        self._duration_s = len(self._pcm) / self._bytes_per_sec if self._bytes_per_sec else 0.0
        self._last_error = None
        self._playing = True; self._paused = False
        await self._publish_state()

    async def _player_loop(self) -> None:
        """Single persistent task: streams the decoded source into the output.

        Keeps the output buffer filled WELL AHEAD of real time (a ~250ms
        high-water mark). The PortAudio callback drains at exactly the device
        rate; producing ahead absorbs scheduler jitter so the callback never
        starves — which is what was causing the periodic click/chirp
        (underrun → silence pad on every late wake). The level meter rides a
        throttled state publish rather than a per-frame bus publish (which
        added latency in the hot path)."""
        bpf = self.frame_samples * self.config.channels * 2
        period = self.config.frame_ms / 1000.0
        target = bpf * 12           # ~240ms of audio queued ahead of the device
        from rlx_audio import level_rms  # local import
        last_state = 0.0
        last_viz = 0.0
        while True:
            if not (self._playing and not self._paused and self._pos < len(self._pcm)):
                if self._playing and self._pcm and self._pos >= len(self._pcm):
                    # Track finished → advance the play set / loop / stop.
                    await self._on_track_ended()
                    if not self._playing:
                        self._position_s = self._duration_s
                        self._level = 0.0
                        await self._publish_state()
                await asyncio.sleep(0.05)
                continue

            if self.muted:
                # Advance the timeline at real time but emit nothing — the
                # device drains to silence; unmute resumes in place.
                self._pos = min(len(self._pcm), self._pos + bpf)
                self._level = 0.0
            else:
                with self._lock:
                    buffered = len(self._buf)
                last_out = None
                while buffered < target and self._pos < len(self._pcm):
                    chunk = self._pcm[self._pos:self._pos + bpf]
                    self._pos += len(chunk)
                    out = self._scale_volume(chunk)
                    with self._lock:
                        self._buf.extend(out)
                    buffered += len(out)
                    last_out = out
                if last_out is not None:
                    self._level = level_rms(last_out)

            self._position_s = self._pos / self._bytes_per_sec
            if self._position_s - last_state >= 0.15:   # ~6Hz UI position/meter
                last_state = self._position_s
                await self._publish_state()
            # Waveform viewport: publish a small decimated slice taken at the
            # AUDIBLE position (cursor minus what's still queued ahead) so the
            # scope tracks what's actually coming out of the device.
            if not self.muted and self._position_s - last_viz >= _VIZ_PERIOD_S:
                last_viz = self._position_s
                await self._publish_viz()
            await asyncio.sleep(period)

    async def _publish_viz(self) -> None:
        with self._lock:
            buffered = len(self._buf)
        audible = max(0, self._pos - buffered)
        win = self._pcm[audible: audible + self.frame_samples * self.config.channels * 6]
        if len(win) < 2:
            return
        samples = array.array("h")
        samples.frombytes(win[: len(win) - (len(win) % 2)])
        step = max(1, len(samples) // _VIZ_SAMPLES)
        deci = samples[::step][:_VIZ_SAMPLES]
        self._seq += 1
        try:
            await self.publish("viz", encode_frame(self._seq, time.time(),
                               self.config.sample_rate, 1, deci.tobytes()))
        except Exception:  # noqa: BLE001
            pass

    async def _on_mute_changed(self, muted: bool) -> None:
        # Drop already-queued audio so mute takes effect immediately rather
        # than after the ~250ms look-ahead drains.
        if muted:
            with self._lock:
                self._buf.clear()

    def _fetch(self, kind: Optional[str], ref: str) -> bytes:
        if kind == "url":
            with urllib.request.urlopen(ref, timeout=_FETCH_TIMEOUT_S) as resp:  # noqa: S310
                return resp.read()
        with open(ref, "rb") as fh:
            return fh.read()

    def _decode(self, data: bytes, ref: str) -> bytes:
        """Return s16le PCM at the configured sample_rate/channels."""
        is_wav = data[:4] == b"RIFF" or ref.lower().endswith(".wav")
        if is_wav:
            with wave.open(io.BytesIO(data), "rb") as w:
                if w.getsampwidth() == 2 and w.getframerate() == self.config.sample_rate and w.getnchannels() == self.config.channels:
                    return w.readframes(w.getnframes())
                # Mismatched WAV → fall through to miniaudio for res/remix.
        try:
            import miniaudio  # noqa: PLC0415
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("unsupported audio format (install miniaudio, or use a WAV matching the configured rate)") from exc
        dec = miniaudio.decode(
            data, output_format=miniaudio.SampleFormat.SIGNED16,
            nchannels=self.config.channels, sample_rate=self.config.sample_rate)
        return bytes(dec.samples.tobytes())

    # ─── buffer + output callback ─────────────────────────────────────
    def _enqueue(self, pcm: bytes) -> None:
        with self._lock:
            self._buf.extend(pcm)
            if len(self._buf) > _MAX_BUFFER_BYTES:
                del self._buf[: len(self._buf) - _MAX_BUFFER_BYTES]

    def _on_output(self, outdata, frames, time_info, status) -> None:  # noqa: ANN001
        need = len(outdata)
        with self._lock:
            n = min(need, len(self._buf))
            outdata[:n] = bytes(self._buf[:n])
            del self._buf[:n]
        if n < need:
            outdata[n:] = b"\x00" * (need - n)
