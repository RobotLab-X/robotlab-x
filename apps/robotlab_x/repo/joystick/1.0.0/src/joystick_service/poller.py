"""pygame-backed joystick poll thread for JoystickService.

pygame (SDL2 under the hood) owns the actual device I/O. SDL's event
pump + joystick reads want to live on a single, consistent thread, so —
exactly like the ``serial`` service's PortReader and ``sabertooth``'s
SerialLink — we run everything pygame on a daemon thread and shuttle
results back into the asyncio loop via ``run_coroutine_threadsafe``.

The service talks to the thread through a small command queue
(attach / detach / rescan / enabled / params / stop). The thread talks
back through four async callbacks:

  on_devices(list[dict])  — the full detected-device list (with counts)
  on_attached(dict|None)  — the currently-attached device's metadata
  on_input(dict)          — a live values snapshot (axes/buttons/hats/balls)
  on_error(str)           — a fatal/threaded error string

pygame is imported lazily inside ``_run`` so this module can be imported
(and its pure helpers unit-tested) in an environment without pygame.
"""
from __future__ import annotations

import logging
import os
import queue
import threading
import time
from typing import Any, Awaitable, Callable, Dict, List, Optional

import asyncio


# ─── pure helpers (no pygame) ─────────────────────────────────────────


def quantize_axis(value: float, deadzone: float, ndigits: int = 3) -> float:
    """Apply a deadzone + rounding to a raw axis value.

    Values whose magnitude is within ``deadzone`` collapse to 0.0 (kills
    resting-stick jitter); everything else is rounded to ``ndigits`` so
    sensor noise in the low bits doesn't spam the bus with
    indistinguishable updates.
    """
    if abs(value) < deadzone:
        return 0.0
    return round(float(value), ndigits)


def inputs_changed(prev: Optional[Dict[str, Any]], cur: Dict[str, Any]) -> bool:
    """True if a values snapshot differs from the previous one.

    Plain structural comparison — the snapshots hold only lists of
    numbers, so equality is the right and cheapest test. ``None`` prev
    (first read after attach) always counts as changed.
    """
    if prev is None:
        return True
    return (
        prev.get("axes") != cur.get("axes")
        or prev.get("buttons") != cur.get("buttons")
        or prev.get("hats") != cur.get("hats")
        or prev.get("balls") != cur.get("balls")
    )


# ─── poll thread ──────────────────────────────────────────────────────


AsyncCb = Callable[..., Awaitable[None]]


class Poller:
    """Owns the pygame joystick subsystem + the poll thread."""

    def __init__(
        self,
        *,
        on_devices: AsyncCb,
        on_attached: AsyncCb,
        on_input: AsyncCb,
        on_error: AsyncCb,
        poll_hz: int = 60,
        deadzone: float = 0.05,
        enabled: bool = True,
        scan_interval_s: float = 1.0,
        logger: Optional[logging.Logger] = None,
    ) -> None:
        self._on_devices = on_devices
        self._on_attached = on_attached
        self._on_input = on_input
        self._on_error = on_error
        self._poll_dt = 1.0 / max(1, int(poll_hz))
        self._deadzone = float(deadzone)
        self._enabled = bool(enabled)
        self._scan_interval = float(scan_interval_s)
        self._logger = logger or logging.getLogger(__name__)

        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._cmds: "queue.Queue[tuple]" = queue.Queue()

    # ─── lifecycle (called from the asyncio side) ────────────────────
    def start(self) -> None:
        if self._thread is not None:
            return
        self._loop = asyncio.get_running_loop()
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="joystick-poll", daemon=True)
        self._thread.start()

    async def stop(self) -> None:
        self._stop.set()
        thread = self._thread
        self._thread = None
        if thread is not None and thread.is_alive():
            await asyncio.to_thread(thread.join, 2.0)

    # ─── commands ────────────────────────────────────────────────────
    def attach(self, index: int) -> None:
        self._cmds.put(("attach", int(index)))

    def detach(self) -> None:
        self._cmds.put(("detach", None))

    def rescan(self) -> None:
        self._cmds.put(("rescan", None))

    def set_enabled(self, enabled: bool) -> None:
        self._cmds.put(("enabled", bool(enabled)))

    def set_params(self, poll_hz: Optional[int], deadzone: Optional[float]) -> None:
        self._cmds.put(("params", (poll_hz, deadzone)))

    # ─── dispatch back to the loop ───────────────────────────────────
    def _dispatch(self, coro: Awaitable[None]) -> None:
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        try:
            asyncio.run_coroutine_threadsafe(coro, loop)
        except Exception:  # noqa: BLE001
            self._logger.exception("joystick: dispatch to loop failed")

    # ─── thread body ─────────────────────────────────────────────────
    def _run(self) -> None:
        # Headless: SDL needs *a* video driver to pump events, but on a
        # server there's no display. The dummy driver lets the joystick
        # subsystem run without one. ``setdefault`` so an operator who
        # actually has a display can override it via the env.
        os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
        try:
            import pygame  # type: ignore
        except Exception as exc:  # noqa: BLE001
            self._dispatch(self._on_error(f"pygame import failed: {exc}"))
            return

        try:
            pygame.init()
            pygame.joystick.init()
        except Exception as exc:  # noqa: BLE001
            self._dispatch(self._on_error(f"pygame init failed: {exc}"))
            return

        attached: Any = None            # pygame.joystick.Joystick
        attached_meta: Optional[Dict[str, Any]] = None
        prev_inputs: Optional[Dict[str, Any]] = None
        last_count = -1
        last_scan = 0.0

        def _meta(js: Any, index: int) -> Dict[str, Any]:
            return {
                "index": index,
                "name": js.get_name(),
                "guid": _safe_guid(js),
                "num_axes": js.get_numaxes(),
                "num_buttons": js.get_numbuttons(),
                "num_hats": js.get_numhats(),
                "num_balls": js.get_numballs(),
            }

        def _enumerate() -> List[Dict[str, Any]]:
            out: List[Dict[str, Any]] = []
            for i in range(pygame.joystick.get_count()):
                try:
                    js = pygame.joystick.Joystick(i)
                    js.init()
                    out.append(_meta(js, i))
                except Exception:  # noqa: BLE001
                    self._logger.exception("joystick: enumerate index %d failed", i)
            return out

        try:
            while not self._stop.is_set():
                # ── drain commands ──────────────────────────────────
                while True:
                    try:
                        cmd, arg = self._cmds.get_nowait()
                    except queue.Empty:
                        break
                    if cmd == "attach":
                        attached, attached_meta, prev_inputs = self._do_attach(pygame, arg, attached)
                    elif cmd == "detach":
                        attached = self._do_detach(attached)
                        attached_meta = None
                        prev_inputs = None
                        self._dispatch(self._on_attached(None))
                    elif cmd == "rescan":
                        last_count = -1  # force re-enumerate below
                    elif cmd == "enabled":
                        self._enabled = bool(arg)
                    elif cmd == "params":
                        hz, dz = arg
                        if hz:
                            self._poll_dt = 1.0 / max(1, int(hz))
                        if dz is not None:
                            self._deadzone = float(dz)

                # ── pump SDL events (drives hotplug + value updates) ─
                pygame.event.pump()
                now = time.monotonic()

                # ── periodic device-list scan / hotplug ─────────────
                if now - last_scan >= self._scan_interval:
                    last_scan = now
                    count = pygame.joystick.get_count()
                    if count != last_count:
                        last_count = count
                        devices = _enumerate()
                        self._dispatch(self._on_devices(devices))
                        # Did our attached device disappear?
                        if attached_meta is not None:
                            still = any(d["guid"] == attached_meta["guid"] for d in devices)
                            if not still:
                                attached = self._do_detach(attached)
                                attached_meta = None
                                prev_inputs = None
                                self._dispatch(self._on_attached(None))
                                self._dispatch(self._on_error("attached device disconnected"))

                # ── read live values ────────────────────────────────
                if attached is not None and self._enabled:
                    snap = self._read(attached)
                    if inputs_changed(prev_inputs, snap):
                        prev_inputs = snap
                        self._dispatch(self._on_input(snap))

                time.sleep(self._poll_dt)
        except Exception as exc:  # noqa: BLE001
            self._logger.exception("joystick: poll loop crashed")
            self._dispatch(self._on_error(f"poll loop crashed: {exc}"))
        finally:
            try:
                pygame.quit()
            except Exception:  # noqa: BLE001
                pass

    # ─── thread-internal helpers ─────────────────────────────────────
    def _do_attach(self, pygame: Any, index: int, current: Any):
        """Open device ``index``; returns (joystick, meta, None)."""
        current = self._do_detach(current)
        try:
            js = pygame.joystick.Joystick(int(index))
            js.init()
            meta = {
                "index": int(index),
                "name": js.get_name(),
                "guid": _safe_guid(js),
                "num_axes": js.get_numaxes(),
                "num_buttons": js.get_numbuttons(),
                "num_hats": js.get_numhats(),
                "num_balls": js.get_numballs(),
            }
            self._dispatch(self._on_attached(meta))
            return js, meta, None
        except Exception as exc:  # noqa: BLE001
            self._logger.exception("joystick: attach index %d failed", index)
            self._dispatch(self._on_error(f"attach {index} failed: {exc}"))
            return None, None, None

    def _do_detach(self, current: Any) -> None:
        if current is not None:
            try:
                current.quit()
            except Exception:  # noqa: BLE001
                pass
        return None

    def _read(self, js: Any) -> Dict[str, Any]:
        """Read a full values snapshot from the attached device."""
        axes = [quantize_axis(js.get_axis(i), self._deadzone) for i in range(js.get_numaxes())]
        buttons = [int(js.get_button(i)) for i in range(js.get_numbuttons())]
        hats = [list(js.get_hat(i)) for i in range(js.get_numhats())]
        # get_ball returns relative motion (dx, dy) since the last pump.
        balls = [list(js.get_ball(i)) for i in range(js.get_numballs())]
        return {"axes": axes, "buttons": buttons, "hats": hats, "balls": balls, "ts": time.time()}


def _safe_guid(js: Any) -> str:
    """``get_guid`` exists in pygame 2.0+. Fall back to the instance id
    on older builds so the field is always populated."""
    try:
        return js.get_guid()
    except Exception:  # noqa: BLE001
        try:
            return f"iid:{js.get_instance_id()}"
        except Exception:  # noqa: BLE001
            return ""
