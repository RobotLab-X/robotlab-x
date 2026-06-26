"""RaspiService — Raspberry Pi GPIO + I2C interface.

Subprocess service. On start: detect board + open the right backend.
Exposes per-pin set_pin_mode/digital_read/digital_write/pwm_write plus
continuous polling and I2C scan/read/write.

Bus topics
----------

  /raspi/{id}/state        retained — full snapshot (board info + pin states + mode)
  /raspi/{id}/control      incoming @service_method actions
  /raspi/{id}/heartbeat    1Hz (base-class)
  /raspi/{id}/pin/{N}      per-pin value updates (poll_pin + read/write echoes)
  /raspi/{id}/i2c/scan     i2c_scan result (last)
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

from rlx_bus import ServiceConfig, SubprocessService, service_method

from .board import detect_board
from .gpio_backend import open_backend


logger = logging.getLogger(__name__)


class RaspiConfig(ServiceConfig):
    """Persisted config — pin configurations + polling intervals so a
    restart restores the user's wiring.

    Keys are stringified BCM pin numbers (JSON has no int keys; the
    service code converts via ``str(int(pin))`` on every write).
    """
    pin_modes: Dict[str, str] = {}     # 'pin' (BCM, str) → mode ('input' | 'output' | ...)
    pin_polls: Dict[str, int] = {}     # 'pin' (BCM, str) → interval_ms


class RaspiService(SubprocessService):
    """Bus-facing wrapper around gpiozero + smbus2."""

    type_name = "raspi"
    heartbeat_interval_s = 1.0
    config_class = RaspiConfig
    publishes = ["state", "i2c/scan"]

    def __init__(self, proxy_id: str, bus) -> None:
        super().__init__(proxy_id, bus)
        self.board: Dict[str, Any] = {}
        self.backend = None
        self._poll_tasks: Dict[int, asyncio.Task] = {}

    # ─── lifecycle ───────────────────────────────────────────────────
    async def on_start(self) -> None:
        self.board = detect_board()
        self.backend = open_backend(self.board.get("kind", "mock"))
        # Replay saved pin modes so a reboot lands the rig in the
        # same configuration the user set up before.
        for pin_str, mode in (self.config.pin_modes or {}).items():
            try:
                self.backend.set_pin_mode(int(pin_str), mode)
            except Exception:  # noqa: BLE001
                logger.exception("raspi %s: replay set_pin_mode(%s, %s) failed",
                                 self.proxy_id, pin_str, mode)
        # Replay polling tasks.
        for pin_str, interval in (self.config.pin_polls or {}).items():
            try:
                interval_ms = int(interval)
                if interval_ms > 0:
                    self._start_poll(int(pin_str), interval_ms)
            except Exception:  # noqa: BLE001
                logger.exception("raspi %s: replay poll(%s) failed",
                                 self.proxy_id, pin_str)
        await self.publish_state()

    async def on_stop(self) -> None:
        # Cancel polls first so they don't race the backend close.
        for task in self._poll_tasks.values():
            if not task.done():
                task.cancel()
        await asyncio.gather(*self._poll_tasks.values(), return_exceptions=True)
        self._poll_tasks.clear()
        if self.backend is not None:
            try:
                self.backend.close()
            except Exception:  # noqa: BLE001
                logger.exception("raspi %s: backend close raised", self.proxy_id)

    # ─── state ───────────────────────────────────────────────────────
    def _snapshot(self) -> Dict[str, Any]:
        pins: Dict[str, Any] = {}
        for p, st in (self.backend.pins if self.backend else {}).items():
            pins[str(p)] = dict(st)
        return {
            "board": self.board,
            "backend_mode": self.backend.mode if self.backend else "uninitialised",
            "pins": pins,
            "polling": dict(self.config.pin_polls or {}),
        }

    async def publish_state(self) -> None:
        await self.publish("state", self._snapshot(), retained=True)

    def pin_topic(self, pin: int) -> str:
        return self.topic(f"pin/{pin}")

    # ─── @service_method actions ─────────────────────────────────────
    @service_method("board_info")
    async def m_board_info(self) -> Dict[str, Any]:
        """Re-read board info + republish state. Cheap — just /proc reads."""
        self.board = detect_board()
        await self.publish_state()
        return self.board

    @service_method("set_pin_mode", publishes=["state"])
    async def m_set_pin_mode(self, pin: int, mode: str) -> Dict[str, Any]:
        if self.backend is None:
            raise RuntimeError("backend not initialised")
        self.backend.set_pin_mode(int(pin), str(mode))
        # Persist so a restart restores this configuration
        modes = dict(self.config.pin_modes or {})
        modes[str(int(pin))] = str(mode)
        self.config = self.config.merge_dict({"pin_modes": modes})
        await self.update_config({"pin_modes": modes})
        await self.publish_state()
        return {"pin": int(pin), "mode": str(mode)}

    @service_method("release_pin", publishes=["state"])
    async def m_release_pin(self, pin: int) -> Dict[str, Any]:
        if self.backend is None:
            raise RuntimeError("backend not initialised")
        # Also stop any poll on this pin
        await self._stop_poll(int(pin), publish=False)
        self.backend.release(int(pin))
        modes = dict(self.config.pin_modes or {})
        modes.pop(str(int(pin)), None)
        polls = dict(self.config.pin_polls or {})
        polls.pop(str(int(pin)), None)
        self.config = self.config.merge_dict({"pin_modes": modes, "pin_polls": polls})
        await self.update_config({"pin_modes": modes, "pin_polls": polls})
        await self.publish_state()
        return {"pin": int(pin), "released": True}

    @service_method("digital_write")
    async def m_digital_write(self, pin: int, value: int) -> Dict[str, Any]:
        if self.backend is None:
            raise RuntimeError("backend not initialised")
        self.backend.digital_write(int(pin), int(value))
        v = 1 if int(value) else 0
        await self.bus.publish(self.pin_topic(int(pin)), {"value": v})
        return {"pin": int(pin), "value": v}

    @service_method("digital_read")
    async def m_digital_read(self, pin: int) -> Dict[str, Any]:
        if self.backend is None:
            raise RuntimeError("backend not initialised")
        v = self.backend.digital_read(int(pin))
        await self.bus.publish(self.pin_topic(int(pin)), {"value": v})
        return {"pin": int(pin), "value": v}

    @service_method("pwm_write")
    async def m_pwm_write(self, pin: int, duty: float) -> Dict[str, Any]:
        if self.backend is None:
            raise RuntimeError("backend not initialised")
        d = max(0.0, min(1.0, float(duty)))
        self.backend.pwm_write(int(pin), d)
        await self.bus.publish(self.pin_topic(int(pin)), {"value": d})
        return {"pin": int(pin), "duty": d}

    # ─── continuous polling ──────────────────────────────────────────
    @service_method("poll_pin", publishes=["state"])
    async def m_poll_pin(self, pin: int, interval_ms: int = 100) -> Dict[str, Any]:
        """Start (or restart) a poll loop on ``pin``. Each tick reads
        the pin and publishes ``{value: N}`` to /raspi/{id}/pin/{pin}.
        Setting interval_ms to 0 stops polling — same as ``stop_poll``.
        """
        pin = int(pin)
        interval_ms = int(interval_ms)
        if interval_ms <= 0:
            return await self.m_stop_poll(pin=pin)
        # Replace any existing poll task on this pin
        await self._stop_poll(pin, publish=False)
        self._start_poll(pin, interval_ms)
        polls = dict(self.config.pin_polls or {})
        polls[str(pin)] = interval_ms
        self.config = self.config.merge_dict({"pin_polls": polls})
        await self.update_config({"pin_polls": polls})
        await self.publish_state()
        return {"pin": pin, "interval_ms": interval_ms, "polling": True}

    @service_method("stop_poll", publishes=["state"])
    async def m_stop_poll(self, pin: int) -> Dict[str, Any]:
        pin = int(pin)
        await self._stop_poll(pin, publish=False)
        polls = dict(self.config.pin_polls or {})
        polls.pop(str(pin), None)
        self.config = self.config.merge_dict({"pin_polls": polls})
        await self.update_config({"pin_polls": polls})
        await self.publish_state()
        return {"pin": pin, "polling": False}

    def _start_poll(self, pin: int, interval_ms: int) -> None:
        """Launch (without awaiting) the asyncio task for this pin."""
        loop = asyncio.get_event_loop()
        self._poll_tasks[pin] = loop.create_task(self._poll_loop(pin, interval_ms))

    async def _stop_poll(self, pin: int, publish: bool = True) -> None:
        task = self._poll_tasks.pop(pin, None)
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        if publish:
            await self.publish_state()

    async def _poll_loop(self, pin: int, interval_ms: int) -> None:
        """Read pin, publish, sleep, repeat. Self-terminates on cancel."""
        period = max(0.005, interval_ms / 1000.0)
        try:
            while True:
                try:
                    v = self.backend.digital_read(pin)
                    await self.bus.publish(self.pin_topic(pin), {"value": v})
                except Exception:  # noqa: BLE001
                    logger.exception("raspi %s: poll(%d) read failed", self.proxy_id, pin)
                    return
                await asyncio.sleep(period)
        except asyncio.CancelledError:
            return

    # ─── I2C ─────────────────────────────────────────────────────────
    @service_method("i2c_scan", publishes=["i2c/scan"])
    async def m_i2c_scan(self, bus: int = 1) -> Dict[str, Any]:
        if self.backend is None:
            raise RuntimeError("backend not initialised")
        addrs = self.backend.i2c_scan(int(bus))
        payload = {"bus": int(bus), "addresses": [f"0x{a:02x}" for a in addrs]}
        await self.publish("i2c/scan", payload, retained=True)
        return payload

    @service_method("i2c_read")
    async def m_i2c_read(self, addr: int, reg: int, count: int, bus: int = 1) -> Dict[str, Any]:
        if self.backend is None:
            raise RuntimeError("backend not initialised")
        data = self.backend.i2c_read(int(addr), int(reg), int(count), int(bus))
        return {"bus": int(bus), "addr": int(addr), "reg": int(reg), "data": list(data)}

    @service_method("i2c_write")
    async def m_i2c_write(self, addr: int, data: List[int], bus: int = 1) -> Dict[str, Any]:
        if self.backend is None:
            raise RuntimeError("backend not initialised")
        self.backend.i2c_write(int(addr), [int(x) for x in (data or [])], int(bus))
        return {"bus": int(bus), "addr": int(addr), "len": len(data or [])}
