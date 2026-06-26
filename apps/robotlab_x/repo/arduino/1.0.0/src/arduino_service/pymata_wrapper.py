"""Thin facade over pymata4.

pymata4 is synchronous and spawns its own threads. The asyncio bus client
lives in the main loop. This wrapper bridges between them — every method
that touches the board runs in the default executor, so awaiting one
doesn't block the loop while pymata4's internal threads do their work.

Pin-mode strings are normalized here ('input', 'output', 'pwm', 'analog',
'servo', 'i2c') so the wire grammar stays the same regardless of which
pymata4 method name maps to which mode.

Bus-backed virtual ports
------------------------
``connect("bus:<serial-proxy-id>", baud, ...)`` routes the firmata
byte stream through a robotlab_x ``serial`` service instead of
directly opening ``/dev/ttyXXX``. Implementation: we monkey-patch
``pymata4.pymata4.serial.Serial`` once at connect-time to dispatch
``bus:*`` URLs into a ``rlx_bus.BusBackedSerial`` (pyserial-shaped,
bus-backed). Non-bus URLs fall through to the real pyserial
``Serial`` class. pymata4 itself is untouched — it still calls
``serial.Serial(com_port, ...)`` and gets whichever class the
factory picks.
"""
from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any, Dict, List, Optional, Tuple

from rlx_bus import BusBackedSerial


logger = logging.getLogger(__name__)


# pymata4 imports ``serial`` at module-load and stashes the
# reference; we patch ``serial.Serial`` on that stashed module so
# every pymata4 ``serial.Serial(port, ...)`` call goes through our
# factory. Done once per process (idempotent), via a closure that
# captures the BusClient so BusBackedSerial can subscribe + publish.
_pymata_serial_patch_installed = False


def install_bus_serial_patch(bus: Any, loop: asyncio.AbstractEventLoop) -> None:
    """Replace ``pymata4.pymata4.serial.Serial`` with a dispatcher
    that returns a ``BusBackedSerial`` for ``bus:*`` port URLs and
    delegates to the real ``pyserial.Serial`` for everything else.

    Idempotent across multiple connects in the same process (the
    closure just gets refreshed with the latest bus/loop). The
    patch is on the ``serial`` module REFERENCE inside pymata4's
    namespace — other code that imports ``serial`` directly is
    unaffected.
    """
    global _pymata_serial_patch_installed
    # Lazy-import pymata4 here so a missing dependency surfaces in
    # connect() rather than at module load (mirrors the original
    # behaviour below in ArduinoBoard.connect).
    from pymata4 import pymata4 as _pm
    import serial as _real_serial_mod
    real_Serial = _real_serial_mod.Serial

    def _factory(port: Any, *args: Any, **kwargs: Any) -> Any:
        if isinstance(port, str) and port.startswith("bus:"):
            proxy_id = port[len("bus:") :]
            return BusBackedSerial(
                bus=bus,
                proxy_id=proxy_id,
                baudrate=kwargs.get("baudrate", args[0] if args else 115200),
                timeout=kwargs.get("timeout", 1.0),
                loop=loop,
            )
        return real_Serial(port, *args, **kwargs)

    # Patch the ``serial`` module reference inside pymata4 only;
    # don't touch the global ``serial`` module so other consumers
    # see unmodified behaviour.
    _pm.serial.Serial = _factory  # type: ignore[attr-defined]
    _pymata_serial_patch_installed = True

# Map our mode strings to pymata4 setter method names.
_PIN_MODE_SETTERS = {
    "input":    "set_pin_mode_digital_input",
    "output":   "set_pin_mode_digital_output",
    "pwm":      "set_pin_mode_pwm_output",
    "analog":   "set_pin_mode_analog_input",
    "servo":    "set_pin_mode_servo",
}


class ArduinoBoard:
    """Wraps pymata4.Pymata4. All public methods are awaitable."""

    def __init__(self) -> None:
        self._board = None        # pymata4.Pymata4 instance, or None when disconnected
        self._lock = threading.Lock()
        self.port: Optional[str] = None
        self.baud: int = 115200
        # Cached pin state, populated as the user touches pins. UI gets
        # this verbatim through ArduinoService.state().
        self.pins: Dict[int, Dict[str, Any]] = {}

    # ─── helpers ─────────────────────────────────────────────────────
    @property
    def connected(self) -> bool:
        return self._board is not None

    async def _run(self, fn, *args, **kwargs):
        """Offload a synchronous pymata4 call to a thread."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, lambda: fn(*args, **kwargs))

    def _require(self):
        if self._board is None:
            raise RuntimeError("not connected to a board — connect() first")
        return self._board

    # ─── lifecycle ───────────────────────────────────────────────────
    async def connect(
        self,
        port: str,
        baud: int = 115200,
        arduino_wait: float = 4.0,
        bus: Any = None,
    ) -> Dict[str, Any]:
        """Open the board on `port`. Raises if pymata4 can't establish.

        ``port`` accepts two shapes:
          * ``"/dev/ttyACM0"`` (or platform equivalent) — opens the
            OS device directly via pyserial.
          * ``"bus:<serial-proxy-id>"`` — routes the firmata byte
            stream through a robotlab_x ``serial`` service that
            already owns the OS device. Requires ``bus`` to be the
            arduino service's BusClient so the BusBackedSerial can
            subscribe + publish. See ``install_bus_serial_patch``
            for the mechanism.

        ``arduino_wait`` is how long pymata4 sleeps after opening the
        serial port before requesting the firmware version. Opening
        the port resets Uno/Mega-style boards via the DTR pin, and
        the firmware needs time to boot back up. Default is 4s —
        FirmataExpress needs at least this; we'd been passing 2 which
        produced "Firmata Sketch Firmware Version Not Found" on a
        board that was perfectly fine, just still booting.

        ``baud`` defaults to 115200 because pymata4's FirmataExpress
        identification handshake (ARE_YOU_THERE / I_AM_HERE sysex) is
        guarded by ``if baud == 115200``. Any other baud falls through
        to a firmware-version query that times out on a properly
        flashed board, surfacing as the same "Firmware Version Not
        Found" RuntimeError. FirmataExpress itself runs at 115200 by
        default — there's no good reason to deviate.
        """
        if self._board is not None:
            await self.disconnect()
        from pymata4 import pymata4  # imported here so a missing dep surfaces in connect()
        self.port = port
        self.baud = baud

        # Install the bus-serial dispatcher BEFORE pymata4 constructs
        # its serial port. The patch is a no-op for non-``bus:*``
        # URLs so we can install unconditionally — having ``bus``
        # available is the only precondition. When ``bus`` is None
        # (some callsites might omit it), bus: URLs would crash on
        # subscribe — caller should pass bus when it might be needed.
        if bus is not None:
            loop = asyncio.get_running_loop()
            install_bus_serial_patch(bus, loop)

        def _open():
            return pymata4.Pymata4(com_port=port, baud_rate=baud, arduino_wait=arduino_wait)
        self._board = await self._run(_open)
        return await self.board_info()

    async def disconnect(self) -> None:
        b = self._board
        self._board = None
        self.pins.clear()
        if b is None:
            return
        try:
            await self._run(b.shutdown)
        except Exception:  # noqa: BLE001
            logger.exception("pymata4 shutdown raised")

    async def board_info(self) -> Dict[str, Any]:
        b = self._require()
        # pymata4 exposes get_firmware_version() (the sketch's reported
        # version — includes the firmware NAME like "FirmataExpress.ino")
        # and get_protocol_version() (the Firmata protocol, e.g. "2.5").
        # Both are METHODS, not attributes. Calls block briefly while
        # pymata4 reads from its internal buffers — run in a thread so
        # we don't stall the event loop.
        info: Dict[str, Any] = {"port": self.port, "baud": self.baud}

        def _fmt(value: Any) -> Any:
            """Stringify a version-ish value. pymata4 may return a tuple
            (2, 5), a list, or already a string."""
            if value is None:
                return None
            if isinstance(value, (tuple, list)):
                return ".".join(str(x) for x in value)
            return str(value)

        try:
            fw_raw = await self._run(b.get_firmware_version)
            fw_str = _fmt(fw_raw)
            info["firmware_version"] = fw_str
            info["firmware_name"] = fw_str
            # Real-world pymata4 reports the firmware ID as
            # "<major>.<minor> <SketchName>.ino" — e.g. "1.2 FirmataExpress.ino".
            # Split the leading dotted-numeric chunk off as the version
            # and treat the rest as the name. Falls back to the raw
            # string for both when the format doesn't match (so UI
            # always shows *something* useful).
            if isinstance(fw_str, str) and " " in fw_str:
                ver, _, name = fw_str.partition(" ")
                ver = ver.strip(); name = name.strip()
                if ver.replace(".", "").isdigit() and name:
                    info["firmware_version"] = ver
                    info["firmware_name"] = name
        except Exception:  # noqa: BLE001
            logger.exception("board_info: get_firmware_version failed")
            info["firmware_version"] = None
            info["firmware_name"] = None

        try:
            proto = await self._run(b.get_protocol_version)
            info["firmata_version"] = _fmt(proto)
        except Exception:  # noqa: BLE001
            logger.exception("board_info: get_protocol_version failed")
            info["firmata_version"] = None

        return info

    # ─── pins ────────────────────────────────────────────────────────
    async def set_pin_mode(self, pin: int, mode: str) -> None:
        b = self._require()
        setter_name = _PIN_MODE_SETTERS.get(mode)
        if setter_name is None:
            raise ValueError(f"unknown pin mode {mode!r}")
        setter = getattr(b, setter_name)
        await self._run(setter, pin)
        self.pins.setdefault(pin, {})["mode"] = mode

    async def digital_write(self, pin: int, value: int) -> None:
        b = self._require()
        await self._run(b.digital_write, pin, 1 if value else 0)
        self.pins.setdefault(pin, {})["value"] = 1 if value else 0

    async def digital_read(self, pin: int) -> int:
        b = self._require()
        result = await self._run(b.digital_read, pin)
        # pymata4 returns (value, timestamp)
        value = result[0] if isinstance(result, tuple) else int(result)
        self.pins.setdefault(pin, {})["value"] = value
        return int(value)

    async def analog_read(self, pin: int) -> int:
        b = self._require()
        result = await self._run(b.analog_read, pin)
        value = result[0] if isinstance(result, tuple) else int(result)
        self.pins.setdefault(pin, {})["value"] = value
        return int(value)

    async def analog_write(self, pin: int, value: int) -> None:
        b = self._require()
        value = max(0, min(255, int(value)))
        await self._run(b.pwm_write, pin, value)
        self.pins.setdefault(pin, {})["value"] = value

    async def servo_write(self, pin: int, angle: int) -> None:
        """Write a servo angle. Pin must be in servo mode first.

        pymata4 distinguishes servo_write from pwm_write — for servo
        pins this calls the Firmata servo SYSEX, not the analog
        write. Angles clamp to 0..180; if a fancier servo needs more
        range, set_pin_mode_servo accepts min/max pulse-width
        overrides and we can plumb those through later.
        """
        b = self._require()
        angle = max(0, min(180, int(angle)))
        await self._run(b.servo_write, pin, angle)
        self.pins.setdefault(pin, {})["value"] = angle
        # Don't change cached mode — caller should have called set_pin_mode("servo") first

    # ─── i2c ─────────────────────────────────────────────────────────
    async def i2c_setup(self) -> None:
        b = self._require()
        await self._run(b.set_pin_mode_i2c)

    async def i2c_scan(self) -> List[int]:
        """Probe 0x03..0x77 by attempting a 1-byte read; collect responders.

        Naive but works on most boards. Some firmata builds add a native
        i2c_scan — we don't depend on it.
        """
        b = self._require()
        found: List[int] = []
        for addr in range(0x03, 0x78):
            try:
                # short read; suppress exception → not present
                await self._run(b.i2c_read, addr, 0, 1, _noop_cb)
                found.append(addr)
            except Exception:
                continue
        return found

    async def i2c_read(self, addr: int, reg: int, count: int) -> List[int]:
        b = self._require()
        out: List[int] = []
        evt = asyncio.Event()
        loop = asyncio.get_running_loop()

        def _cb(data):
            # pymata4 invokes from its own thread; bounce to loop
            try:
                # data shape varies by pymata4 version; usually [addr, reg, *bytes, ts]
                bytes_ = list(data[2:-1]) if isinstance(data, list) and len(data) > 3 else list(data or [])
                out.extend(bytes_)
            finally:
                loop.call_soon_threadsafe(evt.set)

        await self._run(b.i2c_read, addr, reg, count, _cb)
        try:
            await asyncio.wait_for(evt.wait(), timeout=2.0)
        except asyncio.TimeoutError:
            raise RuntimeError(f"i2c_read 0x{addr:02x} reg 0x{reg:02x} timed out")
        return out

    async def i2c_write(self, addr: int, data: List[int]) -> None:
        b = self._require()
        await self._run(b.i2c_write, addr, list(data))

    # ─── sonar ───────────────────────────────────────────────────────
    async def sonar_setup(self, trigger: int, echo: int) -> None:
        b = self._require()
        await self._run(b.set_pin_mode_sonar, trigger, echo)
        self.pins.setdefault(trigger, {})["mode"] = "sonar_trigger"
        self.pins.setdefault(echo, {})["mode"] = "sonar_echo"

    async def sonar_read(self, trigger: int) -> float:
        b = self._require()
        result = await self._run(b.sonar_read, trigger)
        distance = result[0] if isinstance(result, tuple) else float(result)
        return float(distance)


def _noop_cb(_data) -> None:
    """No-op callback used by i2c_scan probes."""
    return None
