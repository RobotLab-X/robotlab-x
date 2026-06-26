"""ArduinoService — robotlab_x arduino subprocess service.

Subclasses ``rlx_bus.SubprocessService`` so the boilerplate (env loading,
bus client, hello announcement, control dispatch, heartbeat, signals,
consume loop, graceful shutdown) lives in the framework. This module
defines only what's arduino-specific: the @service_method actions, the
state publish, and the pymata_wrapper integration.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from rlx_bus import (
    ServiceConfig,
    SubprocessService,
    list_serial_ports,
    service_method,
)

from .pymata_wrapper import ArduinoBoard


class ArduinoConfig(ServiceConfig):
    """Strongly-typed config for ArduinoService.

    Fields:
      * last_port — port string of the last successful Connect. UI
        pre-selects this in the dropdown on next session.
      * last_baud — last successful baud rate. Default 115200 to match
        FirmataExpress (which is the sketch the robotlab_x docs steer
        users toward — it's the only sketch with on-board sonar/servo
        SYSEX support). pymata4's own default is 115200 and its
        FirmataExpress handshake is conditional on baud=115200, so
        anything else falls through to a firmware-version query that
        fails noisily on a board that's actually fine.
      * autoreconnect — the persisted *desired connection state*. Set
        automatically: True after a successful connect, False after an
        explicit disconnect. On start, a board that was connected
        (autoreconnect=True + a valid last_port) re-opens itself with no
        operator action. Defaults False so a fresh instance never blindly
        opens a guessed port.
    """
    last_port: Optional[str] = None
    last_baud: int = 115200
    autoreconnect: bool = False


logger = logging.getLogger(__name__)


# Port enumeration + ownership detection lives in rlx_bus
# (``list_serial_ports``) so every subprocess service that opens a
# serial device sees the same data. Each entry carries ``holders``
# and ``available`` so the UI can grey out devices another service
# is currently using.


class ArduinoService(SubprocessService):
    """Bus-facing wrapper around the pymata4 board.

    Topic layout (inherited from SubprocessService's namespace
    convention, with this service's ``type_name='arduino'``):

        /arduino/{id}/state        retained — connection + pin snapshot
        /arduino/{id}/heartbeat    1Hz, automatic via base class
        /arduino/{id}/control      incoming actions
        /arduino/{id}/pin/{N}      per-pin value updates
        /arduino/{id}/sonar/{N}    sonar distance updates
    """

    type_name = "arduino"
    heartbeat_interval_s = 1.0   # base class publishes /arduino/{id}/heartbeat
    config_class = ArduinoConfig

    def __init__(self, proxy_id, bus) -> None:
        super().__init__(proxy_id, bus)
        self.board = ArduinoBoard()
        self._info: Dict[str, Any] = {}
        self._connect_error: Optional[str] = None

    # ─── lifecycle ───────────────────────────────────────────────────
    async def on_start(self) -> None:
        await self.publish_state()
        # Restore the desired connection state: a board that was connected
        # when last saved (autoreconnect=True + a valid last_port) re-opens
        # itself. Survivable — a stale/absent port just logs and leaves the
        # service disconnected for the operator to reconnect manually.
        if self.config.autoreconnect and self.config.last_port:
            try:
                self._info = await self.board.connect(
                    self.config.last_port, self.config.last_baud, bus=self.bus,
                )
                self._connect_error = None
            except Exception as exc:  # noqa: BLE001
                logger.exception("arduino %s: autoreconnect to %s failed",
                                 self.proxy_id, self.config.last_port)
                self._info = {}
                self._connect_error = f"{type(exc).__name__}: {exc}"
            await self.publish_state()

    async def on_stop(self) -> None:
        if self.board.connected:
            try:
                await self.board.disconnect()
            except Exception:  # noqa: BLE001
                logger.exception("arduino: disconnect raised during stop")

    # ─── state ───────────────────────────────────────────────────────
    def _snapshot(self) -> Dict[str, Any]:
        return {
            "connected": self.board.connected,
            "port": self.board.port if self.board.connected else None,
            "ports": list_serial_ports(),
            "firmata_version": self._info.get("firmata_version"),
            "firmware_name": self._info.get("firmware_name"),
            "firmware_version": self._info.get("firmware_version"),
            "pins": dict(self.board.pins),
            # Persisted config — UI uses last_port to pre-select the
            # dropdown on next session.
            "last_port": self.config.last_port,
            "last_baud": self.config.last_baud,
            # Desired connection state (drives auto-reconnect on start).
            "autoreconnect": self.config.autoreconnect,
            # Last connect attempt's error string, or None if the most
            # recent attempt succeeded / no attempts yet. Always
            # included in /state so a successful connect publishes
            # explicit None and clears any stale red banner in the UI.
            "connect_error": self._connect_error,
        }

    async def publish_state(self) -> None:
        await self.publish("state", self._snapshot(), retained=True)

    def pin_topic(self, pin: int) -> str:
        return self.topic(f"pin/{pin}")

    def sonar_topic(self, trigger: int) -> str:
        return self.topic(f"sonar/{trigger}")

    # ─── @service_method actions ─────────────────────────────────────
    @service_method("list_ports")
    async def m_list_ports(self) -> Dict[str, Any]:
        """Re-scan serial ports and republish state."""
        await self.publish_state()
        return {"ports": list_serial_ports()}

    @service_method("connect")
    async def m_connect(self, port: str, baud: int = 115200) -> Dict[str, Any]:
        """Open the firmata board on the given port.

        Connect failures are SURVIVABLE — the service keeps running so
        the user can iterate (try a different port/baud, reset the
        board, etc.). Errors are surfaced in two ways:
          * The /state topic carries a ``connect_error`` field that the
            UI's Firmware section renders next to the Connect button.
          * The reply payload (from the CLI ``call connect`` path or
            the inspector's request-response wiring) carries the same
            error envelope so the caller sees it inline.
        The previous version re-raised — the framework's broad-exception
        catch logged a noisy stack and the caller saw "method raised"
        with no actionable detail. Now the connect error is a structured
        return value the UI + CLI can render verbatim.
        """
        if self.board.connected:
            # Defensive: ensure no half-open serial port hangs around
            # from a previous flaky attempt. Best-effort.
            try:
                await self.board.disconnect()
            except Exception:  # noqa: BLE001
                logger.exception("arduino: pre-connect cleanup raised")
        self._info = {}
        # Clear any prior connect_error so the in-flight state doesn't
        # carry the stale red banner from a previous failure.
        self._connect_error = None
        await self.publish_state()
        try:
            # Pass our BusClient so ``bus:<serial-proxy-id>`` URLs
            # can construct a BusBackedSerial that talks to this
            # service's existing bus connection.
            self._info = await self.board.connect(port, baud, bus=self.bus)
        except Exception as exc:  # noqa: BLE001
            logger.exception("arduino: connect to %s failed", port)
            self._info = {}
            self._connect_error = f"{type(exc).__name__}: {exc}"
            await self.publish_state()
            return {"connected": False, "error": self._connect_error}
        # Success — clear the error and persist port/baud + the desired
        # connection state (autoreconnect) so this board re-opens on the
        # next start.
        self._connect_error = None
        await self.update_config({"last_port": port, "last_baud": int(baud), "autoreconnect": True})
        await self.publish_state()
        return self._info

    @service_method("clear_error")
    async def m_clear_error(self) -> Dict[str, Any]:
        """Dismiss any persistent ``connect_error`` on /state so the UI
        clears its red banner. Use after the user has acknowledged the
        last failure — doesn't change board state, just the display."""
        self._connect_error = None
        await self.publish_state()
        return {"cleared": True}

    @service_method("disconnect")
    async def m_disconnect(self) -> Dict[str, Any]:
        """Release the board if connected. Idempotent + tolerant of
        pymata4 shutdown errors — the goal is "after this returns,
        the service is in a known-disconnected state and ready to
        accept a fresh connect"."""
        try:
            await self.board.disconnect()
        except Exception as exc:  # noqa: BLE001
            logger.exception("arduino: disconnect raised — clearing state anyway")
        self._info = {}
        # Explicit operator disconnect → clear the desired connection state
        # so the board does NOT auto-reconnect on the next start.
        await self.update_config({"autoreconnect": False})
        await self.publish_state()
        return {"connected": False}

    @service_method("set_pin_mode")
    async def m_set_pin_mode(self, pin: int, mode: str) -> Dict[str, Any]:
        await self.board.set_pin_mode(int(pin), str(mode))
        await self.publish_state()
        return {"pin": int(pin), "mode": mode}

    @service_method("digital_write")
    async def m_digital_write(self, pin: int, value: int) -> Dict[str, Any]:
        await self.board.digital_write(int(pin), int(value))
        await self.bus.publish(self.pin_topic(int(pin)), {"value": int(bool(value))})
        return {"pin": int(pin), "value": int(bool(value))}

    @service_method("digital_read")
    async def m_digital_read(self, pin: int) -> Dict[str, Any]:
        v = await self.board.digital_read(int(pin))
        await self.bus.publish(self.pin_topic(int(pin)), {"value": v})
        return {"pin": int(pin), "value": v}

    @service_method("analog_read")
    async def m_analog_read(self, pin: int) -> Dict[str, Any]:
        v = await self.board.analog_read(int(pin))
        await self.bus.publish(self.pin_topic(int(pin)), {"value": v})
        return {"pin": int(pin), "value": v}

    @service_method("analog_write")
    async def m_analog_write(self, pin: int, value: int) -> Dict[str, Any]:
        v = max(0, min(255, int(value)))
        await self.board.analog_write(int(pin), v)
        await self.bus.publish(self.pin_topic(int(pin)), {"value": v})
        return {"pin": int(pin), "value": v}

    @service_method("i2c_setup")
    async def m_i2c_setup(self) -> Dict[str, Any]:
        await self.board.i2c_setup()
        return {"ok": True}

    @service_method("i2c_scan")
    async def m_i2c_scan(self) -> Dict[str, Any]:
        addrs = await self.board.i2c_scan()
        return {"addresses": [f"0x{a:02x}" for a in addrs]}

    @service_method("i2c_read")
    async def m_i2c_read(self, addr: int, reg: int, count: int) -> Dict[str, Any]:
        data = await self.board.i2c_read(int(addr), int(reg), int(count))
        return {"addr": int(addr), "reg": int(reg), "data": data}

    @service_method("i2c_write")
    async def m_i2c_write(self, addr: int, data: List[int]) -> Dict[str, Any]:
        await self.board.i2c_write(int(addr), [int(x) for x in (data or [])])
        return {"addr": int(addr), "len": len(data or [])}

    # ─── servo_controller interface ──────────────────────────────────
    # These three methods are the standard servo_controller contract.
    # Any service that declares ``implements: [servo_controller]`` in
    # its package.yml must accept these actions on its /control topic;
    # the servo service publishes them without knowing what board (or
    # protocol) is actually on the other end.
    @service_method("servo_attach")
    async def m_servo_attach(self, pin: int) -> Dict[str, Any]:
        """Configure a pin for servo PWM output."""
        await self.board.set_pin_mode(int(pin), "servo")
        await self.publish_state()
        return {"pin": int(pin), "mode": "servo"}

    @service_method("servo_write")
    async def m_servo_write(self, pin: int, angle: int) -> Dict[str, Any]:
        """Drive a servo to ``angle`` degrees (0..180)."""
        angle = max(0, min(180, int(angle)))
        await self.board.servo_write(int(pin), angle)
        await self.bus.publish(self.pin_topic(int(pin)), {"value": angle})
        return {"pin": int(pin), "angle": angle}

    @service_method("servo_detach")
    async def m_servo_detach(self, pin: int) -> Dict[str, Any]:
        """Return a servo pin to digital-input mode (Firmata has no
        true detach; reverting to input is the conventional substitute).
        """
        await self.board.set_pin_mode(int(pin), "input")
        await self.publish_state()
        return {"pin": int(pin), "mode": "input"}

    @service_method("sonar_setup")
    async def m_sonar_setup(self, trigger_pin: int, echo_pin: int) -> Dict[str, Any]:
        await self.board.sonar_setup(int(trigger_pin), int(echo_pin))
        await self.publish_state()
        return {"trigger": int(trigger_pin), "echo": int(echo_pin)}

    @service_method("sonar_read")
    async def m_sonar_read(self, trigger_pin: int) -> Dict[str, Any]:
        d = await self.board.sonar_read(int(trigger_pin))
        await self.bus.publish(self.sonar_topic(int(trigger_pin)), {"distance_cm": d})
        return {"trigger": int(trigger_pin), "distance_cm": d}
