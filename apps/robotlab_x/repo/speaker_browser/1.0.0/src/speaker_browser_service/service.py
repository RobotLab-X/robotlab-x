"""SpeakerBrowserService — browser speaker, backend relay half.

Same ``speaker`` capability + state shape as speaker_local, but playback
happens in the operator's BROWSER:

  * CONTROL flows DOWN: connect/disconnect/mute/unmute/select are relayed to
    the browser as commands on ``/speaker/{id}/cmd``.
  * AUDIO: the BROWSER subscribes to ``/speaker/{id}/audio`` (+ the
    configured source_topic) over its own bus connection and plays it via
    Web Audio — the backend never touches the bytes.
  * STATUS flows UP: the browser reports output devices + connected/muted +
    level + a heartbeat on ``/speaker/{id}/report``, folded into state.

A browser speaker only exists while an authorized tab is open; a stale
heartbeat marks ``last_error:"no browser client"``.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Optional

from rlx_audio import AudioDeviceServiceBase, SpeakerServiceBase

logger = logging.getLogger(__name__)

_STALE_AFTER_S = 5.0
_CHECK_EVERY_S = 2.0


class SpeakerBrowserService(SpeakerServiceBase):
    source = "browser"

    def __init__(self, proxy_id, bus) -> None:
        super().__init__(proxy_id, bus)
        self._last_report_ts: float = 0.0
        self._stale_task: Optional[asyncio.Task] = None

    async def on_start(self) -> None:
        self._loop = asyncio.get_running_loop()
        await self.subscribe("report", self._on_report)
        self._stale_task = asyncio.create_task(self._stale_loop())
        # Skip SpeakerServiceBase's audio subscriptions — the BROWSER
        # subscribes to /speaker/{id}/audio + source_topic and plays; the
        # backend relays control only. Call the grandparent's on_start.
        await AudioDeviceServiceBase.on_start(self)

    async def on_stop(self) -> None:
        if self._stale_task is not None:
            self._stale_task.cancel()
        await AudioDeviceServiceBase.on_stop(self)

    # ─── transport hooks — relay to the browser ───────────────────────
    async def _enumerate_devices(self):
        await self.publish("cmd", {"action": "enumerate"})
        return list(self._devices)

    async def _open(self) -> None:
        await self.publish("cmd", {
            "action": "connect",
            "device_id": self.config.device_id,
            "sample_rate": self.config.sample_rate,
            "channels": self.config.channels,
            "input_kind": self.config.input_kind,
            "input_ref": self.config.input_ref,
        })

    async def _close(self) -> None:
        await self.publish("cmd", {"action": "disconnect"})

    async def _on_mute_changed(self, muted: bool) -> None:
        await self.publish("cmd", {"action": "set_muted", "muted": muted})

    async def _on_input_changed(self) -> None:
        # Relay the new source to the browser, which (re)loads + plays it.
        await self.publish("cmd", {
            "action": "set_input",
            "input_kind": self.config.input_kind,
            "input_ref": self.config.input_ref,
        })

    async def _on_volume_changed(self, volume: float) -> None:
        await self.publish("cmd", {"action": "set_volume", "volume": volume})

    async def _on_transport(self, action: str) -> None:
        # Relay transport + the resulting position so the browser's player
        # play/pause/stop/seek stays in sync.
        await self.publish("cmd", {
            "action": "transport", "op": action,
            "position_s": self._position_s, "playing": self._playing, "paused": self._paused,
        })

    async def _play_pcm(self, pcm: bytes, frame) -> None:
        # The browser plays; the backend never renders audio.
        return None

    # ─── browser → backend status ─────────────────────────────────────
    async def _on_report(self, payload: Any) -> None:
        if not isinstance(payload, dict):
            return
        self._last_report_ts = time.time()
        if isinstance(payload.get("devices"), list):
            self._devices = payload["devices"]
        if "connected" in payload:
            self._connected = bool(payload["connected"])
        if "level_rms" in payload:
            try:
                self._level = float(payload["level_rms"])
            except (TypeError, ValueError):
                pass
        # The browser is authoritative for transport position while it plays.
        for fld, attr in (("playing", "_playing"), ("paused", "_paused")):
            if fld in payload:
                setattr(self, attr, bool(payload[fld]))
        for fld, attr in (("position_s", "_position_s"), ("duration_s", "_duration_s")):
            if fld in payload:
                try:
                    setattr(self, attr, float(payload[fld]))
                except (TypeError, ValueError):
                    pass
        self._last_error = payload.get("error") or None
        # The browser signals natural end-of-track → advance the play set.
        if payload.get("ended"):
            await self._on_track_ended()
        await self._publish_state()

    async def _stale_loop(self) -> None:
        while not self.is_stopping():
            await asyncio.sleep(_CHECK_EVERY_S)
            await self._check_stale()

    async def _check_stale(self) -> bool:
        if not self._last_report_ts:
            return False
        if (time.time() - self._last_report_ts) > _STALE_AFTER_S and self._connected:
            self._connected = False
            self._level = 0.0
            self._last_error = "no browser client"
            await self._publish_state()
            return True
        return False
