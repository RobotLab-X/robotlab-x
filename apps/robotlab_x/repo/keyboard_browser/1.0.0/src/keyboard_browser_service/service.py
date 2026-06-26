"""KeyboardBrowserService — browser keyboard, backend relay half.

Same ``keyboard`` capability + publish shape as the (Phase 2) host keyboard
(inherited from KeyboardServiceBase), but the capture happens in the
operator's BROWSER:

  * CONTROL flows DOWN: start/stop/set_scope/set_suppress are relayed to the
    browser as commands on ``/keyboard/{id}/cmd``.
  * KEYS flow UP: the browser publishes canonical key events straight to
    ``/keyboard/{id}/event`` (the consumer-facing topic). This service
    subscribes to that topic to run the keymap (key→bus-action) dispatch and
    track the pressed set — the published event shape is identical to what a
    host keyboard would emit.
  * STATUS flows UP: the browser reports capturing + a heartbeat on
    ``/keyboard/{id}/report``, folded into ``/keyboard/{id}/state``.

A browser keyboard only exists while an authorized tab is open + focused; a
stale heartbeat marks ``last_error:"no browser client"`` and clears
``capturing`` (which also fires the keymap all-stop via the base).
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Optional

from rlx_input import KeyboardServiceBase

logger = logging.getLogger(__name__)

_STALE_AFTER_S = 5.0
_CHECK_EVERY_S = 2.0


class KeyboardBrowserService(KeyboardServiceBase):
    source = "browser"

    def __init__(self, proxy_id, bus) -> None:
        super().__init__(proxy_id, bus)
        self._last_report_ts: float = 0.0
        self._stale_task: Optional[asyncio.Task] = None

    async def on_start(self) -> None:
        self._loop = asyncio.get_running_loop()
        await self.subscribe("report", self._on_report)
        # Tap the browser's key events to run the keymap + track pressed keys.
        await self.subscribe("event", self._on_event)
        self._stale_task = asyncio.create_task(self._stale_loop())
        await super().on_start()

    async def on_stop(self) -> None:
        if self._stale_task is not None:
            self._stale_task.cancel()
        await super().on_stop()

    # ─── control hooks — relay to the browser ─────────────────────────
    async def _start_capture_backend(self) -> None:
        await self.publish("cmd", {
            "action": "start",
            "scope": self.config.scope,
            "suppress": self.config.suppress,
        })

    async def _stop_capture_backend(self) -> None:
        await self.publish("cmd", {"action": "stop"})

    async def _on_scope_changed(self, scope: str) -> None:
        await self.publish("cmd", {"action": "set_scope", "scope": scope})

    async def _on_suppress_changed(self, suppress: bool) -> None:
        await self.publish("cmd", {"action": "set_suppress", "suppress": suppress})

    # ─── browser → backend keys + status ──────────────────────────────
    async def _on_event(self, payload: Any) -> None:
        if isinstance(payload, dict):
            await self.handle_event(payload)

    async def _on_report(self, payload: Any) -> None:
        """Fold a browser report into canonical state. Shape:
        ``{capturing?, error?, ts}``."""
        if not isinstance(payload, dict):
            return
        self._last_report_ts = time.time()
        if "capturing" in payload:
            self._capturing = bool(payload["capturing"])
        self._last_error = payload.get("error") or None
        await self._publish_state()

    async def _stale_loop(self) -> None:
        while not self.is_stopping():
            await asyncio.sleep(_CHECK_EVERY_S)
            await self._check_stale()

    async def _check_stale(self) -> bool:
        if not self._last_report_ts:
            return False
        if (time.time() - self._last_report_ts) > _STALE_AFTER_S and self._capturing:
            self._capturing = False
            self._last_error = "no browser client"
            # Fire the keymap all-stop so nothing is left driving when the
            # browser tab vanishes mid-teleop.
            await self._release_all()
            await self._publish_state()
            return True
        return False
