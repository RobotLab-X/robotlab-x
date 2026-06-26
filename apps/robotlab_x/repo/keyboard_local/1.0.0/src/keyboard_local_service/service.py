"""KeyboardLocalService — host keyboard, OS-capture half of the ``keyboard``
capability (Levels A/B).

Same control surface + published shape as keyboard_browser (inherited from
KeyboardServiceBase), but keys are captured from the OS via evdev (Linux/
RasPi — works under Wayland + headless, supports exclusive grab) or pynput
(Windows / macOS / X11), auto-selected. Events are published canonically on
``/keyboard/{id}/event`` and run through the same keymap (key→bus-action)
layer, so a teleop/brain consumer can't tell a host keyboard from a browser
one.

Extra control verbs over the browser half (host-specific):
    list_devices / select_device   (evdev input devices)
    set_grab                        (evdev exclusive grab — teleop)
    set_backend                     (auto | evdev | pynput)
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from pydantic import Field
from rlx_bus import service_method
from rlx_input import KeyboardConfig, KeyboardServiceBase

from .keyboard_capture import EvdevBackend, PynputBackend, select_backend

logger = logging.getLogger(__name__)


class KeyboardLocalConfig(KeyboardConfig):
    """Host-keyboard config — adds backend/device/grab to the shared base."""
    # Host capture defaults to system-wide; 'card'/'document' are browser
    # scopes. 'focused' is best-effort window-filtered (Phase 2+).
    scope: str = Field("global", description="Capture scope: 'global' (everywhere) or 'focused' (best-effort active-window filter).")
    backend: str = Field("auto", description="Capture backend: 'auto' | 'evdev' | 'pynput'.")
    device_id: Optional[str] = Field(
        None, description="evdev input-device path to capture (None = all keyboard devices).")
    grab: bool = Field(
        False, description="evdev exclusive grab — captured keys do NOT reach other apps (teleop). evdev only.")


class KeyboardLocalService(KeyboardServiceBase):
    config_class = KeyboardLocalConfig
    source = "local"

    def __init__(self, proxy_id, bus) -> None:
        super().__init__(proxy_id, bus)
        self._backend = None
        self._devices: List[Dict[str, Any]] = []

    # ─── lifecycle ────────────────────────────────────────────────────
    async def on_start(self) -> None:
        # Best-effort device enumeration for the UI before the base may
        # auto-start capture.
        try:
            self._devices = self._ensure_backend().list_devices()
        except Exception as exc:  # noqa: BLE001
            logger.warning("%s: backend init/enumerate failed: %s", self.proxy_id, exc)
            self._last_error = str(exc)
        await super().on_start()

    def _ensure_backend(self):
        if self._backend is None:
            self._backend = select_backend(self.config.backend)
        return self._backend

    # ─── capture hooks ────────────────────────────────────────────────
    async def _start_capture_backend(self) -> None:
        backend = self._ensure_backend()
        # Backend spawns its own capture thread(s) and hands events back via
        # the threadsafe emitter (publishes /event + runs the keymap).
        backend.start(
            self.emit_event_threadsafe,
            grab=bool(self.config.grab),
            device_id=self.config.device_id,
            scope=self.config.scope,
        )

    async def _stop_capture_backend(self) -> None:
        if self._backend is not None:
            self._backend.stop()

    async def _restart_capture(self) -> None:
        try:
            if self._backend is not None:
                self._backend.stop()
        except Exception:  # noqa: BLE001
            logger.exception("%s: backend stop during restart raised", self.proxy_id)
        await self._safe_start_capture()

    # ─── host-specific control ────────────────────────────────────────
    @service_method("list_devices", publishes=["state"])
    async def m_list_devices(self) -> Dict[str, Any]:
        try:
            self._devices = self._ensure_backend().list_devices()
            self._last_error = None
        except Exception as exc:  # noqa: BLE001
            self._devices = []
            self._last_error = str(exc)
        await self._publish_state()
        return {"devices": self._devices}

    @service_method("select_device", publishes=["state"])
    async def m_select_device(self, device_id: Optional[str] = None) -> Dict[str, Any]:
        await self.update_config({"device_id": device_id})
        if self._capturing:
            await self._restart_capture()
        await self._publish_state()
        return self._snapshot()

    @service_method("set_grab", publishes=["state"])
    async def m_set_grab(self, grab: bool = True) -> Dict[str, Any]:
        await self.update_config({"grab": bool(grab)})
        if self._capturing:
            await self._restart_capture()
        await self._publish_state()
        return self._snapshot()

    @service_method("set_backend", publishes=["state"])
    async def m_set_backend(self, backend: str = "auto") -> Dict[str, Any]:
        await self.update_config({"backend": str(backend)})
        was_capturing = self._capturing
        if was_capturing:
            await self.m_stop_capture()
        # Drop the current backend so the new choice is selected on next start.
        self._backend = None
        if was_capturing:
            await self._safe_start_capture()
        await self._publish_state()
        return self._snapshot()

    # ─── state ────────────────────────────────────────────────────────
    def _snapshot(self) -> Dict[str, Any]:
        snap = super()._snapshot()
        available = [n for n, cls in (("evdev", EvdevBackend), ("pynput", PynputBackend)) if cls.available()]
        snap.update({
            "backend": self._backend.name if self._backend is not None else self.config.backend,
            "device_id": self.config.device_id,
            "grab": self.config.grab,
            "devices": self._devices,
            "available_backends": available,
        })
        return snap
