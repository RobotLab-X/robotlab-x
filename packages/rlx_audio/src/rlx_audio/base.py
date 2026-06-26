"""Shared audio-device capability for robotlab_x — microphones + speakers.

Two capabilities, one shared control interface so a host-captured and a
browser-captured device of the same kind are interchangeable:

    microphone  — captures audio → publishes frames on /microphone/{id}/audio
    speaker     — plays frames arriving on /speaker/{id}/audio

Both subclass ``AudioDeviceServiceBase`` and share the EXACT control
surface + state shape:

    list_devices / select_device / connect / disconnect / mute / unmute /
    set_params

``connect`` opens the selected device and records it as
``last_connected_source`` (re-applied on the next start, like a servo's
attach intent). ``mute``/``unmute`` suspend/resume the audio flow without
releasing the device. Each base then implements only the transport hooks
(``_enumerate_devices`` / ``_open`` / ``_close`` and, per kind, frame
produce/consume), so a PortAudio service and a browser-relay service expose
an IDENTICAL interface + publish shape despite very different data flow.

``type_name`` is shared per kind (all microphones publish under
``/microphone/...``; all speakers under ``/speaker/...``) so consumers
subscribe by capability, not by concrete service type.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import random
import re
import time
import wave
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Any, ClassVar, Dict, List, Optional

from pydantic import Field
from rlx_bus import ServiceConfig, SubprocessService, service_method

from .frames import (
    FORMAT,
    decode_frame,
    encode_frame,
    level_rms,
    read_wav_pcm,
    remix_channels,
    resample_s16le,
)

logger = logging.getLogger(__name__)

_SAMPLE_WIDTH = 2  # bytes — pcm_s16le
_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


class AudioDeviceConfig(ServiceConfig):
    """Persisted config shared by microphones + speakers."""

    device_id: Optional[str] = Field(
        None, description="Selected device id (opaque, backend-specific). None = default device.")
    last_connected_source: Optional[str] = Field(
        None, description="The device id last successfully connected to — re-applied on restart and shown in the UI.")
    sample_rate: int = Field(16000, ge=8000, le=48000, description="Sample rate in Hz.")
    channels: int = Field(1, ge=1, le=2, description="1 = mono (default), 2 = stereo.")
    frame_ms: int = Field(20, ge=5, le=100, description="Audio frame size in milliseconds.")
    connected: bool = Field(
        False, description="Desired connection state — set True on connect, False on disconnect; re-applied on restart.")
    muted: bool = Field(
        False, description="When True the device stays connected but audio flow is suspended.")


class AudioDeviceServiceBase(SubprocessService):
    """Common control interface for an audio input/output device."""

    config_class: ClassVar = AudioDeviceConfig
    publishes: ClassVar[List[str]] = ["state"]
    source: ClassVar[str] = "local"        # "local" host capture/playback vs "browser"
    kind: ClassVar[str] = "audio"          # "microphone" | "speaker"
    # When True the device is opened automatically on service start and there
    # is no user-facing connect/disconnect — the device is simply "always on".
    # Speakers set this (audio output is just a routed line, not a managed
    # connection); microphones leave it False (capturing is an explicit act).
    auto_connect: ClassVar[bool] = False

    def __init__(self, proxy_id, bus) -> None:
        super().__init__(proxy_id, bus)
        self._devices: List[Dict[str, Any]] = []
        self._connected: bool = False
        self._level: float = 0.0
        self._dropped: int = 0
        self._last_error: Optional[str] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    # ─── lifecycle ────────────────────────────────────────────────────
    async def on_start(self) -> None:
        self._loop = asyncio.get_running_loop()
        try:
            self._devices = await self._enumerate_devices()
        except Exception as exc:  # noqa: BLE001
            logger.exception("%s: device enumeration failed", self.proxy_id)
            self._last_error = str(exc)
        await self._publish_state()
        if type(self).auto_connect or self.config.connected:
            await self._safe_connect()
            await self._publish_state()   # reflect the now-connected state

    async def on_stop(self) -> None:
        try:
            await self._close()
        except Exception:  # noqa: BLE001
            logger.exception("%s: close on stop failed", self.proxy_id)

    # ─── transport hooks (subclasses implement) ───────────────────────
    async def _enumerate_devices(self) -> List[Dict[str, Any]]:
        raise NotImplementedError

    async def _open(self) -> None:
        raise NotImplementedError

    async def _close(self) -> None:
        raise NotImplementedError

    async def _on_mute_changed(self, muted: bool) -> None:
        """Optional hook — subclasses react to a mute toggle (e.g. flush)."""

    # ─── control interface (the capability) ───────────────────────────
    @service_method("list_devices", publishes=["state"])
    async def m_list_devices(self) -> Dict[str, Any]:
        """Rescan devices, republish state, return the list."""
        self._devices = await self._enumerate_devices()
        await self._publish_state()
        return {"devices": self._devices}

    @service_method("select_device", publishes=["state"])
    async def m_select_device(self, device_id: Optional[str] = None) -> Dict[str, Any]:
        """Choose the device. Reconnects if currently connected."""
        await self.update_config({"device_id": device_id})
        if self._connected:
            await self._close()
            await self._safe_connect()
        await self._publish_state()
        return self._snapshot()

    @service_method("connect", publishes=["state"])
    async def m_connect(self) -> Dict[str, Any]:
        """Open the selected device and begin (capture / playback-ready).
        Records the device as last_connected_source."""
        await self.update_config({"connected": True})
        await self._safe_connect()
        await self._publish_state()
        return self._snapshot()

    @service_method("disconnect", publishes=["state"])
    async def m_disconnect(self) -> Dict[str, Any]:
        """Release the device. Keeps last_connected_source for next time."""
        await self.update_config({"connected": False})
        try:
            await self._close()
        except Exception as exc:  # noqa: BLE001
            logger.exception("%s: disconnect failed", self.proxy_id)
            self._last_error = str(exc)
        self._connected = False
        self._level = 0.0
        await self._publish_state()
        return self._snapshot()

    @service_method("set_muted", publishes=["state"])
    async def m_set_muted(self, muted: bool = True) -> Dict[str, Any]:
        """Suspend/resume audio flow without releasing the device."""
        flag = bool(muted)
        await self.update_config({"muted": flag})
        await self._on_mute_changed(flag)
        if flag:
            self._level = 0.0
        await self._publish_state()
        return self._snapshot()

    @service_method("mute", publishes=["state"])
    async def m_mute(self) -> Dict[str, Any]:
        return await self.m_set_muted(True)

    @service_method("unmute", publishes=["state"])
    async def m_unmute(self) -> Dict[str, Any]:
        return await self.m_set_muted(False)

    @service_method("set_params", publishes=["state"])
    async def m_set_params(
        self,
        sample_rate: Optional[int] = None,
        channels: Optional[int] = None,
        frame_ms: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Live-tune the audio format. Reconnects if currently connected."""
        updates: Dict[str, Any] = {}
        if sample_rate is not None:
            updates["sample_rate"] = int(sample_rate)
        if channels is not None:
            updates["channels"] = int(channels)
        if frame_ms is not None:
            updates["frame_ms"] = int(frame_ms)
        if updates:
            await self.update_config(updates)
        if self._connected:
            await self._close()
            await self._safe_connect()
        await self._publish_state()
        return self._snapshot()

    # ─── helpers ──────────────────────────────────────────────────────
    @property
    def muted(self) -> bool:
        return bool(self.config.muted)

    @property
    def frame_samples(self) -> int:
        return max(1, int(self.config.sample_rate * self.config.frame_ms / 1000))

    async def _safe_connect(self) -> None:
        try:
            await self._open()
            self._connected = True
            self._last_error = None
            # Remember the device we actually connected to.
            await self.update_config({"last_connected_source": self.config.device_id})
        except Exception as exc:  # noqa: BLE001
            logger.exception("%s: connect failed", self.proxy_id)
            self._connected = False
            self._last_error = str(exc)

    def emit_pcm_threadsafe(self, pcm: bytes) -> None:
        """Hand a PCM buffer to the service loop from any thread."""
        loop = self._loop
        if loop is None:
            return
        try:
            loop.call_soon_threadsafe(self._schedule_emit, pcm)
        except RuntimeError:
            pass

    def _schedule_emit(self, pcm: bytes) -> None:
        asyncio.create_task(self._emit_pcm(pcm))

    async def _emit_pcm(self, pcm: bytes) -> None:  # overridden by producers
        raise NotImplementedError

    def _base_snapshot(self) -> Dict[str, Any]:
        return {
            "connected": self._connected,
            "muted": self.muted,
            "device_id": self.config.device_id,
            "last_connected_source": self.config.last_connected_source,
            "devices": self._devices,
            "sample_rate": self.config.sample_rate,
            "channels": self.config.channels,
            "frame_ms": self.config.frame_ms,
            "format": FORMAT,
            "level_rms": round(self._level, 4),
            "dropped": self._dropped,
            "last_error": self._last_error,
            "source": type(self).source,
            "kind": type(self).kind,
        }

    def _snapshot(self) -> Dict[str, Any]:
        return self._base_snapshot()

    async def _publish_state(self) -> None:
        await self.publish("state", self._snapshot(), retained=True)


# ─── microphone ───────────────────────────────────────────────────────


class MicrophoneConfig(AudioDeviceConfig):
    """Microphone config (currently identical to the device base)."""


class MicrophoneServiceBase(AudioDeviceServiceBase):
    """An audio INPUT device: captures PCM → /microphone/{id}/audio, with
    optional save-to-file. Subclasses implement capture in _open/_close and
    feed PCM to ``emit_pcm_threadsafe`` (host) or ``_record_from_frame``
    (bus-relayed)."""

    type_name: ClassVar[str] = "microphone"
    kind: ClassVar[str] = "microphone"
    config_class: ClassVar = MicrophoneConfig
    publishes: ClassVar[List[str]] = ["state", "audio"]

    def __init__(self, proxy_id, bus) -> None:
        super().__init__(proxy_id, bus)
        self._seq: int = 0
        self._wav: Optional[wave.Wave_write] = None
        self._recording: bool = False
        self._recording_path: Optional[str] = None
        self._recorded_bytes: int = 0
        self._suggested_path: Optional[str] = None

    async def on_start(self) -> None:
        self._suggested_path = self._fresh_suggested_path()
        await super().on_start()

    async def on_stop(self) -> None:
        self._close_wav()
        await super().on_stop()

    async def _emit_pcm(self, pcm: bytes) -> None:
        """Publish one captured frame (gated by mute) + write to file."""
        if self.muted:
            return
        self._seq += 1
        self._level = level_rms(pcm)
        frame = encode_frame(self._seq, time.time(), self.config.sample_rate, self.config.channels, pcm)
        self._record_pcm(pcm)   # local capture → file directly (no bus round-trip)
        try:
            await self.publish("audio", frame, retained=False)
        except Exception:  # noqa: BLE001
            self._dropped += 1
            logger.debug("%s: audio frame publish failed", self.proxy_id, exc_info=True)

    # ─── save-to-file ─────────────────────────────────────────────────
    @service_method("start_recording", publishes=["state"])
    async def m_start_recording(self, path: Optional[str] = None) -> Dict[str, Any]:
        """Save captured audio to a WAV file. ``path`` overrides the auto
        name (a bare filename lands in the recordings dir; absolute as-is).
        Ensures the device is connected so the file receives audio."""
        if self._recording:
            self._close_wav()
        target = self._resolve_recording_path(path)
        if not self._connected:
            await self._safe_connect()
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            wav = wave.open(str(target), "wb")
            wav.setnchannels(self.config.channels)
            wav.setsampwidth(_SAMPLE_WIDTH)
            wav.setframerate(self.config.sample_rate)
            self._wav = wav
            self._recording = True
            self._recording_path = str(target)
            self._recorded_bytes = 0
            self._last_error = None
            logger.info("%s: recording to %s", self.proxy_id, target)
        except Exception as exc:  # noqa: BLE001
            logger.exception("%s: could not open recording file", self.proxy_id)
            self._last_error = f"recording failed: {exc}"
        await self._publish_state()
        return self._snapshot()

    @service_method("stop_recording", publishes=["state"])
    async def m_stop_recording(self) -> Dict[str, Any]:
        """Close the recording file (capture keeps running)."""
        path, nbytes = self._recording_path, self._recorded_bytes
        self._close_wav()
        self._suggested_path = self._fresh_suggested_path()
        await self._publish_state()
        dur = nbytes / (self.config.sample_rate * self.config.channels * _SAMPLE_WIDTH) if nbytes else 0.0
        return {"path": path, "bytes": nbytes, "duration_s": round(dur, 2)}

    def _recordings_dir(self) -> Path:
        base = os.environ.get("ROBOTLAB_X_DATA_DIR_ABS") or os.path.join(os.getcwd(), "data")
        return Path(base) / "recordings"

    def _fresh_suggested_path(self) -> str:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        return str(self._recordings_dir() / f"{self.proxy_id}-{stamp}.wav")

    def _resolve_recording_path(self, path: Optional[str]) -> Path:
        chosen = (path or "").strip() or self._fresh_suggested_path()
        p = Path(chosen)
        if not p.is_absolute() and os.sep not in chosen and "/" not in chosen:
            p = self._recordings_dir() / _SAFE_NAME_RE.sub("_", chosen)
        if p.suffix.lower() != ".wav":
            p = p.with_suffix(".wav")
        return p

    def _record_pcm(self, pcm: bytes) -> None:
        wav = self._wav
        if wav is None:
            return
        try:
            wav.writeframes(pcm)
            self._recorded_bytes += len(pcm)
        except Exception:  # noqa: BLE001
            logger.exception("%s: writeframes failed", self.proxy_id)

    async def _record_from_frame(self, frame: Any) -> None:
        """Feed the recorder from a bus audio frame (browser-relay path)."""
        if self._recording and isinstance(frame, dict):
            self._record_pcm(decode_frame(frame))

    def _close_wav(self) -> None:
        wav, self._wav = self._wav, None
        self._recording = False
        if wav is not None:
            try:
                wav.close()
            except Exception:  # noqa: BLE001
                logger.exception("%s: closing recording failed", self.proxy_id)

    def _snapshot(self) -> Dict[str, Any]:
        snap = self._base_snapshot()
        snap.update({
            "recording": self._recording,
            "recording_path": self._recording_path,
            "recording_suggested_path": self._suggested_path,
            "recorded_bytes": self._recorded_bytes,
        })
        return snap


# ─── speaker ──────────────────────────────────────────────────────────


class SpeakerConfig(AudioDeviceConfig):
    """Speaker config — a generic player. ``input_kind`` selects where audio
    comes from; ``input_ref`` is the matching reference:

      None / "" → play frames published to /speaker/{id}/audio (the sink)
      "topic"   → input_ref is a bus topic (e.g. /microphone/mic-1/audio)
      "file"    → input_ref is a file path (server path for the host speaker;
                  a browser-picked file for the browser speaker)
      "url"     → input_ref is an http(s) URL to an audio file/stream
    """

    input_kind: Optional[str] = Field(
        None, description="Input source kind: None (sink) | 'topic' | 'file' | 'url'.")
    input_ref: Optional[str] = Field(
        None, description="Input reference: a bus topic, file path, or URL — per input_kind.")
    volume: float = Field(
        1.0, ge=0.0, le=1.0, description="Output volume 0.0–1.0 (applied to all playback).")
    # Play set (playlist) — an ordered collection of file/url tracks the
    # player walks through. Each item is {kind, ref, name?}.
    playlist: List[Dict[str, Any]] = Field(
        default_factory=list, description="Ordered tracks: [{kind:'file'|'url', ref, name?}].")
    playlist_index: int = Field(-1, description="Index of the current track in the playlist (-1 = none).")
    repeat: str = Field("off", description="Repeat mode: 'off' | 'all' (loop playlist) | 'one' (loop song).")
    shuffle: bool = Field(False, description="Play the playlist in a shuffled order.")


class SpeakerServiceBase(AudioDeviceServiceBase):
    """An audio OUTPUT device + generic player. Plays the selected input:
    the default sink topic, another bus topic, a file, or a URL. Subclasses
    implement device playback in _open/_close + ``_play_pcm`` and, for
    file/url inputs, the source reader via ``_on_input_changed``."""

    type_name: ClassVar[str] = "speaker"
    kind: ClassVar[str] = "speaker"
    config_class: ClassVar = SpeakerConfig
    publishes: ClassVar[List[str]] = ["state"]
    auto_connect: ClassVar[bool] = True   # output is always-on; no connect UI

    def __init__(self, proxy_id, bus) -> None:
        super().__init__(proxy_id, bus)
        self._subscribed_topics: set = set()
        # Transport state (meaningful for finite file/url sources).
        self._playing: bool = False
        self._paused: bool = False
        self._position_s: float = 0.0
        self._duration_s: float = 0.0
        self._order: List[int] = []   # play order (shuffled or identity)

    async def on_start(self) -> None:
        # The default sink — frames addressed straight to this speaker.
        await self.subscribe("audio", self._on_sink_frame)
        await self._ensure_topic_sub()
        await super().on_start()

    # ─── input selection ──────────────────────────────────────────────
    @service_method("select_input", publishes=["state"])
    async def m_select_input(self, kind: Optional[str] = None, ref: Optional[str] = None) -> Dict[str, Any]:
        """Choose what to play. kind ∈ {None, 'topic', 'file', 'url'};
        ref is the topic / file path / URL. Switches live."""
        norm = (kind or "").strip().lower() or None
        if norm not in (None, "topic", "file", "url"):
            from fastapi import HTTPException  # local import; subprocess may lack fastapi at module load
            raise HTTPException(400, f"unknown input kind {kind!r}")
        await self.update_config({"input_kind": norm, "input_ref": (ref or "").strip() or None})
        if norm == "topic":
            await self._ensure_topic_sub()
        await self._on_input_changed()
        await self._publish_state()
        return self._snapshot()

    async def _ensure_topic_sub(self) -> None:
        """Subscribe to the configured topic input (once per distinct topic).
        Handlers gate on the CURRENT input, so a stale subscription from a
        previous selection simply no-ops (the bus has no unsubscribe)."""
        if (self.config.input_kind or None) != "topic":
            return
        topic = (self.config.input_ref or "").strip()
        if not topic or topic in self._subscribed_topics:
            return
        self._subscribed_topics.add(topic)
        await self.bus.subscribe(self.resolve_topic(topic), lambda f, t=topic: self._on_topic_frame(f, t))

    async def _on_input_changed(self) -> None:
        """Hook — subclasses (re)start/stop a file/url reader on a change."""

    # ─── volume + transport (media-player controls) ───────────────────
    @service_method("set_volume", publishes=["state"])
    async def m_set_volume(self, volume: float = 1.0) -> Dict[str, Any]:
        """Set output volume 0.0–1.0 (applies to all playback)."""
        v = max(0.0, min(1.0, float(volume)))
        await self.update_config({"volume": v})
        await self._on_volume_changed(v)
        await self._publish_state()
        return self._snapshot()

    @service_method("play", publishes=["state"])
    async def m_play(self) -> Dict[str, Any]:
        """Start/resume playback of the current file/url source."""
        self._playing = True
        self._paused = False
        await self._on_transport("play")
        await self._publish_state()
        return self._snapshot()

    @service_method("pause", publishes=["state"])
    async def m_pause(self) -> Dict[str, Any]:
        """Pause file/url playback, holding the position."""
        self._paused = True
        await self._on_transport("pause")
        await self._publish_state()
        return self._snapshot()

    @service_method("stop", publishes=["state"])
    async def m_stop(self) -> Dict[str, Any]:
        """Stop playback and rewind to the start."""
        self._playing = False
        self._paused = False
        self._position_s = 0.0
        await self._on_transport("stop")
        await self._publish_state()
        return self._snapshot()

    @service_method("seek", publishes=["state"])
    async def m_seek(self, seconds: float = 0.0) -> Dict[str, Any]:
        """Seek to an absolute position (seconds) in the file/url source."""
        self._position_s = max(0.0, min(float(seconds), self._duration_s or float(seconds)))
        await self._on_transport("seek")
        await self._publish_state()
        return self._snapshot()

    @service_method("skip", publishes=["state"])
    async def m_skip(self, delta_seconds: float = 0.0) -> Dict[str, Any]:
        """Relative seek — fast-forward (positive) / rewind (negative)."""
        return await self.m_seek(self._position_s + float(delta_seconds))

    async def _on_volume_changed(self, volume: float) -> None:
        """Hook — subclasses apply the new volume (gain / PCM scale)."""

    async def _on_transport(self, action: str) -> None:
        """Hook — subclasses react to play/pause/stop/seek using the
        updated _playing/_paused/_position_s state."""

    def _scale_volume(self, pcm: bytes) -> bytes:
        """Scale s16le PCM by the current volume. Returns input unchanged at
        full volume (fast path) or silence at zero."""
        v = self.config.volume
        if v >= 0.999:
            return pcm
        import array
        a = array.array("h")
        a.frombytes(pcm[: len(pcm) - (len(pcm) % 2)])
        for i in range(len(a)):
            a[i] = int(a[i] * v)
        return a.tobytes()

    # ─── play set (playlist) ──────────────────────────────────────────
    @staticmethod
    def _norm_items(items: Any) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for it in (items or []):
            if not isinstance(it, dict):
                continue
            ref = (it.get("ref") or "").strip()
            if not ref:
                continue
            kind = (it.get("kind") or ("url" if ref.startswith(("http://", "https://")) else "file")).lower()
            if kind not in ("file", "url"):
                continue
            out.append({"kind": kind, "ref": ref, "name": it.get("name") or ref.rsplit("/", 1)[-1]})
        return out

    @service_method("playlist_set", publishes=["state"])
    async def m_playlist_set(self, items: Any = None) -> Dict[str, Any]:
        """Replace the play set with ``items`` ([{kind,ref,name?}])."""
        await self.update_config({"playlist": self._norm_items(items), "playlist_index": -1})
        self._rebuild_order()
        await self._publish_state()
        return self._snapshot()

    @service_method("playlist_add", publishes=["state"])
    async def m_playlist_add(self, items: Any = None) -> Dict[str, Any]:
        """Append tracks to the play set."""
        pl = list(self.config.playlist) + self._norm_items(items)
        await self.update_config({"playlist": pl})
        self._rebuild_order()
        await self._publish_state()
        return self._snapshot()

    @service_method("playlist_add_folder", publishes=["state"])
    async def m_playlist_add_folder(self, path: Optional[str] = None) -> Dict[str, Any]:
        """Append every audio file in a folder (server-side; browser speakers
        use the view's directory picker)."""
        items = await self._expand_folder((path or "").strip())
        return await self.m_playlist_add(items)

    @service_method("playlist_remove", publishes=["state"])
    async def m_playlist_remove(self, index: int = -1) -> Dict[str, Any]:
        pl = list(self.config.playlist)
        if 0 <= int(index) < len(pl):
            pl.pop(int(index))
            cur = self.config.playlist_index
            if int(index) < cur:
                cur -= 1
            elif int(index) == cur:
                cur = min(cur, len(pl) - 1)
            await self.update_config({"playlist": pl, "playlist_index": cur})
            self._rebuild_order()
        await self._publish_state()
        return self._snapshot()

    @service_method("playlist_move", publishes=["state"])
    async def m_playlist_move(self, index: int = 0, to: int = 0) -> Dict[str, Any]:
        pl = list(self.config.playlist)
        i, j = int(index), int(to)
        if 0 <= i < len(pl) and 0 <= j < len(pl) and i != j:
            item = pl.pop(i)
            pl.insert(j, item)
            await self.update_config({"playlist": pl})
            self._rebuild_order()
        await self._publish_state()
        return self._snapshot()

    @service_method("playlist_clear", publishes=["state"])
    async def m_playlist_clear(self) -> Dict[str, Any]:
        await self.update_config({"playlist": [], "playlist_index": -1})
        self._order = []
        await self._publish_state()
        return self._snapshot()

    @service_method("play_index", publishes=["state"])
    async def m_play_index(self, index: int = 0) -> Dict[str, Any]:
        """Jump to + play playlist track ``index``."""
        if 0 <= int(index) < len(self.config.playlist):
            await self.update_config({"playlist_index": int(index)})
            await self._play_current()
        await self._publish_state()
        return self._snapshot()

    @service_method("next_track", publishes=["state"])
    async def m_next_track(self) -> Dict[str, Any]:
        await self._advance(1, auto=False)
        await self._publish_state()
        return self._snapshot()

    @service_method("previous_track", publishes=["state"])
    async def m_previous_track(self) -> Dict[str, Any]:
        await self._advance(-1, auto=False)
        await self._publish_state()
        return self._snapshot()

    @service_method("set_repeat", publishes=["state"])
    async def m_set_repeat(self, mode: str = "off") -> Dict[str, Any]:
        m = (mode or "off").lower()
        if m not in ("off", "all", "one"):
            m = "off"
        await self.update_config({"repeat": m})
        await self._publish_state()
        return self._snapshot()

    @service_method("set_shuffle", publishes=["state"])
    async def m_set_shuffle(self, enabled: bool = False) -> Dict[str, Any]:
        await self.update_config({"shuffle": bool(enabled)})
        self._rebuild_order()
        await self._publish_state()
        return self._snapshot()

    # internals
    def _rebuild_order(self) -> None:
        n = len(self.config.playlist)
        order = list(range(n))
        if self.config.shuffle and n > 1:
            random.shuffle(order)
            cur = self.config.playlist_index
            # Keep the current track first so shuffle doesn't jump immediately.
            if 0 <= cur < n and order and order[0] != cur:
                order.remove(cur)
                order.insert(0, cur)
        self._order = order

    async def _play_current(self) -> None:
        idx = self.config.playlist_index
        pl = self.config.playlist
        if not (0 <= idx < len(pl)):
            return
        item = pl[idx]
        await self.update_config({"input_kind": item.get("kind"), "input_ref": item.get("ref")})
        self._playing = True
        self._paused = False
        await self._on_input_changed()

    async def _advance(self, delta: int, auto: bool) -> None:
        pl = self.config.playlist
        n = len(pl)
        if n == 0:
            self._playing = False
            return
        if not self._order or len(self._order) != n:
            self._rebuild_order()
        cur = self.config.playlist_index
        try:
            pos = self._order.index(cur)
        except ValueError:
            pos = -1 if delta > 0 else 0
        nextpos = pos + delta
        if nextpos >= n or nextpos < 0:
            if self.config.repeat == "all":
                nextpos %= n
            elif auto:
                self._playing = False    # end of set, no repeat
                return
            else:
                nextpos = max(0, min(n - 1, nextpos))
        await self.update_config({"playlist_index": self._order[nextpos]})
        await self._play_current()

    async def _on_track_ended(self) -> None:
        """Called by a subclass when the current file/url finishes."""
        if self.config.repeat == "one":
            await self._play_current() if self.config.playlist else await self._on_input_changed()
        elif self.config.playlist:
            await self._advance(1, auto=True)
        else:
            self._playing = False

    async def _expand_folder(self, path: str) -> List[Dict[str, Any]]:
        """Return [{kind:'file',ref,name}] for audio files in a folder.
        Subclasses with filesystem access (the host speaker) override."""
        return []

    # ─── frame routing ────────────────────────────────────────────────
    async def _on_sink_frame(self, frame: Any) -> None:
        # Only the default sink mode plays /speaker/{id}/audio.
        if (self.config.input_kind or None) is None:
            await self._render_frame(frame)

    async def _on_topic_frame(self, frame: Any, topic: str) -> None:
        if (self.config.input_kind or None) == "topic" and (self.config.input_ref or "").strip() == topic:
            await self._render_frame(frame)

    async def _render_frame(self, frame: Any) -> None:
        if not self._connected or self.muted or not isinstance(frame, dict):
            return
        pcm = decode_frame(frame)
        if not pcm:
            return
        self._level = level_rms(pcm)
        try:
            await self._play_pcm(pcm, frame)
        except Exception:  # noqa: BLE001
            self._dropped += 1
            logger.debug("%s: play failed", self.proxy_id, exc_info=True)

    async def _play_pcm(self, pcm: bytes, frame: Dict[str, Any]) -> None:
        """Render PCM to the output device. Subclasses implement."""
        raise NotImplementedError

    def _snapshot(self) -> Dict[str, Any]:
        snap = self._base_snapshot()
        snap["input_kind"] = self.config.input_kind
        snap["input_ref"] = self.config.input_ref
        snap["volume"] = self.config.volume
        snap["playing"] = self._playing
        snap["paused"] = self._paused
        snap["position_s"] = round(self._position_s, 2)
        snap["duration_s"] = round(self._duration_s, 2)
        snap["playlist"] = self.config.playlist
        snap["playlist_index"] = self.config.playlist_index
        snap["repeat"] = self.config.repeat
        snap["shuffle"] = self.config.shuffle
        return snap


# ─── speech (text-to-speech) ────────────────────────────────────────────


class SpeechConfig(ServiceConfig):
    """Persisted config shared by every ``speech`` service type.

    A speech service is a frame PRODUCER (like a microphone): it streams the
    synthesized utterance as the canonical audio frames on
    ``/speech/{id}/audio``, so any speaker pointed at that topic plays it with
    no special handling. ``sample_rate`` is the WIRE rate — the base resamples
    each voice's native output to it so a default 16 kHz speaker plays at the
    right pitch."""

    voice: Optional[str] = Field(
        None, description="Selected voice id (engine-specific). None = the engine default.")
    sample_rate: int = Field(16000, ge=8000, le=48000, description="Output wire sample rate in Hz (frames are resampled to this).")
    channels: int = Field(1, ge=1, le=2, description="1 = mono (default), 2 = stereo.")
    frame_ms: int = Field(20, ge=5, le=100, description="Audio frame size in milliseconds.")
    volume: float = Field(1.0, ge=0.0, le=1.0, description="Output volume 0.0–1.0 applied to the streamed audio.")
    rate: float = Field(1.0, ge=0.5, le=2.0, description="Speaking rate multiplier (1.0 normal, >1 faster, <1 slower).")
    muted: bool = Field(False, description="When True the utterance still runs on its timeline but no audio frames are emitted.")


class SpeechServiceBase(SubprocessService):
    """Common control interface for a text-to-speech service.

    The capability contract (the action set every ``speech`` implementor
    accepts on ``/speech/{id}/control``)::

        speak(text, voice?, interrupt?)  enqueue (or interrupt+speak) an utterance
        stop()                          interrupt: drop the current utterance + queue
        mute() / unmute() / set_muted(muted)
        set_voice(voice) / list_voices()
        set_volume(volume) / set_rate(rate)
        clear_cache()

    Subclasses implement exactly TWO engine hooks:

        _synthesize(text, out_path, opts)   write a 16-bit PCM WAV (any rate)
        _list_voices()                      return [{id, label, downloaded?}]

    Everything else — the synth queue, the WAV cache (so re-saying the same
    text is instant), real-time interruptible frame streaming, mute, volume,
    rate, and the discovery/state surface — lives here so it can't drift
    between engines. The cache lives at ``<DATA>/<type_name>/`` and each entry
    is a finished WAV at the configured wire rate, so it doubles as a file a
    speaker can play directly via ``input_kind: file``."""

    type_name: ClassVar[str] = "speech"
    kind: ClassVar[str] = "speech"
    config_class: ClassVar = SpeechConfig
    publishes: ClassVar[List[str]] = ["state", "audio", "spoken"]
    source: ClassVar[str] = "local"

    _STATE_PERIOD_S = 0.15   # ~6 Hz UI position/meter while speaking

    def __init__(self, proxy_id, bus) -> None:
        super().__init__(proxy_id, bus)
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._queue: "asyncio.Queue[Dict[str, Any]]" = asyncio.Queue()
        self._worker: Optional[asyncio.Task] = None
        self._gen: int = 0                 # bumped to invalidate in-flight + queued work
        self._pending: List[str] = []      # texts still queued (for the state view)
        self._voices: List[Dict[str, Any]] = []
        self._level: float = 0.0
        self._seq: int = 0
        self._speaking: bool = False
        self._synthesizing: bool = False
        self._current_text: Optional[str] = None
        self._last_error: Optional[str] = None
        self._cache_count: int = 0
        self._cache_bytes: int = 0

    # ─── lifecycle ────────────────────────────────────────────────────
    async def on_start(self) -> None:
        self._loop = asyncio.get_running_loop()
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        try:
            self._voices = await asyncio.to_thread(self._list_voices)
        except Exception as exc:  # noqa: BLE001
            logger.exception("%s: voice enumeration failed", self.proxy_id)
            self._last_error = str(exc)
        self._refresh_cache_stats()
        self._worker = asyncio.create_task(self._worker_loop())
        await self._publish_state()

    async def on_stop(self) -> None:
        self._gen += 1
        worker, self._worker = self._worker, None
        if worker is not None:
            worker.cancel()

    # ─── engine hooks (subclasses implement) ──────────────────────────
    def _synthesize(self, text: str, out_path: str, opts: Dict[str, Any]) -> None:
        """Synthesize ``text`` to a 16-bit PCM WAV at ``out_path`` (any sample
        rate/channel count — the base conditions it to the wire format).
        Runs in a worker thread. ``opts`` carries ``voice`` and ``rate``."""
        raise NotImplementedError

    def _list_voices(self) -> List[Dict[str, Any]]:
        """Return available voices as ``[{id, label, downloaded?}]``. Runs in
        a worker thread (may touch disk/network)."""
        return []

    # ─── the speech capability ────────────────────────────────────────
    # ``speak`` is the verb the brain's conversation workflows + the chat
    # text stand-in already use (repo/chat/, conversation_session's
    # allowed_tools.yaml allows speak/listen on /speech/*/control) — so a
    # running speech service is a drop-in TTS tool for the brain.
    @service_method("speak", publishes=["audio", "spoken", "state"])
    async def m_speak(self, text: str = "", voice: Optional[str] = None, interrupt: bool = False) -> Dict[str, Any]:
        """Speak ``text``. Enqueues behind any in-progress utterance unless
        ``interrupt`` is True (then it stops the current speech + clears the
        queue first). ``voice`` overrides the default for this utterance.
        Returns immediately (synthesis + playback run on the queue worker)."""
        text = (text or "").strip()
        if not text:
            return self._snapshot()
        if interrupt:
            await self._interrupt()
        item = {
            "text": text,
            "voice": (voice or self.config.voice) or None,
            "rate": self.config.rate,
            "gen": self._gen,
        }
        self._pending.append(text)
        await self._queue.put(item)
        await self._publish_state()
        key = self._cache_key(item["voice"], item["rate"], text)
        return {"spoken": text, "queued": len(self._pending), "cache_key": key,
                "cached": (self.cache_dir / f"{key}.wav").exists()}

    @service_method("stop", publishes=["state"])
    async def m_stop(self) -> Dict[str, Any]:
        """Interrupt immediately: abort the current utterance and drop every
        queued one."""
        await self._interrupt()
        await self._publish_state()
        return self._snapshot()

    @service_method("set_muted", publishes=["state"])
    async def m_set_muted(self, muted: bool = True) -> Dict[str, Any]:
        """Mute/unmute. A muted utterance still advances on its timeline but
        emits no audio frames (unmute resumes mid-utterance)."""
        await self.update_config({"muted": bool(muted)})
        if muted:
            self._level = 0.0
        await self._publish_state()
        return self._snapshot()

    @service_method("mute", publishes=["state"])
    async def m_mute(self) -> Dict[str, Any]:
        return await self.m_set_muted(True)

    @service_method("unmute", publishes=["state"])
    async def m_unmute(self) -> Dict[str, Any]:
        return await self.m_set_muted(False)

    @service_method("set_voice", publishes=["state"])
    async def m_set_voice(self, voice: Optional[str] = None) -> Dict[str, Any]:
        """Set the default voice for subsequent ``say`` calls."""
        await self.update_config({"voice": (voice or "").strip() or None})
        await self._publish_state()
        return self._snapshot()

    @service_method("list_voices", publishes=["state"])
    async def m_list_voices(self) -> Dict[str, Any]:
        """Re-enumerate available voices, republish state, return the list."""
        try:
            self._voices = await asyncio.to_thread(self._list_voices)
        except Exception as exc:  # noqa: BLE001
            self._last_error = str(exc)
        await self._publish_state()
        return {"voices": self._voices}

    @service_method("set_volume", publishes=["state"])
    async def m_set_volume(self, volume: float = 1.0) -> Dict[str, Any]:
        """Set output volume 0.0–1.0."""
        await self.update_config({"volume": max(0.0, min(1.0, float(volume)))})
        await self._publish_state()
        return self._snapshot()

    @service_method("set_rate", publishes=["state"])
    async def m_set_rate(self, rate: float = 1.0) -> Dict[str, Any]:
        """Set the speaking-rate multiplier (1.0 normal, >1 faster)."""
        await self.update_config({"rate": max(0.5, min(2.0, float(rate)))})
        await self._publish_state()
        return self._snapshot()

    @service_method("clear_cache", publishes=["state"])
    async def m_clear_cache(self) -> Dict[str, Any]:
        """Delete every cached utterance WAV (voices are kept)."""
        removed = 0
        for f in self.cache_dir.glob("*.wav"):
            try:
                f.unlink(); removed += 1
            except OSError:
                pass
        self._refresh_cache_stats()
        await self._publish_state()
        return {"removed": removed}

    # ─── synth queue worker ───────────────────────────────────────────
    async def _interrupt(self) -> None:
        """Invalidate in-flight + queued work and clear the pending list."""
        self._gen += 1
        self._pending.clear()
        while not self._queue.empty():
            try:
                self._queue.get_nowait()
            except asyncio.QueueEmpty:
                break
        self._speaking = False
        self._synthesizing = False
        self._current_text = None
        self._level = 0.0

    async def _worker_loop(self) -> None:
        while True:
            item = await self._queue.get()
            if item.get("gen") != self._gen:
                continue   # a stop() landed after this was enqueued
            if self._pending and self._pending[0] == item["text"]:
                self._pending.pop(0)
            try:
                await self._speak_item(item)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.exception("%s: utterance failed", self.proxy_id)
                self._last_error = str(exc)
                self._speaking = False
                self._synthesizing = False
                self._current_text = None
                await self._publish_state()

    async def _speak_item(self, item: Dict[str, Any]) -> None:
        gen = item["gen"]
        text, voice, rate = item["text"], item["voice"], item["rate"]
        key = self._cache_key(voice, rate, text)
        path = self.cache_dir / f"{key}.wav"
        was_cached = path.exists()
        self._current_text = text
        self._last_error = None
        if not was_cached:
            self._synthesizing = True
            await self._publish_state()
            await asyncio.to_thread(self._build_cache_entry, text, str(path), voice, rate)
            self._synthesizing = False
            self._refresh_cache_stats()
        if gen != self._gen:        # interrupted while synthesizing
            return
        pcm, srate, ch = await asyncio.to_thread(read_wav_pcm, str(path))
        duration_s = len(pcm) / max(1, srate * ch * 2)
        await self.publish("spoken", {
            "text": text, "voice": voice, "cache_key": key, "path": str(path),
            "cached": was_cached, "duration_s": round(duration_s, 3),
            "sample_rate": srate, "channels": ch, "format": FORMAT,
        })
        await self._stream_pcm(pcm, srate, ch, gen)

    async def _stream_pcm(self, pcm: bytes, srate: int, ch: int, gen: int) -> None:
        """Pace the cached PCM onto the bus in real time so ``stop`` (a gen
        bump) aborts within one frame."""
        bpf = max(1, int(srate * self.config.frame_ms / 1000)) * ch * 2
        period = self.config.frame_ms / 1000.0
        self._speaking = True
        await self._publish_state()
        last_state = 0.0
        pos = 0
        n = len(pcm)
        while pos < n:
            if gen != self._gen:    # interrupted
                break
            chunk = pcm[pos:pos + bpf]
            pos += len(chunk)
            if not self.config.muted:
                out = self._scale_volume(chunk)
                self._level = level_rms(out)
                self._seq += 1
                try:
                    await self.publish("audio", encode_frame(self._seq, time.time(), srate, ch, out))
                except Exception:  # noqa: BLE001
                    logger.debug("%s: audio frame publish failed", self.proxy_id, exc_info=True)
            else:
                self._level = 0.0
            now = pos / max(1, srate * ch * 2)
            if now - last_state >= self._STATE_PERIOD_S:
                last_state = now
                await self._publish_state()
            await asyncio.sleep(period)
        if gen == self._gen:
            self._speaking = False
            self._current_text = None
            self._level = 0.0
            await self._publish_state()

    # ─── cache + conditioning ─────────────────────────────────────────
    def _build_cache_entry(self, text: str, out_path: str, voice: Optional[str], rate: float) -> None:
        """Blocking: synthesize to a temp WAV, then condition it to the wire
        rate/channels and write the canonical cache entry. Runs in a thread."""
        tmp = out_path + ".tmp.wav"
        self._synthesize(text, tmp, {"voice": voice, "rate": rate})
        pcm, srate, ch = read_wav_pcm(tmp)
        pcm = remix_channels(pcm, ch, self.config.channels)
        pcm = resample_s16le(pcm, srate, self.config.sample_rate, self.config.channels)
        with wave.open(out_path, "wb") as w:
            w.setnchannels(self.config.channels)
            w.setsampwidth(2)
            w.setframerate(self.config.sample_rate)
            w.writeframes(pcm)
        try:
            os.unlink(tmp)
        except OSError:
            pass

    def _cache_key(self, voice: Optional[str], rate: float, text: str) -> str:
        """Stable key over everything that changes the rendered bytes — text,
        engine source, voice, rate, and the wire format the cache is stored in."""
        raw = "|".join([
            type(self).source, voice or "", f"{float(rate):.3f}",
            str(self.config.sample_rate), str(self.config.channels), text,
        ])
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]

    def _refresh_cache_stats(self) -> None:
        count = 0
        nbytes = 0
        try:
            for f in self.cache_dir.glob("*.wav"):
                try:
                    nbytes += f.stat().st_size; count += 1
                except OSError:
                    pass
        except OSError:
            pass
        self._cache_count, self._cache_bytes = count, nbytes

    @property
    def cache_dir(self) -> Path:
        base = os.environ.get("ROBOTLAB_X_DATA_DIR_ABS") or os.path.join(os.getcwd(), "data")
        return Path(base) / self._type_name

    @property
    def muted(self) -> bool:
        return bool(self.config.muted)

    def _scale_volume(self, pcm: bytes) -> bytes:
        v = self.config.volume
        if v >= 0.999:
            return pcm
        import array
        a = array.array("h")
        a.frombytes(pcm[: len(pcm) - (len(pcm) % 2)])
        for i in range(len(a)):
            a[i] = int(a[i] * v)
        return a.tobytes()

    # ─── discovery + state ────────────────────────────────────────────
    def meta_topics(self) -> Dict[str, str]:
        return {
            "audio": self.resolve_topic(self.topic("audio")),
            "spoken": self.resolve_topic(self.topic("spoken")),
        }

    def _snapshot(self) -> Dict[str, Any]:
        return {
            "kind": type(self).kind,
            "source": type(self).source,
            "voice": self.config.voice,
            "voices": self._voices,
            "sample_rate": self.config.sample_rate,
            "channels": self.config.channels,
            "frame_ms": self.config.frame_ms,
            "format": FORMAT,
            "volume": self.config.volume,
            "rate": self.config.rate,
            "muted": self.muted,
            "speaking": self._speaking,
            "synthesizing": self._synthesizing,
            "current_text": self._current_text,
            "queue": list(self._pending),
            "cache_count": self._cache_count,
            "cache_bytes": self._cache_bytes,
            "level_rms": round(self._level, 4),
            "last_error": self._last_error,
        }

    async def _publish_state(self) -> None:
        await self.publish("state", self._snapshot(), retained=True)


# ─── speech-to-text (transcription) ─────────────────────────────────────


class SttConfig(ServiceConfig):
    """Persisted config shared by every ``transcription`` (STT) service type.

    An STT service is a frame CONSUMER (like the speaker): it subscribes to a
    microphone's audio topic and transcribes the canonical pcm_s16le frames.
    ``sample_rate``/``channels`` MUST match the chosen source (no resampling) —
    16 kHz mono is the default both the mic and the recognizers use."""

    input_kind: Optional[str] = Field(
        None, description="Audio source kind: None (idle) | 'topic' (a microphone's /audio topic).")
    input_ref: Optional[str] = Field(
        None, description="Source topic to transcribe, e.g. /microphone/mic_local-1/audio.")
    model: Optional[str] = Field(
        None, description="Recognizer model id (engine-specific). None = the engine default.")
    sample_rate: int = Field(16000, ge=8000, le=48000, description="Expected source sample rate in Hz (must match the mic).")
    channels: int = Field(1, ge=1, le=2, description="1 = mono (default). STT downmixes to mono internally.")
    muted: bool = Field(False, description="When True, incoming audio is dropped before the recognizer (used for half-duplex).")
    continuous: bool = Field(False, description="When True, start transcribing on service start (publish partials/finals without a listen() pending).")
    endpoint_silence_ms: int = Field(
        800, ge=100, le=5000, description="Trailing silence (ms) that finalizes an utterance / endpoint.")


class SttServiceBase(SubprocessService):
    """Common control interface for a speech-to-text service.

    The capability contract (the action set every ``transcription`` implementor
    accepts on ``/stt/{id}/control``)::

        listen(timeout_seconds?, bearing?)  -> {text, bearing, timeout}
        start() / stop()                    enter/leave continuous transcription
        select_input(kind, ref)             choose which microphone topic to transcribe
        set_model(model) / list_models()
        mute() / unmute() / set_muted(muted)
        set_params(sample_rate?, channels?, endpoint_silence_ms?)

    ``listen`` is the SAME verb + return shape the brain's conversation
    workflows use (repo/chat/ is the text stand-in) — so a running STT service
    is a drop-in audio ``listen`` provider, the input counterpart to the
    ``speech`` (TTS) ``speak``.

    The base owns all the cross-engine plumbing: source subscription (the
    speaker's input model), a long-running recognizer loop fed off a frame
    queue, an utterance queue that bridges the continuous recognizer to the
    request/response ``listen()`` (exactly like chat's inbox queue), partial +
    final transcript publishing, mute, model download/cache, and the
    discovery/state surface. Engines implement four hooks:

        _ensure_model(model_id) -> Path       download+cache the model, return its dir
        _create_recognizer(model_dir, rate)   build the engine handle
        _feed(handle, pcm) -> {text, final}?  feed one frame; return a partial/final
        _list_models() -> [{id, label, downloaded?}]
    """

    type_name: ClassVar[str] = "stt"
    kind: ClassVar[str] = "stt"
    config_class: ClassVar = SttConfig
    publishes: ClassVar[List[str]] = ["state", "text"]
    source: ClassVar[str] = "local"
    DEFAULT_MODEL: ClassVar[Optional[str]] = None
    _FRAME_QUEUE_MAX = 100       # ~2 s @ 20 ms frames; drop oldest on overflow
    _UTTER_QUEUE_MAX = 32        # finalized utterances buffered for listen()

    def __init__(self, proxy_id, bus) -> None:
        super().__init__(proxy_id, bus)
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._exec: Optional[ThreadPoolExecutor] = None
        self._subscribed_topics: set = set()
        self._frame_q: "asyncio.Queue[bytes]" = asyncio.Queue(maxsize=self._FRAME_QUEUE_MAX)
        self._queue: "asyncio.Queue[Dict[str, Any]]" = asyncio.Queue(maxsize=self._UTTER_QUEUE_MAX)
        self._reco_task: Optional[asyncio.Task] = None
        self._recognizer: Optional[Any] = None
        self._build_lock = asyncio.Lock()
        self._gen: int = 0
        self._active: bool = False        # consuming frames + transcribing
        self._downloading: bool = False
        self._models: List[Dict[str, Any]] = []
        self._level: float = 0.0
        self._seq: int = 0
        self._last_partial: str = ""
        self._last_final: str = ""
        self._last_error: Optional[str] = None

    # ─── lifecycle ────────────────────────────────────────────────────
    async def on_start(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._exec = ThreadPoolExecutor(max_workers=1, thread_name_prefix=f"stt-{self.proxy_id}")
        self.models_dir.mkdir(parents=True, exist_ok=True)
        try:
            self._models = await asyncio.to_thread(self._list_models)
        except Exception as exc:  # noqa: BLE001
            logger.exception("%s: model enumeration failed", self.proxy_id)
            self._last_error = str(exc)
        await self._ensure_topic_sub()
        self._reco_task = asyncio.create_task(self._recognizer_loop())
        await self._publish_state()
        if self.config.continuous:
            await self._activate()

    async def on_stop(self) -> None:
        self._gen += 1
        self._active = False
        # Cancel + AWAIT the loop so it isn't mid-await when we tear down.
        task, self._reco_task = self._reco_task, None
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception:  # noqa: BLE001
                logger.debug("%s: recognizer task ended with error during stop",
                             self.proxy_id, exc_info=True)
        # Join the worker (wait=True) so no native _feed/_create call is still
        # touching the recognizer when we free it — avoids a use-after-free on
        # the native handle during subprocess shutdown.
        exec_, self._exec = self._exec, None
        if exec_ is not None:
            try:
                await asyncio.get_running_loop().run_in_executor(
                    None, lambda: exec_.shutdown(wait=True, cancel_futures=True))
            except Exception:  # noqa: BLE001
                logger.exception("%s: executor shutdown failed", self.proxy_id)
        rec, self._recognizer = self._recognizer, None
        if rec is not None:
            try:
                self._free_recognizer(rec)
            except Exception:  # noqa: BLE001
                logger.exception("%s: recognizer free failed", self.proxy_id)

    # ─── engine hooks (subclasses implement) ──────────────────────────
    def _ensure_model(self, model_id: str) -> "os.PathLike":
        """Ensure the model is on disk (download+cache if absent); return its
        directory. Runs in a worker thread."""
        raise NotImplementedError

    def _create_recognizer(self, model_dir: "os.PathLike", sample_rate: int) -> Any:
        """Build + return the engine handle for ``model_dir``. Runs in the
        dedicated recognizer thread."""
        raise NotImplementedError

    def _feed(self, handle: Any, pcm: bytes) -> Optional[Dict[str, Any]]:
        """Feed one s16le PCM frame to the recognizer and return the latest
        result as ``{"text": str, "final": bool}`` (or None for no change).
        Runs in the dedicated recognizer thread (calls are serialized)."""
        raise NotImplementedError

    def _list_models(self) -> List[Dict[str, Any]]:
        """Return available models as ``[{id, label, downloaded?}]``. Runs in
        a worker thread."""
        return []

    def _reset_recognizer(self, handle: Any) -> None:
        """Reset per-utterance decode state so the next utterance starts clean
        (called on stop / source switch). Default no-op — streaming engines
        that carry decode state across frames override this. Runs in the
        recognizer thread."""

    def _free_recognizer(self, handle: Any) -> None:
        """Release native recognizer resources on shutdown. Default no-op."""

    # ─── the transcription capability ─────────────────────────────────
    @service_method("listen", publishes=["state"])
    async def m_listen(self, timeout_seconds: int = 8, bearing: Optional[float] = None) -> Dict[str, Any]:
        """Return the next finalized utterance (waiting up to
        ``timeout_seconds``). Drop-in for the brain's conversation ``listen``:
        returns ``{text, bearing, timeout}`` — ``{text:'', timeout:True}`` on
        silence so the workflow can re-listen.

        One-shot: if this call brings transcription up itself (rather than an
        explicit ``start()`` / ``continuous`` session) it returns to idle on
        exit — so the mic isn't transcribed between turns (natural half-duplex)
        and stale utterances don't pile up.

        If the recognizer can't run (model failed to build, or no microphone
        selected) it returns ``timeout:False`` + an ``error`` so the failure is
        distinguishable from silence and the brain's ``loop_on_timeout`` stops
        re-dispatching. ``bearing`` is reserved (mic-array DOA); None for now."""
        del bearing  # accepted for brain/contract parity; no DOA yet
        try:
            timeout = max(0.5, float(timeout_seconds))
        except (TypeError, ValueError):
            timeout = 8.0
        owns = not self._active and not self.config.continuous
        await self._activate()
        if self._recognizer is None:    # build failed or no input selected
            if owns:
                self._deactivate()
            await self._publish_state()
            return {"text": "", "bearing": None, "timeout": False,
                    "error": self._last_error or "speech-to-text unavailable"}
        item: Optional[Dict[str, Any]] = None
        try:
            item = await asyncio.wait_for(self._queue.get(), timeout=timeout)
        except asyncio.TimeoutError:
            item = None
        finally:
            if owns:
                self._deactivate()
                await self._reset_engine()
        await self._publish_state()
        if item is None:
            return {"text": "", "bearing": None, "timeout": True}
        return {"text": item["text"], "bearing": item.get("bearing"), "timeout": False}

    @service_method("start", publishes=["state"])
    async def m_start(self) -> Dict[str, Any]:
        """Begin CONTINUOUS transcription — partials/finals publish on
        ``/stt/{id}/text`` and stay active (unlike one-shot ``listen``) until
        ``stop``. Use for live captions or always-on listening."""
        await self._activate()
        await self._publish_state()
        return self._snapshot()

    @service_method("stop", publishes=["state"])
    async def m_stop(self) -> Dict[str, Any]:
        """Stop transcribing and drop any buffered audio + utterances."""
        self._deactivate()
        await self._reset_engine()
        await self._publish_state()
        return self._snapshot()

    @service_method("select_input", publishes=["state"])
    async def m_select_input(self, kind: Optional[str] = None, ref: Optional[str] = None) -> Dict[str, Any]:
        """Choose which microphone topic to transcribe. ``kind`` ∈ {None,
        'topic'}; ``ref`` is the audio topic (e.g. /microphone/mic-1/audio)."""
        norm = (kind or "").strip().lower() or None
        if norm not in (None, "topic"):
            from fastapi import HTTPException  # local import; subprocess may lack fastapi at module load
            raise HTTPException(400, f"unsupported input kind {kind!r} (only 'topic')")
        await self.update_config({"input_kind": norm, "input_ref": (ref or "").strip() or None})
        # New source → invalidate in-flight feeds + drop audio AND finalized
        # utterances from the previous source so the next listen() can't return
        # a stale transcript from the old mic.
        self._gen += 1
        self._last_partial = ""
        self._drain(self._frame_q)
        self._drain(self._queue)
        if norm == "topic":
            await self._ensure_topic_sub()
        await self._publish_state()
        return self._snapshot()

    @service_method("set_model", publishes=["state"])
    async def m_set_model(self, model: Optional[str] = None) -> Dict[str, Any]:
        """Switch the recognizer model (downloads if absent, rebuilds if
        currently active)."""
        await self.update_config({"model": (model or "").strip() or None})
        self._gen += 1               # invalidate old-model feeds in flight
        self._recognizer = None      # force rebuild on next activate
        self._last_partial = ""
        self._drain(self._frame_q)
        if self._active:
            await self._ensure_recognizer()
        await self._publish_state()
        return self._snapshot()

    @service_method("list_models", publishes=["state"])
    async def m_list_models(self) -> Dict[str, Any]:
        """Re-enumerate available models, republish state, return the list."""
        try:
            self._models = await asyncio.to_thread(self._list_models)
        except Exception as exc:  # noqa: BLE001
            self._last_error = str(exc)
        await self._publish_state()
        return {"models": self._models}

    @service_method("set_muted", publishes=["state"])
    async def m_set_muted(self, muted: bool = True) -> Dict[str, Any]:
        """Mute/unmute. Muted = audio dropped before the recognizer (so the
        robot can avoid transcribing its own TTS)."""
        await self.update_config({"muted": bool(muted)})
        if muted:
            self._gen += 1
            self._drain(self._frame_q)
            self._drain(self._queue)   # don't serve a pre-mute utterance after mute
            self._last_partial = ""
            self._level = 0.0
        await self._publish_state()
        return self._snapshot()

    @service_method("mute", publishes=["state"])
    async def m_mute(self) -> Dict[str, Any]:
        return await self.m_set_muted(True)

    @service_method("unmute", publishes=["state"])
    async def m_unmute(self) -> Dict[str, Any]:
        return await self.m_set_muted(False)

    @service_method("set_params", publishes=["state"])
    async def m_set_params(
        self,
        sample_rate: Optional[int] = None,
        channels: Optional[int] = None,
        endpoint_silence_ms: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Tune the source format + endpointing. Rebuilds the recognizer if
        currently active."""
        updates: Dict[str, Any] = {}
        if sample_rate is not None:
            updates["sample_rate"] = int(sample_rate)
        if channels is not None:
            updates["channels"] = int(channels)
        if endpoint_silence_ms is not None:
            updates["endpoint_silence_ms"] = int(endpoint_silence_ms)
        if updates:
            await self.update_config(updates)
            self._gen += 1               # invalidate feeds built for the old params
            self._recognizer = None
            self._last_partial = ""
            self._drain(self._frame_q)
            if self._active:
                await self._ensure_recognizer()
        await self._publish_state()
        return self._snapshot()

    # ─── source subscription (mirrors SpeakerServiceBase) ──────────────
    async def _ensure_topic_sub(self) -> None:
        """Subscribe to the configured source topic (once per distinct topic).
        Handlers gate on the CURRENT input, so a stale subscription from a
        previous selection simply no-ops (the bus has no unsubscribe)."""
        if (self.config.input_kind or None) != "topic":
            return
        topic = (self.config.input_ref or "").strip()
        if not topic or topic in self._subscribed_topics:
            return
        self._subscribed_topics.add(topic)
        await self.bus.subscribe(self.resolve_topic(topic), lambda f, t=topic: self._on_topic_frame(f, t))

    async def _on_topic_frame(self, frame: Any, topic: str) -> None:
        if (self.config.input_kind or None) != "topic" or (self.config.input_ref or "").strip() != topic:
            return
        if not self._active or self.muted or not isinstance(frame, dict):
            return
        pcm = decode_frame(frame)
        if not pcm:
            return
        self._level = level_rms(pcm)
        try:
            self._frame_q.put_nowait(pcm)
        except asyncio.QueueFull:
            self._drain_one(self._frame_q)
            try:
                self._frame_q.put_nowait(pcm)
            except asyncio.QueueFull:
                pass

    # ─── recognizer loop ──────────────────────────────────────────────
    async def _activate(self) -> None:
        self._active = True
        # No source configured → surface a clear error (mirrors the no-model
        # path) and skip the recognizer build so listen() fast-fails instead of
        # blocking the full window on audio that can never arrive.
        if (self.config.input_kind or None) != "topic" or not (self.config.input_ref or "").strip():
            self._last_error = "no microphone selected (use select_input)"
            return
        if self._last_error == "no microphone selected (use select_input)":
            self._last_error = None
        await self._ensure_topic_sub()
        await self._ensure_recognizer()

    def _deactivate(self) -> None:
        """Return to idle: stop feeding, invalidate in-flight work, drop
        buffered audio + utterances. The built recognizer handle is KEPT for
        cheap reuse on the next listen()/start()."""
        self._gen += 1
        self._active = False
        self._last_partial = ""
        self._level = 0.0
        self._drain(self._frame_q)
        self._drain(self._queue)

    async def _reset_engine(self) -> None:
        """Reset the engine's per-utterance decode state (recognizer thread)."""
        rec, exec_ = self._recognizer, self._exec
        if rec is None:
            return
        try:
            await asyncio.get_running_loop().run_in_executor(exec_, self._reset_recognizer, rec)
        except Exception:  # noqa: BLE001
            logger.exception("%s: recognizer reset failed", self.proxy_id)

    async def _ensure_recognizer(self) -> None:
        if self._recognizer is not None:
            return
        async with self._build_lock:
            if self._recognizer is not None:
                return
            model_id = self._resolve_model()
            if not model_id:
                self._last_error = "no model configured"
                await self._publish_state()
                return
            self._downloading = True
            self._last_error = None
            await self._publish_state()
            try:
                model_dir = await asyncio.to_thread(self._ensure_model, model_id)
                self._recognizer = await asyncio.get_running_loop().run_in_executor(
                    self._exec, self._create_recognizer, model_dir, self.config.sample_rate)
            except Exception as exc:  # noqa: BLE001
                logger.exception("%s: recognizer build failed", self.proxy_id)
                self._last_error = str(exc)
            finally:
                self._downloading = False
                await self._publish_state()

    async def _recognizer_loop(self) -> None:
        while True:
            pcm = await self._frame_q.get()
            if not self._active or self.muted or self._recognizer is None:
                continue
            gen = self._gen
            handle = self._recognizer
            try:
                res = await asyncio.get_running_loop().run_in_executor(
                    self._exec, self._feed, handle, pcm)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                logger.exception("%s: recognizer feed failed", self.proxy_id)
                continue
            # A stop / mute / source-switch / model-change landed during the
            # feed → the result is stale; drop it rather than publish/enqueue.
            if gen != self._gen or not self._active:
                continue
            await self._handle_result(res)

    async def _handle_result(self, res: Optional[Dict[str, Any]]) -> None:
        """Route one recognizer result: publish a changed partial, or finalize
        (publish + enqueue for listen()). Extracted from the loop so it's
        unit-testable without running the executor."""
        if not res:
            return
        text = (res.get("text") or "").strip()
        if res.get("final"):
            self._last_partial = ""
            # Publish the terminal frame even when empty so live-caption
            # consumers clear the dangling partial (an empty final = endpoint /
            # utterance discarded). Only non-empty utterances feed listen().
            await self._publish_text(text, True)
            if text:
                self._last_final = text
                self._enqueue_utterance(text)
        elif text and text != self._last_partial:
            self._last_partial = text
            await self._publish_text(text, False)

    def _enqueue_utterance(self, text: str) -> None:
        item = {"text": text, "ts": time.time(), "bearing": None}
        try:
            self._queue.put_nowait(item)
        except asyncio.QueueFull:
            self._drain_one(self._queue)
            try:
                self._queue.put_nowait(item)
            except asyncio.QueueFull:
                pass

    async def _publish_text(self, text: str, final: bool) -> None:
        self._seq += 1
        await self.publish("text", {"text": text, "final": final, "seq": self._seq, "ts": time.time()})

    # ─── helpers ───────────────────────────────────────────────────────
    def _resolve_model(self) -> Optional[str]:
        return (self.config.model or "").strip() or type(self).DEFAULT_MODEL

    @staticmethod
    def _drain(q: "asyncio.Queue") -> None:
        while not q.empty():
            try:
                q.get_nowait()
            except asyncio.QueueEmpty:
                break

    @staticmethod
    def _drain_one(q: "asyncio.Queue") -> None:
        try:
            q.get_nowait()
        except asyncio.QueueEmpty:
            pass

    @property
    def models_dir(self) -> Path:
        base = os.environ.get("ROBOTLAB_X_DATA_DIR_ABS") or os.path.join(os.getcwd(), "data")
        return Path(base) / self._type_name / "models"

    @property
    def muted(self) -> bool:
        return bool(self.config.muted)

    # ─── discovery + state ────────────────────────────────────────────
    def meta_topics(self) -> Dict[str, str]:
        return {"text": self.resolve_topic(self.topic("text"))}

    def _snapshot(self) -> Dict[str, Any]:
        return {
            "kind": type(self).kind,
            "source": type(self).source,
            "model": self._resolve_model(),
            "models": self._models,
            "input_kind": self.config.input_kind,
            "input_ref": self.config.input_ref,
            "sample_rate": self.config.sample_rate,
            "channels": self.config.channels,
            "muted": self.muted,
            "listening": self._active,
            "continuous": self.config.continuous,
            "downloading": self._downloading,
            "ready": self._recognizer is not None,
            "queued": self._queue.qsize(),
            "level_rms": round(self._level, 4),
            "last_partial": self._last_partial,
            "last_final": self._last_final,
            "last_error": self._last_error,
        }

    async def _publish_state(self) -> None:
        await self.publish("state", self._snapshot(), retained=True)
