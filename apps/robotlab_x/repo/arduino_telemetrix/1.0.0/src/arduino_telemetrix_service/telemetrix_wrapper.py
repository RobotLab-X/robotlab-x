"""Thin async facade over telemetrix-aio.

Unlike pymata4 (synchronous, thread-spawning — see the ``arduino``
service's ``pymata_wrapper``), telemetrix-aio is asyncio-NATIVE: every
board call is already a coroutine that cooperates with our event loop, so
there is no executor bridging here. The wrapper exists to:

  * normalize pin-mode strings + the servo_controller contract so the
    bus grammar matches the pymata4 ``arduino`` service exactly, and a
    ``servo`` consumer can't tell the two backends apart;
  * own the ``pixel_strip`` capability — addressable NeoPixel/WS2812
    control, including a software color buffer so brightness scaling and
    x/y matrix addressing work even though the Telemetrix firmware only
    knows linear pixel offsets and has no hardware brightness.

Hardware-call seams
-------------------
Every line that actually touches the board goes through ``self._board``,
a ``telemetrix_aio.TelemetrixAIO`` instance. These are the firmware
seams — they're exercised against real hardware, and mocked in tests
(``tests/test_arduino_telemetrix.py`` injects a fake board). The
telemetrix-aio method names are called out in comments where they're
non-obvious so a firmware/library version bump is easy to track down.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# Map our wire mode strings → telemetrix-aio "set pin mode" coroutine
# names. Kept parallel to the pymata4 wrapper's table so the two arduino
# backends accept the identical mode grammar.
_PIN_MODE_SETTERS = {
    "input":  "set_pin_mode_digital_input",
    "output": "set_pin_mode_digital_output",
    "pwm":    "set_pin_mode_pwm_output",
    "analog": "set_pin_mode_analog_input",
    "servo":  "set_pin_mode_servo",
}


def _clamp_u8(v: Any) -> int:
    return max(0, min(255, int(v)))


class TelemetrixBoard:
    """Wraps ``telemetrix_aio.TelemetrixAIO``. All public methods are
    awaitable and run on the caller's event loop."""

    def __init__(self) -> None:
        self._board: Any = None       # TelemetrixAIO instance, or None when disconnected
        self.port: Optional[str] = None
        self.baud: int = 115200
        # Cached pin state, populated as the user touches pins. The
        # service mirrors this verbatim into /state for the UI.
        self.pins: Dict[int, Dict[str, Any]] = {}

        # ─── pixel_strip state ───────────────────────────────────────
        # Telemetrix supports a SINGLE neopixel strip per board (one
        # configured pin). We keep a software model so brightness +
        # matrix addressing work regardless of firmware limits:
        self.pixel_pin: Optional[int] = None
        self.pixel_count: int = 0
        self.pixel_width: int = 0          # matrix columns (0 = treat as a 1-D strip)
        self.pixel_height: int = 0         # matrix rows
        self.pixel_serpentine: bool = False
        self.pixel_brightness: int = 255   # software scale 0..255 (no HW brightness in Telemetrix)
        # Raw (un-scaled) colors the operator asked for; brightness is
        # applied on the way to the firmware so set_brightness can
        # re-render the whole strip without losing the requested colors.
        self._pixel_buf: List[Tuple[int, int, int]] = []

        # Latest sonar distances keyed by trigger pin. Telemetrix reports
        # sonar asynchronously via callback (there is no blocking read),
        # so we cache the most recent value and serve that on read.
        self._sonar_cm: Dict[int, float] = {}

    # ─── helpers ─────────────────────────────────────────────────────
    @property
    def connected(self) -> bool:
        return self._board is not None

    def _require(self) -> Any:
        if self._board is None:
            raise RuntimeError("not connected to a board — connect() first")
        return self._board

    # ─── lifecycle ───────────────────────────────────────────────────
    async def connect(
        self,
        port: str,
        baud: int = 115200,
        arduino_wait: float = 4.0,
    ) -> Dict[str, Any]:
        """Open the Telemetrix board on ``port``.

        ``arduino_wait`` is how long telemetrix-aio sleeps after opening
        the serial port before handshaking — opening the port resets
        Uno/Mega-style boards via DTR, and the Telemetrix4Arduino sketch
        needs time to boot. 4s mirrors the pymata4 service's default.

        telemetrix-aio's constructor can auto-start on the loop, but we
        pass ``autostart=False`` and call ``start_aio()`` explicitly so
        connect failures surface HERE (as a RuntimeError the service
        turns into a ``connect_error`` banner) rather than from a
        fire-and-forget task on the loop.
        """
        if self._board is not None:
            await self.disconnect()
        # Lazy import so a missing dependency surfaces in connect() rather
        # than at module load (mirrors the pymata4 wrapper).
        from telemetrix_aio import telemetrix_aio  # type: ignore

        self.port = port
        self.baud = baud

        # FIRMWARE SEAM: construct + start the board. autostart=False +
        # explicit start_aio() keeps the open synchronous-to-us so we can
        # await it and catch failures. loop=... binds it to our running
        # loop instead of letting telemetrix grab its own.
        loop = asyncio.get_running_loop()
        board = telemetrix_aio.TelemetrixAIO(
            com_port=port,
            arduino_wait=arduino_wait,
            autostart=False,
            loop=loop,
            # We own shutdown via disconnect()/on_stop — don't let the
            # library tear the loop down underneath the service.
            shutdown_on_exception=True,
            close_loop_on_shutdown=False,
        )
        await board.start_aio()
        self._board = board
        return await self.board_info()

    async def disconnect(self) -> None:
        b = self._board
        self._board = None
        self.pins.clear()
        self._reset_pixels()
        self._sonar_cm.clear()
        if b is None:
            return
        try:
            # FIRMWARE SEAM: telemetrix-aio graceful shutdown.
            await b.shutdown()
        except Exception:  # noqa: BLE001
            logger.exception("telemetrix shutdown raised")

    async def board_info(self) -> Dict[str, Any]:
        b = self._require()
        info: Dict[str, Any] = {"port": self.port, "baud": self.baud}
        # telemetrix-aio fills ``firmware_version`` ([major, minor, ...])
        # during start_aio(); ``get_firmware_version`` re-requests it.
        # Both are best-effort — a board that's up but slow to answer
        # shouldn't fail the connect, so we fall back to None.
        try:
            fw = getattr(b, "firmware_version", None)
            if not fw and hasattr(b, "get_firmware_version"):
                fw = await b.get_firmware_version()  # FIRMWARE SEAM
            if isinstance(fw, (list, tuple)) and fw:
                info["firmware_version"] = ".".join(str(x) for x in fw)
            elif fw:
                info["firmware_version"] = str(fw)
            else:
                info["firmware_version"] = None
        except Exception:  # noqa: BLE001
            logger.exception("board_info: firmware version unavailable")
            info["firmware_version"] = None
        info["firmware_name"] = "Telemetrix4Arduino"
        info["firmata_version"] = None  # Telemetrix is not Firmata; field kept for UI parity
        return info

    # ─── pins ────────────────────────────────────────────────────────
    async def set_pin_mode(self, pin: int, mode: str) -> None:
        b = self._require()
        setter_name = _PIN_MODE_SETTERS.get(mode)
        if setter_name is None:
            raise ValueError(f"unknown pin mode {mode!r}")
        setter = getattr(b, setter_name)
        # FIRMWARE SEAM: input/analog modes take a reporting callback in
        # telemetrix-aio; output/pwm/servo don't. Pass our cache-updating
        # callback for the read modes.
        if mode in ("input", "analog"):
            await setter(pin, callback=self._make_pin_cb(pin))
        else:
            await setter(pin)
        self.pins.setdefault(pin, {})["mode"] = mode

    def _make_pin_cb(self, pin: int):
        # telemetrix-aio reports as [pin_type, pin, value, timestamp].
        async def _cb(data: Any) -> None:
            try:
                value = data[2] if isinstance(data, (list, tuple)) and len(data) > 2 else data
                self.pins.setdefault(pin, {})["value"] = value
            except Exception:  # noqa: BLE001
                logger.debug("pin %s report callback malformed: %r", pin, data)
        return _cb

    async def digital_write(self, pin: int, value: int) -> None:
        b = self._require()
        await b.digital_write(pin, 1 if value else 0)  # FIRMWARE SEAM
        self.pins.setdefault(pin, {})["value"] = 1 if value else 0

    async def digital_read(self, pin: int) -> int:
        # Telemetrix reports digital reads asynchronously via the mode
        # callback; there is no blocking read. Serve the last cached
        # value (populated by _make_pin_cb), defaulting to 0.
        self._require()
        return int(self.pins.get(pin, {}).get("value", 0) or 0)

    async def analog_read(self, pin: int) -> int:
        # Same async-report model as digital_read.
        self._require()
        return int(self.pins.get(pin, {}).get("value", 0) or 0)

    async def analog_write(self, pin: int, value: int) -> None:
        b = self._require()
        value = _clamp_u8(value)
        await b.pwm_write(pin, value)  # FIRMWARE SEAM
        self.pins.setdefault(pin, {})["value"] = value

    # ─── servo_controller contract ───────────────────────────────────
    async def servo_attach(self, pin: int) -> None:
        b = self._require()
        await b.set_pin_mode_servo(pin)  # FIRMWARE SEAM (default 544..2400µs)
        self.pins.setdefault(pin, {})["mode"] = "servo"

    async def servo_write(self, pin: int, angle: int) -> None:
        b = self._require()
        angle = max(0, min(180, int(angle)))
        await b.servo_write(pin, angle)  # FIRMWARE SEAM
        self.pins.setdefault(pin, {})["value"] = angle

    async def servo_detach(self, pin: int) -> None:
        b = self._require()
        # telemetrix-aio has a real detach (unlike Firmata). Fall back to
        # reverting the pin to input if the installed version lacks it.
        if hasattr(b, "servo_detach"):
            await b.servo_detach(pin)  # FIRMWARE SEAM
        else:
            await b.set_pin_mode_digital_input(pin, callback=self._make_pin_cb(pin))
        self.pins.setdefault(pin, {})["mode"] = "input"

    # ─── pixel_strip contract ────────────────────────────────────────
    def _reset_pixels(self) -> None:
        self.pixel_pin = None
        self.pixel_count = 0
        self.pixel_width = 0
        self.pixel_height = 0
        self.pixel_serpentine = False
        self.pixel_brightness = 255
        self._pixel_buf = []

    def _xy_to_index(self, x: int, y: int) -> int:
        """Map matrix (x, y) → linear pixel offset, honoring serpentine
        wiring (every other row reversed). For a plain strip (width 0)
        this is just ``x``."""
        w = self.pixel_width
        if w <= 0:
            return int(x)
        if self.pixel_serpentine and (int(y) % 2 == 1):
            x = (w - 1) - int(x)
        return int(y) * w + int(x)

    def _scaled(self, rgb: Tuple[int, int, int]) -> Tuple[int, int, int]:
        """Apply software brightness (0..255) to a raw color."""
        s = self.pixel_brightness
        if s >= 255:
            return rgb
        return tuple((c * s) // 255 for c in rgb)  # type: ignore[return-value]

    async def pixel_configure(
        self,
        pin: int,
        count: int,
        width: int = 0,
        height: int = 0,
        serpentine: bool = False,
    ) -> None:
        """(Re)configure the board's single addressable strip/matrix."""
        b = self._require()
        count = max(0, int(count))
        # FIRMWARE SEAM: Telemetrix configures one neopixel pin with a
        # fixed pixel count; reconfiguring just calls it again.
        await b.set_pin_mode_neopixel(pin_number=int(pin), num_pixels=count)
        self.pixel_pin = int(pin)
        self.pixel_count = count
        self.pixel_width = max(0, int(width))
        self.pixel_height = max(0, int(height))
        self.pixel_serpentine = bool(serpentine)
        self.pixel_brightness = 255
        self._pixel_buf = [(0, 0, 0)] * count

    def _require_pixels(self) -> Any:
        b = self._require()
        if self.pixel_pin is None:
            raise RuntimeError("no pixel strip configured — pixel_configure() first")
        return b

    async def pixel_set(self, index: int, r: int, g: int, b_: int, show: bool = True) -> None:
        board = self._require_pixels()
        index = int(index)
        if not (0 <= index < self.pixel_count):
            raise ValueError(f"pixel index {index} out of range 0..{self.pixel_count - 1}")
        rgb = (_clamp_u8(r), _clamp_u8(g), _clamp_u8(b_))
        self._pixel_buf[index] = rgb
        sr, sg, sb = self._scaled(rgb)
        # FIRMWARE SEAM: write one pixel; auto_show pushes immediately.
        await board.neopixel_set_value(index, sr, sg, sb, auto_show=bool(show))

    async def pixel_set_xy(self, x: int, y: int, r: int, g: int, b_: int, show: bool = True) -> None:
        idx = self._xy_to_index(int(x), int(y))
        await self.pixel_set(idx, r, g, b_, show=show)

    async def pixel_fill(self, r: int, g: int, b_: int, show: bool = True) -> None:
        board = self._require_pixels()
        rgb = (_clamp_u8(r), _clamp_u8(g), _clamp_u8(b_))
        self._pixel_buf = [rgb] * self.pixel_count
        sr, sg, sb = self._scaled(rgb)
        # FIRMWARE SEAM: fill the whole strip in one firmware call.
        await board.neopixel_fill(sr, sg, sb, auto_show=bool(show))

    async def pixel_clear(self, show: bool = True) -> None:
        board = self._require_pixels()
        self._pixel_buf = [(0, 0, 0)] * self.pixel_count
        # FIRMWARE SEAM: clear → all pixels off.
        await board.neopixel_clear(auto_show=bool(show))

    async def pixel_show(self) -> None:
        board = self._require_pixels()
        # FIRMWARE SEAM: latch the current buffer to the LEDs.
        await board.neopixel_show()

    async def pixel_set_brightness(self, value: int) -> None:
        """Set software brightness (0..255) and re-render the buffer.

        Telemetrix has no hardware brightness, so we scale each stored
        color and re-push the whole strip."""
        board = self._require_pixels()
        self.pixel_brightness = _clamp_u8(value)
        for i, rgb in enumerate(self._pixel_buf):
            sr, sg, sb = self._scaled(rgb)
            await board.neopixel_set_value(i, sr, sg, sb, auto_show=False)  # FIRMWARE SEAM
        await board.neopixel_show()  # FIRMWARE SEAM

    # ─── i2c ─────────────────────────────────────────────────────────
    async def i2c_setup(self) -> None:
        b = self._require()
        await b.set_pin_mode_i2c()  # FIRMWARE SEAM (default i2c_port=0)

    async def i2c_read(self, addr: int, reg: int, count: int) -> List[int]:
        b = self._require()
        out: List[int] = []
        evt = asyncio.Event()

        async def _cb(data: Any) -> None:
            # telemetrix-aio i2c report: [pin_type, address, register,
            # number_of_bytes, *data_bytes, timestamp]. Be defensive
            # about the exact framing across versions.
            try:
                if isinstance(data, (list, tuple)) and len(data) > 5:
                    out.extend(int(x) for x in data[4:-1])
            finally:
                evt.set()

        # FIRMWARE SEAM: async i2c read; result arrives via callback.
        await b.i2c_read(int(addr), int(reg), int(count), _cb)
        try:
            await asyncio.wait_for(evt.wait(), timeout=2.0)
        except asyncio.TimeoutError:
            raise RuntimeError(f"i2c_read 0x{addr:02x} reg 0x{reg:02x} timed out")
        return out

    async def i2c_write(self, addr: int, data: List[int]) -> None:
        b = self._require()
        # FIRMWARE SEAM: telemetrix-aio i2c_write takes (address, [bytes]).
        await b.i2c_write(int(addr), [int(x) for x in (data or [])])

    # ─── sonar ───────────────────────────────────────────────────────
    async def sonar_setup(self, trigger: int, echo: int) -> None:
        b = self._require()

        async def _cb(data: Any) -> None:
            # telemetrix-aio sonar report: [pin_type, trigger_pin,
            # distance_cm, timestamp].
            try:
                if isinstance(data, (list, tuple)) and len(data) > 2:
                    self._sonar_cm[int(data[1])] = float(data[2])
            except Exception:  # noqa: BLE001
                logger.debug("sonar report malformed: %r", data)

        # FIRMWARE SEAM: register the HC-SR04; distance arrives via callback.
        await b.set_pin_mode_sonar(int(trigger), int(echo), _cb)
        self.pins.setdefault(trigger, {})["mode"] = "sonar_trigger"
        self.pins.setdefault(echo, {})["mode"] = "sonar_echo"

    async def sonar_read(self, trigger: int) -> float:
        # Telemetrix reports sonar asynchronously — serve the latest
        # cached distance for this trigger pin (0.0 until the first
        # report arrives).
        self._require()
        return float(self._sonar_cm.get(int(trigger), 0.0))
