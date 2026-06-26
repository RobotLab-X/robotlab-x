"""Raspberry Pi board detection.

Pure-Python — no GPIO library needed. Reads ``/proc/device-tree/model``
(the canonical source) and falls back to ``/proc/cpuinfo``'s Hardware
+ Revision fields. When neither exists or neither identifies a Pi, the
service reports ``mock`` mode so the UI is still usable on dev boxes.

Revision codes follow the official scheme documented at
https://www.raspberrypi.com/documentation/computers/raspberry-pi.html
under "RPi-Revision-codes". We decode the modern (post-2014) packed
32-bit format to extract memory size + manufacturer + SoC + model.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional


# Standard 40-pin GPIO header layout used by every Pi since the B+ /
# A+ (so: Pi 2, 3, 4, 5, Zero, Zero W, Zero 2). All BCM-numbered pins
# that can be used as GPIO. The older 26-pin header on Pi 1 Rev 1/2
# is a subset of these.
GPIO_PINS_40PIN = list(range(2, 28))   # BCM 2..27 inclusive

# Pin → header position + alternate function hints. The UI's pin grid
# shows the function so the user knows which pins double as I2C/SPI/UART.
# This is a tiny static map; not exhaustive, just the common aliases.
PIN_FUNCTIONS: Dict[int, str] = {
    2:  "SDA1 (I2C)",
    3:  "SCL1 (I2C)",
    4:  "GPCLK0",
    7:  "CE1 (SPI)",
    8:  "CE0 (SPI)",
    9:  "MISO (SPI)",
    10: "MOSI (SPI)",
    11: "SCLK (SPI)",
    14: "TXD (UART)",
    15: "RXD (UART)",
    18: "PWM0",
    19: "PWM1",
    12: "PWM0",
    13: "PWM1",
}


# SoC / model lookup keyed on the high-order bits of the revision code.
# Source: official revision-code table. We only need a sketch — the
# device-tree model string is the authoritative human label.
_PI_MODELS = {
    0x00: "Pi A",
    0x01: "Pi B",
    0x02: "Pi A+",
    0x03: "Pi B+",
    0x04: "Pi 2B",
    0x06: "Pi Compute Module",
    0x08: "Pi 3B",
    0x09: "Pi Zero",
    0x0A: "Pi Compute Module 3",
    0x0C: "Pi Zero W",
    0x0D: "Pi 3B+",
    0x0E: "Pi 3A+",
    0x10: "Pi Compute Module 3+",
    0x11: "Pi 4B",
    0x12: "Pi Zero 2 W",
    0x13: "Pi 400",
    0x14: "Pi Compute Module 4",
    0x15: "Pi Compute Module 4S",
    0x17: "Pi 5",
}


def _read_text(path: str) -> Optional[str]:
    """Read a file's text content, stripping the trailing NUL that
    /proc/device-tree files carry. Returns None on any read failure."""
    try:
        raw = Path(path).read_text(errors="replace")
    except OSError:
        return None
    return raw.rstrip("\x00").strip() or None


def _parse_cpuinfo() -> Dict[str, str]:
    """Pull the key/value pairs from /proc/cpuinfo. Empty dict if the
    file is missing or unparseable."""
    text = _read_text("/proc/cpuinfo")
    if text is None:
        return {}
    out: Dict[str, str] = {}
    for line in text.splitlines():
        if ":" not in line:
            continue
        k, _, v = line.partition(":")
        out[k.strip()] = v.strip()
    return out


def _decode_revision(rev_hex: str) -> Dict[str, Any]:
    """Decode the packed 32-bit revision into the documented fields.
    Returns the empty dict if ``rev_hex`` doesn't parse.

    The "new" (post-2014) revision-code format has the layout:
        bit 31..24: reserved
        bit 23:     "new flag" — 1 means new-style code
        bit 22..20: memory size code
        bit 19..16: manufacturer
        bit 15..12: processor SoC
        bit 11..4:  model id
        bit 3..0:   revision number
    Older boards used short 4-digit hex codes (e.g. '0002'); those we
    just map by lookup, leaving the structured fields empty.
    """
    try:
        rev = int(rev_hex, 16)
    except ValueError:
        return {}
    if not (rev & (1 << 23)):
        # Old short format — we have just an opaque code; return it as-is.
        return {"revision_code": rev_hex}
    mem_bits = (rev >> 20) & 0x7
    mem_mib = (256 << mem_bits) if mem_bits else None
    soc_id = (rev >> 12) & 0xF
    socs = {0: "BCM2835", 1: "BCM2836", 2: "BCM2837", 3: "BCM2711", 4: "BCM2712"}
    model_id = (rev >> 4) & 0xFF
    rev_num = rev & 0xF
    return {
        "revision_code": rev_hex,
        "model_id": model_id,
        "model": _PI_MODELS.get(model_id, f"unknown(0x{model_id:02X})"),
        "soc": socs.get(soc_id, f"unknown SoC ({soc_id})"),
        "memory_mb": mem_mib,
        "revision": rev_num,
    }


def detect_board() -> Dict[str, Any]:
    """Return a structured board snapshot. Always returns SOMETHING —
    falls back to ``{kind: 'mock', reason: ...}`` when not on a Pi.

    Fields when on a Pi:
      * ``kind``: 'raspi'
      * ``model``: device-tree model string (authoritative human label)
      * ``soc``: BCM chip identifier from revision decode
      * ``revision_code`` / ``revision``: from /proc/cpuinfo
      * ``memory_mb``: parsed from revision code
      * ``serial``: /proc/cpuinfo Serial field (CPU serial, not eth MAC)
      * ``gpio_pins``: list of usable BCM pin numbers
      * ``pin_functions``: pin → alternate-function label
    """
    model = _read_text("/proc/device-tree/model")
    cpuinfo = _parse_cpuinfo()

    is_pi = (model is not None and "raspberry pi" in model.lower())
    if not is_pi:
        return {
            "kind": "mock",
            "reason": "not running on a Raspberry Pi — GPIO/I2C calls return placeholder data",
            "model": model or "unknown",
            "gpio_pins": GPIO_PINS_40PIN,
            "pin_functions": PIN_FUNCTIONS,
        }

    rev_hex = cpuinfo.get("Revision", "")
    decoded = _decode_revision(rev_hex)
    return {
        "kind": "raspi",
        "model": model,
        "soc": decoded.get("soc"),
        "revision_code": decoded.get("revision_code") or rev_hex or None,
        "revision": decoded.get("revision"),
        "memory_mb": decoded.get("memory_mb"),
        "serial": cpuinfo.get("Serial"),
        "hardware": cpuinfo.get("Hardware"),
        # Header layout — every modern Pi has the 40-pin header. Pi 5
        # added some extras but the BCM 2..27 set is the portable subset.
        "gpio_pins": GPIO_PINS_40PIN,
        "pin_functions": PIN_FUNCTIONS,
    }
