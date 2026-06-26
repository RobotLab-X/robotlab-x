"""SabertoothService — Dimension Engineering Sabertooth 2x25 driver.

A ``motor_controller`` implementation that speaks the Sabertooth
"Packetized Serial" protocol over an OS serial port. Subclasses
``rlx_bus.SubprocessService`` so the framework owns the boilerplate
(env, bus client, hello, control dispatch, heartbeat, signals,
graceful shutdown); this module defines only the Sabertooth-specific
config, the motor_controller actions, and the serial/keepalive plumbing.

motor_controller interface (the promoted contract)
--------------------------------------------------
Every service that declares ``implements: [motor_controller]`` accepts
these actions on its ``/{type}/{id}/control`` topic. A ``motor_control``
(or any other consumer) publishes them without knowing the protocol on
the other end — Sabertooth is the reference implementation.

  {"action": "motor_set",      "motor": int, "value": float}  # -1.0..+1.0
  {"action": "motor_stop",     "motor": int}                  # one channel
  {"action": "motor_stop_all"}                                # all channels

``value`` is a signed throttle: ``+1.0`` full forward, ``-1.0`` full
reverse, ``0`` stop. ``motor`` is a 1-based channel index; the 2x25 has
channels 1 and 2.

The driver also publishes a retained ``/state`` snapshot describing the
connection, the per-channel commanded values, channel count, and whether
the controller reports position feedback (Sabertooth does not).

Safety
------
Three independent layers stop a runaway:

  * ``max_output`` — a driver-side magnitude clamp applied to every
    commanded value before it reaches the wire. The consumer's limits
    are the first line; this is the last.
  * Hardware serial timeout (Packetized Serial command 14) — the
    Sabertooth stops both motors if no valid packet arrives within the
    configured window.
  * Host keepalive — while connected with the timeout enabled, a
    background task re-sends the last commanded packets at < timeout/2
    so steady-state motion survives, and a host/bus stall lets the
    hardware timeout trip and stop the motors.

Subprocess service — pyserial does blocking I/O cleanly in its own
process, isolated from the backend event loop.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from pydantic import Field
from rlx_bus import (
    ServiceConfig,
    SubprocessService,
    list_serial_ports,
    service_method,
)

from . import protocol
from .port_writer import SerialLink


logger = logging.getLogger(__name__)


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─── config ──────────────────────────────────────────────────────────


class SabertoothConfig(ServiceConfig):
    """Strongly-typed config — every field survives a restart so the
    UI replays the operator's last selection. ``autoreconnect`` is the
    persisted *desired connection state*: it tracks whether the driver
    was connected, so a driver that was connected re-opens its port on
    the next start. Reconnecting is safe — motors come up at 0; only an
    explicit motor_set energises the driver."""

    last_port: Optional[str] = Field(
        None,
        description="Device path of the last successful Connect (e.g. ``/dev/ttyUSB0``). UI pre-selects this in the port dropdown next session.",
    )
    last_baud: int = Field(
        9600,
        description="Serial baud rate. Packetized Serial supports 2400/9600/19200/38400/115200; 9600 is the safe default.",
    )
    address: int = Field(
        128, ge=protocol.ADDRESS_MIN, le=protocol.ADDRESS_MAX,
        description="Packet address byte (128..135), set by the driver's DIP switches 1-3. Factory default is 128.",
    )
    max_output: float = Field(
        1.0, ge=0.0, le=1.0,
        description="Driver-side safety clamp on output magnitude (0..1). Every commanded value is clamped to ±max_output before it reaches the wire — the last line of defence regardless of what a consumer sends.",
    )
    serial_timeout_ms: int = Field(
        1000, ge=0,
        description="Hardware serial-timeout failsafe in milliseconds (0 disables). The Sabertooth stops both motors if no valid packet arrives within this window. Sent as command 14 in 100ms units.",
    )
    ramping: int = Field(
        0, ge=0, le=80,
        description="Acceleration ramping: 0 off; 1-10 fast; 11-20 medium; 21-80 slow (datasheet command 16).",
    )
    deadband: int = Field(
        0, ge=0, le=127,
        description="Command deadband half-width (0..127); commands within the band are treated as stop (datasheet command 17). 0 keeps the factory default.",
    )
    autoreconnect: bool = Field(
        False,
        description="Desired connection state. Set True automatically on a successful connect, False on an explicit disconnect; on start the driver re-opens its port when this is True and last_port is set. Defaults False so a fresh instance never opens a guessed port.",
    )


# ─── service ───────────────────────────────────────────────────────────


class SabertoothService(SubprocessService):
    """Sabertooth 2x25 motor_controller. See module docstring for the
    promoted motor_controller wire contract."""

    type_name = "sabertooth"
    heartbeat_interval_s = 1.0
    config_class = SabertoothConfig
    publishes = ["state"]

    def __init__(self, proxy_id, bus) -> None:
        super().__init__(proxy_id, bus)
        self._link: Optional[SerialLink] = None
        # Last commanded normalized value per channel (post-clamp), so
        # the keepalive task can re-send and the UI can read it back.
        self._motors: Dict[int, float] = {m: 0.0 for m in protocol.MOTOR_CHANNELS}
        self._errors: int = 0
        self._last_error: Optional[str] = None
        self._connected_at: Optional[str] = None
        self._keepalive_task: Optional[asyncio.Task] = None

    # ─── lifecycle ───────────────────────────────────────────────────
    async def on_start(self) -> None:
        await self._publish_state()
        if self.config.autoreconnect and self.config.last_port:
            try:
                await self._open(self.config.last_port, self.config.last_baud)
            except Exception:  # noqa: BLE001
                logger.exception(
                    "sabertooth %s: autoreconnect to %s failed",
                    self.proxy_id, self.config.last_port,
                )
                await self._publish_state()

    async def on_stop(self) -> None:
        # Stop motors before tearing the link down — never leave a
        # driver energised on shutdown.
        await self._close(stop_first=True)

    # ─── @service_method actions — connection ────────────────────────
    @service_method("list_ports")
    async def m_list_ports(self) -> Dict[str, Any]:
        """Rescan serial ports and republish state."""
        await self._publish_state()
        return {"ports": list_serial_ports()}

    @service_method("connect", publishes=["state"])
    async def m_connect(
        self,
        port: str,
        baudrate: Optional[int] = None,
        address: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Open the port, send the autobaud byte, and push the safety
        config (serial timeout / ramping / deadband) to the driver.

        Connect failures are survivable — the service keeps running so
        the operator can pick a different port. The error is surfaced
        on /state (``last_error``) and in the reply envelope."""
        if not port:
            raise ValueError("connect requires a port")
        baud = int(baudrate) if baudrate is not None else self.config.last_baud
        if address is not None:
            await self.update_config({"address": int(address)})
        try:
            await self._open(port, baud)
        except Exception as exc:  # noqa: BLE001
            logger.exception("sabertooth %s: connect to %s failed", self.proxy_id, port)
            self._errors += 1
            self._last_error = f"connect {port}: {exc}"
            await self._publish_state()
            return {"connected": False, "error": self._last_error}
        return self._snapshot()

    @service_method("disconnect", publishes=["state"])
    async def m_disconnect(self) -> Dict[str, Any]:
        """Stop both motors and close the port. ``last_port`` /
        ``last_baud`` stay in config so the UI re-selects them. Clears
        ``autoreconnect`` — an explicit disconnect means "stay down on the
        next start" (unlike a shutdown, which preserves it)."""
        await self._close(stop_first=True)
        await self.update_config({"autoreconnect": False})
        return self._snapshot()

    # ─── @service_method actions — motor_controller interface ────────
    @service_method("motor_set", publishes=["state"])
    async def m_motor_set(self, motor: int, value: float) -> Dict[str, Any]:
        """Drive ``motor`` (channel 1 or 2) at signed throttle
        ``value`` (-1.0..+1.0). Clamped to ±``max_output`` before it
        reaches the wire."""
        ch = self._require_channel(motor)
        clamped = self._clamp_output(float(value))
        self._motors[ch] = clamped
        await self._send(protocol.drive_packet(self.config.address, ch, clamped))
        await self._publish_state()
        return {"motor": ch, "value": clamped}

    @service_method("motor_stop", publishes=["state"])
    async def m_motor_stop(self, motor: int) -> Dict[str, Any]:
        """Stop one motor channel (sets it to 0)."""
        ch = self._require_channel(motor)
        self._motors[ch] = 0.0
        await self._send(protocol.stop_packet(self.config.address, ch))
        await self._publish_state()
        return {"motor": ch, "value": 0.0}

    @service_method("motor_stop_all", publishes=["state"])
    async def m_motor_stop_all(self) -> Dict[str, Any]:
        """Emergency stop — set every channel to 0. Best-effort: each
        channel is sent independently so one failing write doesn't
        leave the other running."""
        for ch in protocol.MOTOR_CHANNELS:
            self._motors[ch] = 0.0
        for ch in protocol.MOTOR_CHANNELS:
            try:
                await self._send(protocol.stop_packet(self.config.address, ch))
            except Exception:  # noqa: BLE001
                logger.exception("sabertooth %s: stop_all channel %d failed", self.proxy_id, ch)
        await self._publish_state()
        return {"stopped": True}

    # ─── @service_method actions — safety / options ──────────────────
    @service_method("set_max_output", publishes=["state"])
    async def m_set_max_output(self, max_output: float) -> Dict[str, Any]:
        """Set the driver-side magnitude clamp (0..1) and re-clamp any
        channel already running above the new ceiling."""
        mx = max(0.0, min(1.0, float(max_output)))
        await self.update_config({"max_output": mx})
        # Re-clamp live channels so lowering the ceiling takes effect
        # immediately on anything currently above it.
        for ch, val in list(self._motors.items()):
            reclamped = self._clamp_output(val)
            if reclamped != val:
                self._motors[ch] = reclamped
                if self._link is not None:
                    await self._send(protocol.drive_packet(self.config.address, ch, reclamped))
        await self._publish_state()
        return {"max_output": mx}

    @service_method("set_options", publishes=["state"])
    async def m_set_options(
        self,
        serial_timeout_ms: Optional[int] = None,
        ramping: Optional[int] = None,
        deadband: Optional[int] = None,
        address: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Update driver options and, when connected, push them to the
        hardware. Persisted so they're re-applied on the next connect."""
        updates: Dict[str, Any] = {}
        if serial_timeout_ms is not None:
            updates["serial_timeout_ms"] = max(0, int(serial_timeout_ms))
        if ramping is not None:
            updates["ramping"] = max(0, min(80, int(ramping)))
        if deadband is not None:
            updates["deadband"] = max(0, min(127, int(deadband)))
        if address is not None:
            updates["address"] = max(protocol.ADDRESS_MIN, min(protocol.ADDRESS_MAX, int(address)))
        if updates:
            await self.update_config(updates)
        if self._link is not None:
            await self._apply_hardware_options()
            # Timeout change → restart the keepalive cadence.
            self._restart_keepalive()
        await self._publish_state()
        return self._snapshot()

    # ─── internals ───────────────────────────────────────────────────
    def _require_channel(self, motor: Any) -> int:
        ch = int(motor)
        if ch not in protocol.MOTOR_CHANNELS:
            raise ValueError(f"motor must be one of {protocol.MOTOR_CHANNELS} (got {motor})")
        return ch

    def _clamp_output(self, value: float) -> float:
        """Clamp a signed throttle to [-max_output, +max_output]."""
        mx = float(self.config.max_output)
        return max(-mx, min(mx, float(value)))

    async def _send(self, data: bytes) -> None:
        """Write a packet to the link. Raises if not connected so the
        caller's reply envelope carries the failure."""
        if self._link is None:
            raise RuntimeError("sabertooth is not connected — call connect() first")
        try:
            await self._link.write(data)
        except Exception as exc:  # noqa: BLE001
            self._errors += 1
            self._last_error = f"write: {exc}"
            await self._publish_state()
            raise

    async def _open(self, port: str, baudrate: int) -> None:
        """Open the port, autobaud, and push hardware options."""
        await self._close(stop_first=False)
        link = SerialLink(port=port, baudrate=int(baudrate), logger=logger)
        await link.open()
        self._link = link
        self._connected_at = _iso_now()
        self._last_error = None
        # All channels start stopped on a fresh connection.
        self._motors = {m: 0.0 for m in protocol.MOTOR_CHANNELS}
        # Autobaud: a single 0xAA so the driver locks onto our rate.
        await link.write(bytes([protocol.AUTOBAUD_BYTE]))
        await self._apply_hardware_options()
        # Command both channels to 0 explicitly so the driver's state
        # matches ours right after connect.
        for ch in protocol.MOTOR_CHANNELS:
            await link.write(protocol.stop_packet(self.config.address, ch))
        # Persist port/baud + the desired connection state. Reconnecting on
        # the next start is SAFE: motors come up at 0 (above) — only an
        # explicit motor_set energises the driver.
        await self.update_config({"last_port": port, "last_baud": int(baudrate), "autoreconnect": True})
        self._restart_keepalive()
        await self._publish_state()

    async def _apply_hardware_options(self) -> None:
        """Push serial-timeout / ramping / deadband to the driver.
        Ramping/deadband are only sent when non-zero so a fresh driver
        keeps its factory defaults unless the operator opts in."""
        if self._link is None:
            return
        deciseconds = round(self.config.serial_timeout_ms / 100.0)
        await self._link.write(protocol.serial_timeout_packet(self.config.address, deciseconds))
        if self.config.ramping > 0:
            await self._link.write(protocol.ramping_packet(self.config.address, self.config.ramping))
        if self.config.deadband > 0:
            await self._link.write(protocol.deadband_packet(self.config.address, self.config.deadband))

    async def _close(self, *, stop_first: bool) -> None:
        """Cancel keepalive, optionally stop motors, then close the
        link. Idempotent."""
        self._cancel_keepalive()
        if stop_first and self._link is not None:
            for ch in protocol.MOTOR_CHANNELS:
                try:
                    await self._link.write(protocol.stop_packet(self.config.address, ch))
                except Exception:  # noqa: BLE001
                    logger.exception("sabertooth %s: stop-on-close channel %d failed", self.proxy_id, ch)
        if self._link is not None:
            await self._link.close()
            self._link = None
        self._connected_at = None
        self._motors = {m: 0.0 for m in protocol.MOTOR_CHANNELS}
        await self._publish_state()

    # ─── keepalive ─────────────────────────────────────────────────
    def _restart_keepalive(self) -> None:
        """(Re)start the keepalive task whenever the timeout cadence or
        connection changes."""
        self._cancel_keepalive()
        if self._link is not None and self.config.serial_timeout_ms > 0:
            self._keepalive_task = asyncio.create_task(self._keepalive_loop())

    def _cancel_keepalive(self) -> None:
        if self._keepalive_task is not None and not self._keepalive_task.done():
            self._keepalive_task.cancel()
        self._keepalive_task = None

    async def _keepalive_loop(self) -> None:
        """Re-send the last commanded packets at < timeout/2 so steady
        motion survives while a host/bus stall still lets the hardware
        timeout trip. Refresh at half the timeout (floor 100ms)."""
        interval = max(0.1, (self.config.serial_timeout_ms / 1000.0) / 2.0)
        try:
            while self._link is not None:
                await asyncio.sleep(interval)
                if self._link is None:
                    return
                for ch, val in list(self._motors.items()):
                    try:
                        await self._link.write(protocol.drive_packet(self.config.address, ch, val))
                    except Exception:  # noqa: BLE001
                        # A failing keepalive write means the link is
                        # gone; surface it and stop refreshing.
                        self._errors += 1
                        self._last_error = "keepalive write failed"
                        logger.warning("sabertooth %s: keepalive write failed", self.proxy_id)
                        return
        except asyncio.CancelledError:
            pass

    # ─── state ─────────────────────────────────────────────────────
    def _snapshot(self) -> Dict[str, Any]:
        connected = self._link is not None
        return {
            "connected": connected,
            "port": self._link.port if connected else None,
            "baudrate": self._link.baudrate if connected else self.config.last_baud,
            "address": self.config.address,
            # motor_controller interface advertisement: channel count +
            # per-channel commanded values + feedback capability.
            "channels": list(protocol.MOTOR_CHANNELS),
            "motors": {str(ch): self._motors.get(ch, 0.0) for ch in protocol.MOTOR_CHANNELS},
            "has_feedback": False,
            "max_output": self.config.max_output,
            "serial_timeout_ms": self.config.serial_timeout_ms,
            "ramping": self.config.ramping,
            "deadband": self.config.deadband,
            "ports": list_serial_ports(),
            "last_port": self.config.last_port,
            "last_baud": self.config.last_baud,
            "autoreconnect": self.config.autoreconnect,
            "errors": self._errors,
            "last_error": self._last_error,
            "connected_at": self._connected_at,
        }

    async def _publish_state(self) -> None:
        await self.publish("state", self._snapshot(), retained=True)
