"""Host keyboard-capture backends behind one interface.

Two backends, auto-selected (see ``select_backend``):

  * EvdevBackend  — Linux/RasPi. Reads /dev/input BEFORE the compositor, so
    it works under Wayland + headless and supports exclusive **grab**
    (keys don't reach other apps — teleop). Needs the user in the ``input``
    group (or root).
  * PynputBackend — Windows / macOS / X11-Linux. Global low-level hook.
    macOS needs Input Monitoring + Accessibility grants. No native-Wayland
    global capture, and no exclusive grab.

Each backend runs the capture library on ITS OWN thread(s) and calls
``on_event(raw)`` with a canonical event dict; the service passes
``emit_event_threadsafe`` so events cross back to the asyncio loop.

The library calls are the HARDWARE/OS SEAMS — exercised on real machines,
mocked in tests. Keycode→canonical mapping lives in ``keycodes`` (pure +
unit-tested).
"""
from __future__ import annotations

import logging
import sys
import threading
from typing import Any, Callable, Dict, List, Optional

from .keycodes import MODIFIER_OF_CODE, evdev_to_canonical, pynput_to_canonical

logger = logging.getLogger(__name__)

EventCb = Callable[[Dict[str, Any]], None]
_MODS = ("ctrl", "alt", "shift", "meta")


def _fresh_mods() -> Dict[str, bool]:
    return {m: False for m in _MODS}


class CaptureBackend:
    """Common interface. ``start`` begins delivering events to ``on_event``;
    ``stop`` tears the capture down."""

    name: str = "base"

    @staticmethod
    def available() -> bool:
        return False

    def list_devices(self) -> List[Dict[str, Any]]:
        return []

    def start(self, on_event: EventCb, *, grab: bool = False,
              device_id: Optional[str] = None, scope: str = "global") -> None:
        raise NotImplementedError

    def stop(self) -> None:
        raise NotImplementedError


class PynputBackend(CaptureBackend):
    """Windows / macOS / X11 global hook via pynput."""

    name = "pynput"

    def __init__(self) -> None:
        self._listener: Any = None
        self._mods = _fresh_mods()

    @staticmethod
    def available() -> bool:
        try:
            import pynput  # noqa: F401  # SEAM
            return True
        except Exception:  # noqa: BLE001
            return False

    def start(self, on_event: EventCb, *, grab: bool = False,
              device_id: Optional[str] = None, scope: str = "global") -> None:
        from pynput import keyboard  # SEAM
        self._mods = _fresh_mods()

        def emit(key: Any, type_: str) -> None:
            # pynput hands a Key (special, has .name) or KeyCode (.char).
            name = getattr(key, "name", None)
            char = getattr(key, "char", None)
            code, k = pynput_to_canonical(name, char)
            mod = MODIFIER_OF_CODE.get(code)
            if mod:
                self._mods[mod] = (type_ == "down")
            on_event({
                "type": type_, "key": k, "code": code,
                "modifiers": dict(self._mods), "repeat": False, "source": "local",
            })

        # SEAM: global keyboard listener (its own thread). grab/exclusive is
        # not supported here (pynput's suppress=True swallows ALL keys
        # system-wide — too dangerous to wire by default).
        self._listener = keyboard.Listener(
            on_press=lambda key: emit(key, "down"),
            on_release=lambda key: emit(key, "up"),
        )
        self._listener.start()

    def stop(self) -> None:
        if self._listener is not None:
            try:
                self._listener.stop()  # SEAM
            except Exception:  # noqa: BLE001
                logger.exception("pynput listener stop raised")
            self._listener = None


class EvdevBackend(CaptureBackend):
    """Linux/RasPi capture via python-evdev (works under Wayland/headless)."""

    name = "evdev"

    def __init__(self) -> None:
        self._stop = threading.Event()
        self._open: List[Any] = []     # (device, grabbed) tuples
        self._threads: List[threading.Thread] = []
        self._mods = _fresh_mods()

    @staticmethod
    def available() -> bool:
        if not sys.platform.startswith("linux"):
            return False
        try:
            import evdev  # noqa: F401  # SEAM
            return True
        except Exception:  # noqa: BLE001
            return False

    def list_devices(self) -> List[Dict[str, Any]]:
        import evdev  # SEAM
        out: List[Dict[str, Any]] = []
        for path in evdev.list_devices():
            try:
                d = evdev.InputDevice(path)
                if evdev.ecodes.EV_KEY in d.capabilities():
                    out.append({"id": path, "name": d.name})
            except Exception:  # noqa: BLE001
                continue
        return out

    def start(self, on_event: EventCb, *, grab: bool = False,
              device_id: Optional[str] = None, scope: str = "global") -> None:
        import evdev  # SEAM
        self._stop.clear()
        self._mods = _fresh_mods()
        paths = [device_id] if device_id else [d["id"] for d in self.list_devices()]
        for path in paths:
            try:
                dev = evdev.InputDevice(path)  # SEAM
                if grab:
                    dev.grab()  # SEAM — exclusive: keys won't reach other apps
            except Exception as exc:  # noqa: BLE001
                logger.warning("evdev: cannot open %s: %s", path, exc)
                continue
            self._open.append((dev, grab))
            t = threading.Thread(target=self._read_loop, args=(dev, on_event), daemon=True)
            t.start()
            self._threads.append(t)
        if not self._open:
            raise RuntimeError(
                "no readable input devices (add your user to the 'input' group, or run as root)")

    def _read_loop(self, dev: Any, on_event: EventCb) -> None:
        from evdev import ecodes  # SEAM
        try:
            for event in dev.read_loop():  # SEAM — blocks; closing the dev ends it
                if self._stop.is_set():
                    break
                if event.type != ecodes.EV_KEY:
                    continue
                # value: 0=up, 1=down, 2=auto-repeat
                type_ = "up" if event.value == 0 else "down"
                repeat = event.value == 2
                name = ecodes.KEY.get(event.code, "")
                if isinstance(name, (list, tuple)):
                    name = name[0] if name else ""
                code, k = evdev_to_canonical(str(name))
                mod = MODIFIER_OF_CODE.get(code)
                if mod and not repeat:
                    self._mods[mod] = (event.value == 1)
                on_event({
                    "type": type_, "key": k, "code": code,
                    "modifiers": dict(self._mods), "repeat": repeat, "source": "local",
                })
        except OSError:
            pass  # device closed/removed — normal on stop()
        except Exception:  # noqa: BLE001
            logger.exception("evdev read loop crashed")

    def stop(self) -> None:
        self._stop.set()
        for dev, grabbed in self._open:
            try:
                if grabbed:
                    dev.ungrab()  # SEAM
                dev.close()       # SEAM — unblocks read_loop
            except Exception:  # noqa: BLE001
                pass
        self._open = []
        self._threads = []


_BACKENDS = {"evdev": EvdevBackend, "pynput": PynputBackend}


def select_backend(preferred: str = "auto") -> CaptureBackend:
    """Pick a capture backend. ``preferred`` in {auto, evdev, pynput}.
    Auto prefers evdev on Linux (Wayland/headless/grab), else pynput.
    Raises RuntimeError with an actionable message when nothing is usable."""
    if preferred in _BACKENDS:
        cls = _BACKENDS[preferred]
        if cls.available():
            return cls()
        raise RuntimeError(f"{preferred} backend not available on this platform/venv")
    if EvdevBackend.available():
        return EvdevBackend()
    if PynputBackend.available():
        return PynputBackend()
    raise RuntimeError(
        "no keyboard capture backend available — install 'evdev' (Linux) or 'pynput' (Win/macOS)")
