# unmanaged
"""ClockService — periodic tick publisher.

A first-class Service implementation. See runtime/framework/ for the
uniform service shape every service implements.

Bus topics
----------
  /clock/{proxy_id}/tick     -> {"seq": int, "interval_ms": int, "now": float}
                                published every interval_ms ms while not paused.
  /clock/{proxy_id}/state    -> {"paused": bool, "interval_ms": int}  (retained)
                                Late UI subscribers see the current truth here.
  /clock/{proxy_id}/control  <- {"action": "start_clock"}
                              | {"action": "stop_clock"}
                              | {"action": "set_interval", "interval_ms": int}

The inner pause + interval are independent of service lifecycle —
``stop_clock`` pauses publishing, ``set_interval`` changes the rate, but
the service itself stays running. ``stop_service`` shuts the whole
service down via the framework.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Dict, Optional

from pydantic import Field
from rlx_bus import ServiceConfig
from robotlab_x.framework import Service, service_method


logger = logging.getLogger(__name__)


DEFAULT_INTERVAL_MS = 1000
MIN_INTERVAL_MS = 50  # floor — anything tighter spams the bus + browser


class ClockConfig(ServiceConfig):
    """Strongly-typed config for ClockService.

    ``interval_ms`` is the tick period; floored at MIN_INTERVAL_MS by the
    setter to avoid spamming the bus + browser at sub-50ms rates.
    """
    interval_ms: int = Field(DEFAULT_INTERVAL_MS, ge=MIN_INTERVAL_MS, description="Tick period in milliseconds")
    # Whether the tick loop should be running (un-paused). Persisted so a
    # restart restores the clock to exactly the state it was in: a running
    # clock service whose ticks were paused comes back paused, one that was
    # ticking comes back ticking. Defaults True — a freshly-created clock
    # ticks as soon as its service starts.
    is_clock_running: bool = Field(True, description="Resume the tick loop on start")


class ClockService(Service):
    config_class = ClockConfig
    # Always-on topics — surfaced in the Composer's Topics tab + the
    # Topology page so users see what clock instances broadcast.
    publishes = ["tick", "state"]
    interval_ms: int
    _paused: bool
    _ticker_task: Optional[asyncio.Task]
    _controller_task: Optional[asyncio.Task]

    async def on_start(self) -> None:
        # Typed access — no .get() / no defaults guessing
        self.interval_ms = max(MIN_INTERVAL_MS, int(self.config.interval_ms))
        # Restore the prior tick state: a clock saved while paused comes back
        # paused, one saved while ticking comes back ticking. Fresh clocks
        # default is_clock_running=True so they tick on first start.
        self._paused = not bool(getattr(self.config, "is_clock_running", True))
        self._publish_state()
        self._ticker_task = asyncio.create_task(self._tick_loop())
        self._controller_task = asyncio.create_task(self._control_loop())

    async def on_stop(self) -> None:
        for task in (self._ticker_task, self._controller_task):
            if task is not None and not task.done():
                task.cancel()
        await asyncio.gather(
            *(t for t in (self._ticker_task, self._controller_task) if t is not None),
            return_exceptions=True,
        )

    # ─── @service_method actions (discoverable + callable through the bus) ─
    @service_method("start_clock", publishes=["state"])
    def start_clock(self) -> Dict[str, Any]:
        """Resume the tick loop. No-op if already running."""
        if not self._paused:
            return {"paused": False, "changed": False}
        self._paused = False
        # Keep config truthful in-memory so get_config + the next snapshot
        # reflect reality. Not persisted here — save_all_service_config (on
        # shutdown or on demand) writes it to disk.
        self.config = self.config.merge_dict({"is_clock_running": True})
        self._publish_state()
        return {"paused": False, "changed": True}

    @service_method("stop_clock", publishes=["state"])
    def stop_clock(self) -> Dict[str, Any]:
        """Pause the tick loop. The service keeps running."""
        if self._paused:
            return {"paused": True, "changed": False}
        self._paused = True
        self.config = self.config.merge_dict({"is_clock_running": False})
        self._publish_state()
        return {"paused": True, "changed": True}

    def serialize_runtime_state(self) -> None:
        """Flush the live tick state into config so it survives restart.

        ``_paused`` is the source of truth while the service runs;
        ``is_clock_running`` is its persisted form. start_clock/stop_clock
        keep the two in lockstep, but we re-derive here so the snapshot is
        correct even if some other path toggled ``_paused`` directly.
        """
        running = not bool(getattr(self, "_paused", False))
        self.config = self.config.merge_dict({"is_clock_running": running})

    @service_method("set_interval", publishes=["state"])
    def set_interval(self, interval_ms: int) -> Dict[str, Any]:
        """Change the tick interval. Takes effect on the next tick and
        persists to service_config so a restart keeps the new value."""
        try:
            value = int(interval_ms)
        except (TypeError, ValueError):
            raise ValueError(f"interval_ms must be an int, got {interval_ms!r}")
        if value < MIN_INTERVAL_MS:
            value = MIN_INTERVAL_MS
        self.interval_ms = value
        # Re-validate the typed config + persist (framework.Service writes
        # back to the proxy row).
        self.config = self.config.merge_dict({"interval_ms": value})
        self.save_config()
        self._publish_state()
        return {"interval_ms": value}

    # ─── internals ─────────────────────────────────────────────────────
    def _publish_state(self) -> None:
        """One retained state message captures both knobs the UI cares
        about — pause + interval. Keeps the wire grammar small."""
        self.publish(
            "state",
            {"paused": self._paused, "interval_ms": self.interval_ms},
            retained=True,
        )

    async def _tick_loop(self) -> None:
        seq = 0
        stop_event = self._stop_event
        assert stop_event is not None
        while not stop_event.is_set():
            # Read each iteration so set_interval changes apply on the
            # next tick without restarting the loop.
            interval_s = max(MIN_INTERVAL_MS / 1000.0, self.interval_ms / 1000.0)
            if not self._paused:
                self.publish(
                    "tick",
                    {"seq": seq, "interval_ms": self.interval_ms, "now": time.time()},
                )
                seq += 1
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=interval_s)
                return
            except asyncio.TimeoutError:
                continue

    async def _control_loop(self) -> None:
        # Delegate to the framework's shared dispatcher (Layer 2). Adds
        # reply_to + publish_return auto-publish for free.
        await self.run_control_loop()
