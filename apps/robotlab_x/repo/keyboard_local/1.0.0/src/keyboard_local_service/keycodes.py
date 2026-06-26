"""Map host key identities → the canonical (code, key) used on the bus.

The browser keyboard publishes ``KeyboardEvent.code`` ("KeyW") + ``.key``
("w"). Host backends (evdev, pynput) speak their own identities, so this
module normalizes them to the SAME pair — that's what makes a binding like
``combo: "KeyW"`` layout-independent and identical across browser + host.

Pure string→string maps so it's unit-testable without evdev/pynput
installed. The backend handles modifier-state tracking; here we only expose
which canonical codes ARE modifiers (``MODIFIER_OF_CODE``).
"""
from __future__ import annotations

from typing import Dict, Optional, Tuple

# Canonical code → which modifier it is (for the backend's held-mod tracking).
MODIFIER_OF_CODE: Dict[str, str] = {
    "ShiftLeft": "shift", "ShiftRight": "shift",
    "ControlLeft": "ctrl", "ControlRight": "ctrl",
    "AltLeft": "alt", "AltRight": "alt",
    "MetaLeft": "meta", "MetaRight": "meta",
}


def _build_evdev_map() -> Dict[str, Tuple[str, str]]:
    """KEY_* (evdev ecodes name, sans the 'KEY_' prefix) → (code, key)."""
    m: Dict[str, Tuple[str, str]] = {}
    # Letters: KEY_A → (KeyA, a)
    for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
        m[c] = (f"Key{c}", c.lower())
    # Digits: KEY_1 → (Digit1, 1)
    for d in "0123456789":
        m[d] = (f"Digit{d}", d)
    # Function keys
    for n in range(1, 13):
        m[f"F{n}"] = (f"F{n}", f"f{n}")
    m.update({
        "SPACE": ("Space", " "),
        "ENTER": ("Enter", "enter"),
        "TAB": ("Tab", "tab"),
        "ESC": ("Escape", "escape"),
        "BACKSPACE": ("Backspace", "backspace"),
        "DELETE": ("Delete", "delete"),
        "UP": ("ArrowUp", "arrowup"),
        "DOWN": ("ArrowDown", "arrowdown"),
        "LEFT": ("ArrowLeft", "arrowleft"),
        "RIGHT": ("ArrowRight", "arrowright"),
        "LEFTSHIFT": ("ShiftLeft", "shift"),
        "RIGHTSHIFT": ("ShiftRight", "shift"),
        "LEFTCTRL": ("ControlLeft", "ctrl"),
        "RIGHTCTRL": ("ControlRight", "ctrl"),
        "LEFTALT": ("AltLeft", "alt"),
        "RIGHTALT": ("AltRight", "alt"),
        "LEFTMETA": ("MetaLeft", "meta"),
        "RIGHTMETA": ("MetaRight", "meta"),
        "MINUS": ("Minus", "-"),
        "EQUAL": ("Equal", "="),
        "COMMA": ("Comma", ","),
        "DOT": ("Period", "."),
        "SLASH": ("Slash", "/"),
        "SEMICOLON": ("Semicolon", ";"),
    })
    return m


_EVDEV_MAP = _build_evdev_map()


def evdev_to_canonical(key_name: str) -> Tuple[str, str]:
    """``"KEY_W"`` / ``"W"`` → ``("KeyW", "w")``. Unknown keys fall back to
    ``("", <lowered name>)`` so they still publish (just not layout-coded)."""
    name = str(key_name or "").upper()
    if name.startswith("KEY_"):
        name = name[4:]
    hit = _EVDEV_MAP.get(name)
    if hit:
        return hit
    return ("", name.lower())


# pynput special-key names (keyboard.Key.<name>) → canonical (code, key).
_PYNPUT_SPECIAL: Dict[str, Tuple[str, str]] = {
    "space": ("Space", " "),
    "enter": ("Enter", "enter"),
    "tab": ("Tab", "tab"),
    "esc": ("Escape", "escape"),
    "backspace": ("Backspace", "backspace"),
    "delete": ("Delete", "delete"),
    "up": ("ArrowUp", "arrowup"),
    "down": ("ArrowDown", "arrowdown"),
    "left": ("ArrowLeft", "arrowleft"),
    "right": ("ArrowRight", "arrowright"),
    "shift": ("ShiftLeft", "shift"), "shift_l": ("ShiftLeft", "shift"), "shift_r": ("ShiftRight", "shift"),
    "ctrl": ("ControlLeft", "ctrl"), "ctrl_l": ("ControlLeft", "ctrl"), "ctrl_r": ("ControlRight", "ctrl"),
    "alt": ("AltLeft", "alt"), "alt_l": ("AltLeft", "alt"), "alt_r": ("AltRight", "alt"), "alt_gr": ("AltRight", "alt"),
    "cmd": ("MetaLeft", "meta"), "cmd_l": ("MetaLeft", "meta"), "cmd_r": ("MetaRight", "meta"),
}
for _i in range(1, 13):
    _PYNPUT_SPECIAL[f"f{_i}"] = (f"F{_i}", f"f{_i}")


def pynput_to_canonical(name: Optional[str], char: Optional[str]) -> Tuple[str, str]:
    """Map a pynput key to canonical (code, key).

    pynput hands either a special ``Key`` (``.name`` e.g. 'space', 'ctrl_l')
    or a printable ``KeyCode`` (``.char`` e.g. 'w'). The backend passes
    whichever it has; ``char`` wins for printable keys."""
    if char:
        ch = str(char)
        low = ch.lower()
        if "a" <= low <= "z":
            return (f"Key{low.upper()}", low)
        if "0" <= ch <= "9":
            return (f"Digit{ch}", ch)
        return ("", low)
    if name:
        hit = _PYNPUT_SPECIAL.get(str(name).lower())
        if hit:
            return hit
        return ("", str(name).lower())
    return ("", "")
