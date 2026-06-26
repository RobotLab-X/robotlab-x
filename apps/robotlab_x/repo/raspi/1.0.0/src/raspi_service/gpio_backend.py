"""GPIO + I2C backend abstraction.

Two concrete backends:

  * ``HwBackend``  — real gpiozero (auto-picks lgpio/RPi.GPIO) + smbus2.
                     Used when ``detect_board()['kind'] == 'raspi'`` AND
                     gpiozero successfully initialises a pin factory.
  * ``MockBackend`` — pure-Python state machine. No /dev/* access.
                     Used on non-Pi hosts so the UI is exercisable
                     without hardware. Pin values default to 0 and
                     respect writes.

Callers ALWAYS go through ``open_backend()`` — it picks the right one
and reports the chosen mode in the returned object's ``.mode`` so the
service can publish it on /state.
"""
from __future__ import annotations

import logging
import threading
from typing import Any, Dict, List, Optional


logger = logging.getLogger(__name__)


# ─── pin modes the wire grammar accepts ──────────────────────────────
PIN_MODES = ("input", "input_pullup", "input_pulldown", "output", "pwm")


class _PinState(dict):
    """Per-pin state record: {mode, value, polling_interval_ms}."""


class MockBackend:
    """In-memory simulation used on non-Pi hosts.

    Reads return whatever the last write set (or 0 if never written).
    I2C scan/read/write succeed with empty/zero results so the UI can
    be smoke-tested. The mode label is surfaced on /state so the user
    can see "mock — no hardware" rather than thinking the wiring is
    silently broken.
    """

    mode = "mock"

    def __init__(self) -> None:
        self.pins: Dict[int, _PinState] = {}
        self._lock = threading.Lock()

    # ─── lifecycle ─────────────────────────────────────────────
    def close(self) -> None:
        self.pins.clear()

    # ─── pin operations ────────────────────────────────────────
    def set_pin_mode(self, pin: int, mode: str) -> None:
        if mode not in PIN_MODES:
            raise ValueError(f"unknown pin mode {mode!r}")
        with self._lock:
            self.pins.setdefault(pin, _PinState()).update({"mode": mode, "value": 0})

    def digital_write(self, pin: int, value: int) -> None:
        with self._lock:
            self.pins.setdefault(pin, _PinState())["value"] = 1 if value else 0

    def digital_read(self, pin: int) -> int:
        with self._lock:
            return int(self.pins.get(pin, {}).get("value", 0))

    def pwm_write(self, pin: int, duty: float) -> None:
        """duty in [0.0, 1.0]"""
        d = max(0.0, min(1.0, float(duty)))
        with self._lock:
            self.pins.setdefault(pin, _PinState())["value"] = d

    def release(self, pin: int) -> None:
        with self._lock:
            self.pins.pop(pin, None)

    # ─── I2C ───────────────────────────────────────────────────
    def i2c_scan(self, bus: int = 1) -> List[int]:
        return []   # mock — no devices to probe

    def i2c_read(self, addr: int, reg: int, count: int, bus: int = 1) -> List[int]:
        return [0] * int(count)

    def i2c_write(self, addr: int, data: List[int], bus: int = 1) -> None:
        return None


class HwBackend:
    """Real Raspberry Pi backend via gpiozero + smbus2.

    Each pin is owned by exactly one gpiozero device object. Re-binding
    a pin to a different mode releases the old object first — gpiozero
    raises ``GPIOPinInUse`` otherwise. The released-pin map is also
    surfaced through ``release(pin)`` so the UI can explicitly free a
    pin without crashing the next ``set_pin_mode`` call.
    """

    mode = "hw"

    def __init__(self) -> None:
        # Lazy imports — caller has already decided we're on a Pi, so
        # these are expected to import cleanly. We still wrap them so
        # an import error becomes a friendly "couldn't load gpiozero"
        # rather than a hard crash on service start.
        from gpiozero import (  # type: ignore[import-untyped]
            DigitalOutputDevice, DigitalInputDevice, PWMOutputDevice,
        )
        self._DigitalOutputDevice = DigitalOutputDevice
        self._DigitalInputDevice = DigitalInputDevice
        self._PWMOutputDevice = PWMOutputDevice
        self.pins: Dict[int, _PinState] = {}
        self._devices: Dict[int, Any] = {}
        self._lock = threading.Lock()
        # I2C bus handles. Opened on first use, closed on backend close.
        self._i2c_handles: Dict[int, Any] = {}

    # ─── lifecycle ─────────────────────────────────────────────
    def close(self) -> None:
        with self._lock:
            for dev in self._devices.values():
                try:
                    dev.close()
                except Exception:  # noqa: BLE001
                    pass
            self._devices.clear()
            self.pins.clear()
            for handle in self._i2c_handles.values():
                try:
                    handle.close()
                except Exception:  # noqa: BLE001
                    pass
            self._i2c_handles.clear()

    # ─── pin operations ────────────────────────────────────────
    def set_pin_mode(self, pin: int, mode: str) -> None:
        if mode not in PIN_MODES:
            raise ValueError(f"unknown pin mode {mode!r}")
        self._release_pin(pin)
        with self._lock:
            if mode == "output":
                self._devices[pin] = self._DigitalOutputDevice(pin)
            elif mode == "input":
                self._devices[pin] = self._DigitalInputDevice(pin, pull_up=None)
            elif mode == "input_pullup":
                self._devices[pin] = self._DigitalInputDevice(pin, pull_up=True)
            elif mode == "input_pulldown":
                self._devices[pin] = self._DigitalInputDevice(pin, pull_up=False)
            elif mode == "pwm":
                self._devices[pin] = self._PWMOutputDevice(pin)
            self.pins.setdefault(pin, _PinState()).update({"mode": mode, "value": 0})

    def digital_write(self, pin: int, value: int) -> None:
        dev = self._devices.get(pin)
        if dev is None:
            raise RuntimeError(f"pin {pin} not configured — call set_pin_mode first")
        dev.value = 1 if value else 0
        self.pins.setdefault(pin, _PinState())["value"] = 1 if value else 0

    def digital_read(self, pin: int) -> int:
        dev = self._devices.get(pin)
        if dev is None:
            raise RuntimeError(f"pin {pin} not configured — call set_pin_mode first")
        v = int(dev.value)
        self.pins.setdefault(pin, _PinState())["value"] = v
        return v

    def pwm_write(self, pin: int, duty: float) -> None:
        dev = self._devices.get(pin)
        if dev is None:
            raise RuntimeError(f"pin {pin} not configured as pwm — call set_pin_mode first")
        d = max(0.0, min(1.0, float(duty)))
        dev.value = d
        self.pins.setdefault(pin, _PinState())["value"] = d

    def release(self, pin: int) -> None:
        self._release_pin(pin)

    def _release_pin(self, pin: int) -> None:
        with self._lock:
            dev = self._devices.pop(pin, None)
            self.pins.pop(pin, None)
        if dev is not None:
            try:
                dev.close()
            except Exception:  # noqa: BLE001
                logger.exception("gpio: close failed for pin %d", pin)

    # ─── I2C ───────────────────────────────────────────────────
    def _i2c(self, bus: int):
        if bus in self._i2c_handles:
            return self._i2c_handles[bus]
        from smbus2 import SMBus  # type: ignore[import-untyped]
        h = SMBus(bus)
        self._i2c_handles[bus] = h
        return h

    def i2c_scan(self, bus: int = 1) -> List[int]:
        """Probe 0x03..0x77 by attempting a 1-byte read; collect responders.

        Standard SMBus probe range — addresses below 0x03 are reserved
        and 0x78..0x7F are also reserved. Most hobby I2C devices live
        between 0x08 and 0x77.
        """
        h = self._i2c(bus)
        found: List[int] = []
        for addr in range(0x03, 0x78):
            try:
                h.read_byte(addr)
                found.append(addr)
            except Exception:  # noqa: BLE001
                continue
        return found

    def i2c_read(self, addr: int, reg: int, count: int, bus: int = 1) -> List[int]:
        h = self._i2c(bus)
        return list(h.read_i2c_block_data(int(addr), int(reg), int(count)))

    def i2c_write(self, addr: int, data: List[int], bus: int = 1) -> None:
        h = self._i2c(bus)
        data = [int(x) & 0xFF for x in data]
        if not data:
            return
        # First byte is treated as the register; remaining bytes are payload.
        # Callers who don't want register-style writes can pass a 1-byte
        # buffer and the lib treats it as a simple write_byte.
        if len(data) == 1:
            h.write_byte(int(addr), data[0])
        else:
            h.write_i2c_block_data(int(addr), data[0], data[1:])


def open_backend(board_kind: str) -> Any:
    """Pick + initialise the appropriate backend.

    Returns either HwBackend (when on a Pi AND gpiozero comes up
    cleanly) or MockBackend. We catch ImportError + the pin-factory
    initialisation errors gpiozero raises on non-Pi hosts ("Unable to
    load any default pin factory").
    """
    if board_kind != "raspi":
        return MockBackend()
    try:
        return HwBackend()
    except Exception as exc:  # noqa: BLE001
        logger.warning("gpio: HwBackend init failed (%s) — falling back to mock", exc)
        return MockBackend()
