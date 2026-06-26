"""JoystickService — cross-platform joystick / gamepad reader.

A subprocess service backed by pygame (SDL2). It enumerates the
host's joystick devices, attaches to one, and streams its live control
values — axes (analog), buttons (digital), hats (d-pads), and balls
(trackballs) — over the bus. Different controllers expose wildly
different component layouts, so the wire shape is fully dynamic: the
service publishes how many of each component the attached device has,
and the UI builds itself from that.

Subprocess service — SDL's event pump + blocking device reads live on
their own thread in their own process, isolated from the backend.

Wire contract
-------------
Topics published:

  /joystick/{id}/state    retained — slow-changing: device list, the
                          attached device's metadata + component counts,
                          enabled flag, params, last_error.
  /joystick/{id}/input    non-retained — fast: the live values snapshot
                          ``{axes:[...], buttons:[...], hats:[[x,y]...],
                          balls:[[dx,dy]...], ts}``. Published only when
                          a value changes (deadzone-filtered) so an idle
                          stick is silent on the bus.
  /joystick/{id}/control  incoming actions (below)
  /joystick/{id}/heartbeat 1Hz (auto, base class)

Actions accepted on /control:

  {"action": "list_devices"}
  {"action": "attach",      "index": 0}
  {"action": "detach"}
  {"action": "set_enabled", "enabled": true|false}
  {"action": "set_params",  "poll_hz": 60, "deadzone": 0.05}

``state`` and ``input`` are deliberately split: ``state`` is the
layout (republished rarely), ``input`` is the values (republished at
the poll rate, but only on change). The UI subscribes to both.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from pydantic import Field
from rlx_bus import ServiceConfig, SubprocessService, service_method

from .poller import Poller


logger = logging.getLogger(__name__)


# ─── config ──────────────────────────────────────────────────────────


class JoystickConfig(ServiceConfig):
    """Strongly-typed config — survives restarts so the UI replays the
    operator's last device + params. ``autoreconnect`` is the persisted
    *desired connection state*: it tracks whether a device was attached,
    so a controller that was attached is re-attached on the next start
    (and one explicitly detached stays detached)."""

    last_index: Optional[int] = Field(
        None, ge=0,
        description="Index of the last attached device. UI pre-selects it next session.",
    )
    last_guid: Optional[str] = Field(
        None,
        description="SDL GUID of the last attached device — stable across reconnects, unlike the index. Used to find the same controller again when autoreconnect is on.",
    )
    enabled: bool = Field(
        True,
        description="When False the device stays attached but value polling/streaming pauses (the UI's enable toggle).",
    )
    poll_hz: int = Field(
        60, ge=1, le=250,
        description="Value poll rate in Hz. 60 matches typical controller report rates; higher just burns CPU.",
    )
    deadzone: float = Field(
        0.05, ge=0.0, le=1.0,
        description="Axis deadzone — values within this magnitude of center read as 0, killing resting-stick jitter on the bus.",
    )
    autoreconnect: bool = Field(
        False,
        description="Desired connection state. Set True automatically when a device is attached, False on an explicit detach; on start the last device (by index) is re-attached when this is True. Defaults False so a fresh instance never grabs a guessed controller.",
    )


# ─── service ───────────────────────────────────────────────────────────


class JoystickService(SubprocessService):
    """Cross-platform joystick reader. See module docstring for the
    full wire contract."""

    type_name = "joystick"
    heartbeat_interval_s = 1.0
    config_class = JoystickConfig
    publishes = ["state", "input"]

    def __init__(self, proxy_id, bus) -> None:
        super().__init__(proxy_id, bus)
        self._poller: Optional[Poller] = None
        self._devices: List[Dict[str, Any]] = []
        self._device: Optional[Dict[str, Any]] = None     # attached device meta
        self._last_input: Optional[Dict[str, Any]] = None
        self._last_error: Optional[str] = None

    # ─── lifecycle ───────────────────────────────────────────────────
    async def on_start(self) -> None:
        self._ensure_poller()
        await self._publish_state()
        if self.config.autoreconnect and self.config.last_index is not None:
            self._poller.attach(int(self.config.last_index))

    async def on_stop(self) -> None:
        if self._poller is not None:
            await self._poller.stop()
            self._poller = None

    def _ensure_poller(self) -> Poller:
        """Create + start the poll thread once. Enumeration begins
        immediately so the device dropdown populates before any attach."""
        if self._poller is None:
            self._poller = Poller(
                on_devices=self._on_devices,
                on_attached=self._on_attached,
                on_input=self._on_input,
                on_error=self._on_error,
                poll_hz=self.config.poll_hz,
                deadzone=self.config.deadzone,
                enabled=self.config.enabled,
                logger=logger,
            )
            self._poller.start()
        return self._poller

    # ─── poller callbacks (run on the asyncio loop) ──────────────────
    async def _on_devices(self, devices: List[Dict[str, Any]]) -> None:
        self._devices = devices
        await self._publish_state()

    async def _on_attached(self, meta: Optional[Dict[str, Any]]) -> None:
        self._device = meta
        if meta is None:
            self._last_input = None
        else:
            self._last_error = None
            # Persist the device + the desired connection state so this
            # controller is re-attached on the next start.
            await self.update_config({
                "last_index": int(meta.get("index", 0)),
                "last_guid": meta.get("guid"),
                "autoreconnect": True,
            })
        await self._publish_state()

    async def _on_input(self, snap: Dict[str, Any]) -> None:
        self._last_input = snap
        try:
            await self.publish("input", snap, retained=False)
        except Exception:  # noqa: BLE001
            logger.exception("joystick %s: input publish failed", self.proxy_id)

    async def _on_error(self, message: str) -> None:
        self._last_error = message
        await self._publish_state()

    # ─── @service_method actions ─────────────────────────────────────
    @service_method("list_devices")
    async def m_list_devices(self) -> Dict[str, Any]:
        """Rescan + republish. Returns the current device list so a
        synchronous caller doesn't have to also subscribe to /state."""
        self._ensure_poller().rescan()
        return {"devices": self._devices}

    @service_method("attach", publishes=["state", "input"])
    async def m_attach(self, index: int) -> Dict[str, Any]:
        """Open device ``index`` and start streaming its values. The
        attached metadata + component counts arrive on /state shortly
        after via the poller callback."""
        self._ensure_poller().attach(int(index))
        return self._snapshot()

    @service_method("detach", publishes=["state"])
    async def m_detach(self) -> Dict[str, Any]:
        """Release the attached device. The device list keeps updating.
        Clears ``autoreconnect`` — an explicit detach means "stay
        detached on the next start". (An unexpected device drop does NOT
        clear it, so a controller that unplugs/replugs re-attaches.)"""
        await self.update_config({"autoreconnect": False})
        if self._poller is not None:
            self._poller.detach()
        return self._snapshot()

    @service_method("set_enabled", publishes=["state"])
    async def m_set_enabled(self, enabled: bool) -> Dict[str, Any]:
        """Pause/resume value streaming without detaching."""
        flag = bool(enabled)
        await self.update_config({"enabled": flag})
        if self._poller is not None:
            self._poller.set_enabled(flag)
        await self._publish_state()
        return {"enabled": flag}

    @service_method("set_params", publishes=["state"])
    async def m_set_params(
        self,
        poll_hz: Optional[int] = None,
        deadzone: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Live-tune the poll rate and/or axis deadzone."""
        updates: Dict[str, Any] = {}
        if poll_hz is not None:
            updates["poll_hz"] = max(1, min(250, int(poll_hz)))
        if deadzone is not None:
            updates["deadzone"] = max(0.0, min(1.0, float(deadzone)))
        if updates:
            await self.update_config(updates)
        if self._poller is not None:
            self._poller.set_params(updates.get("poll_hz"), updates.get("deadzone"))
        await self._publish_state()
        return self._snapshot()

    # ─── state ─────────────────────────────────────────────────────
    def _components(self) -> Dict[str, int]:
        d = self._device or {}
        return {
            "axes": int(d.get("num_axes", 0)),
            "buttons": int(d.get("num_buttons", 0)),
            "hats": int(d.get("num_hats", 0)),
            "balls": int(d.get("num_balls", 0)),
        }

    def _snapshot(self) -> Dict[str, Any]:
        return {
            "attached": self._device is not None,
            "enabled": self.config.enabled,
            "devices": self._devices,
            "device": self._device,
            "components": self._components(),
            "poll_hz": self.config.poll_hz,
            "deadzone": self.config.deadzone,
            "last_index": self.config.last_index,
            "autoreconnect": self.config.autoreconnect,
            "last_error": self._last_error,
        }

    async def _publish_state(self) -> None:
        await self.publish("state", self._snapshot(), retained=True)
