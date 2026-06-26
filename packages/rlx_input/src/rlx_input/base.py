"""Shared keyboard capability for robotlab_x.

One control surface + one published event shape so a browser-captured and a
host-captured keyboard are interchangeable to any consumer:

    start_capture / stop_capture / set_scope / set_suppress
    bind / unbind / set_bindings / clear_bindings        (the keymap layer)

``type_name`` is shared ("keyboard") so every keyboard publishes under
``/keyboard/...`` and consumers subscribe by capability, not concrete type.

Capture levels (see AGENTS.md "Capability interfaces"):
  * browser card / document  — keyboard_browser (this Phase): DOM keydown/keyup
    relayed up; zero OS permissions, works everywhere a browser does.
  * global / focused-window  — keyboard_local (Phase 2): evdev on Linux/RasPi
    (works under Wayland + headless), pynput on Windows/macOS.

The keymap layer turns keys into BUS ACTIONS — a binding publishes a chosen
message on key-down and (optionally) another on key-up, so holding W can drive
a motor and releasing it stops. ``stop_capture`` fires every binding's
``on_up`` as an all-stop safety so a robot can't be left driving.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, ClassVar, Dict, List, Optional

from pydantic import Field
from rlx_bus import ServiceConfig, SubprocessService, service_method

from .events import binding_matches, event_token, normalize_event

logger = logging.getLogger(__name__)


class KeyboardConfig(ServiceConfig):
    """Persisted config shared by every keyboard service type."""

    capturing: bool = Field(
        False, description="Desired capture state — set True on start_capture, re-applied on restart.")
    scope: str = Field(
        "card", description="Capture scope: 'card' (keys only while the service card is focused) or 'document' (whole browser tab). Host backends add 'global'/'focused' in Phase 2.")
    suppress: bool = Field(
        False, description="When True, captured keys are preventDefault'd so they don't also reach the page/canvas (teleop mode).")
    bindings: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Keymap: list of {id, combo, topic, on_down, on_up}. On a matching key event the bound message (on_down/on_up) is published to `topic`.")


class KeyboardServiceBase(SubprocessService):
    """Common control interface for a keyboard capture device."""

    config_class: ClassVar = KeyboardConfig
    publishes: ClassVar[List[str]] = ["state", "event"]
    type_name: ClassVar[str] = "keyboard"
    source: ClassVar[str] = "local"   # "local" host capture vs "browser"

    def __init__(self, proxy_id, bus) -> None:
        super().__init__(proxy_id, bus)
        self._capturing: bool = False
        self._pressed: set[str] = set()
        self._last_error: Optional[str] = None
        self._last_event: Optional[Dict[str, Any]] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    # ─── lifecycle ────────────────────────────────────────────────────
    async def on_start(self) -> None:
        self._loop = asyncio.get_running_loop()
        await self._publish_state()
        if self.config.capturing:
            await self._safe_start_capture()
            await self._publish_state()

    async def on_stop(self) -> None:
        try:
            await self._stop_capture_backend()
        except Exception:  # noqa: BLE001
            logger.exception("%s: stop capture on stop failed", self.proxy_id)
        # Safety: never leave a consumer (robot) driving after we go away.
        await self._release_all()

    # ─── transport hooks (subclasses implement) ───────────────────────
    async def _start_capture_backend(self) -> None:
        raise NotImplementedError

    async def _stop_capture_backend(self) -> None:
        raise NotImplementedError

    async def _on_scope_changed(self, scope: str) -> None:
        """Optional — subclasses react to a scope change."""

    async def _on_suppress_changed(self, suppress: bool) -> None:
        """Optional — subclasses react to a suppress toggle."""

    async def _safe_start_capture(self) -> None:
        try:
            await self._start_capture_backend()
            self._capturing = True
            self._last_error = None
        except Exception as exc:  # noqa: BLE001
            logger.exception("%s: start capture failed", self.proxy_id)
            self._capturing = False
            self._last_error = str(exc)

    # ─── control interface (the capability) ───────────────────────────
    @service_method("start_capture", publishes=["state"])
    async def m_start_capture(self) -> Dict[str, Any]:
        """Begin capturing keys (relayed to the browser / OS hook)."""
        await self.update_config({"capturing": True})
        await self._safe_start_capture()
        await self._publish_state()
        return self._snapshot()

    @service_method("stop_capture", publishes=["state"])
    async def m_stop_capture(self) -> Dict[str, Any]:
        """Stop capturing. Fires every binding's on_up as an all-stop."""
        await self.update_config({"capturing": False})
        try:
            await self._stop_capture_backend()
        except Exception as exc:  # noqa: BLE001
            logger.exception("%s: stop capture failed", self.proxy_id)
            self._last_error = str(exc)
        self._capturing = False
        await self._release_all()
        await self._publish_state()
        return self._snapshot()

    @service_method("set_scope", publishes=["state"])
    async def m_set_scope(self, scope: str = "card") -> Dict[str, Any]:
        await self.update_config({"scope": str(scope)})
        await self._on_scope_changed(str(scope))
        await self._publish_state()
        return self._snapshot()

    @service_method("set_suppress", publishes=["state"])
    async def m_set_suppress(self, suppress: bool = True) -> Dict[str, Any]:
        await self.update_config({"suppress": bool(suppress)})
        await self._on_suppress_changed(bool(suppress))
        await self._publish_state()
        return self._snapshot()

    # ─── keymap CRUD ──────────────────────────────────────────────────
    @service_method("bind", publishes=["state"])
    async def m_bind(
        self,
        combo: str,
        topic: str,
        id: Optional[str] = None,
        on_down: Optional[Dict[str, Any]] = None,
        on_up: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Add/replace a keymap binding. ``combo`` e.g. 'KeyW' or
        'ctrl+shift+KeyS'; ``on_down``/``on_up`` are the bus messages
        published to ``topic`` on key down/up."""
        binding = {"id": id or combo, "combo": combo, "topic": topic,
                   "on_down": on_down, "on_up": on_up}
        rest = [b for b in self.config.bindings if b.get("id") != binding["id"]]
        await self.update_config({"bindings": rest + [binding]})
        await self._publish_state()
        return binding

    @service_method("unbind", publishes=["state"])
    async def m_unbind(self, id: str) -> Dict[str, Any]:
        rest = [b for b in self.config.bindings if b.get("id") != id]
        await self.update_config({"bindings": rest})
        await self._publish_state()
        return {"removed": id}

    @service_method("set_bindings", publishes=["state"])
    async def m_set_bindings(self, bindings: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        await self.update_config({"bindings": list(bindings or [])})
        await self._publish_state()
        return {"bindings": self.config.bindings}

    @service_method("clear_bindings", publishes=["state"])
    async def m_clear_bindings(self) -> Dict[str, Any]:
        await self.update_config({"bindings": []})
        await self._publish_state()
        return {"cleared": True}

    # ─── event ingestion + keymap dispatch ────────────────────────────
    async def emit_event(self, raw: Dict[str, Any]) -> None:
        """Producer path (host backends): PUBLISH the canonical event to
        ``/keyboard/{id}/event`` for consumers, THEN ingest it locally
        (pressed-set + keymap). The browser half doesn't use this — the
        browser publishes /event itself and the relay only ``handle_event``s
        the tap, so /event is never double-published."""
        ev = normalize_event(raw)
        await self.publish("event", ev)
        await self.handle_event(ev)

    def emit_event_threadsafe(self, raw: Dict[str, Any]) -> None:
        """Hand a key event to the service loop from a capture thread
        (pynput's listener / evdev's read loop run their own threads).
        Mirrors rlx_audio's emit_pcm_threadsafe."""
        loop = self._loop
        if loop is None:
            return
        try:
            loop.call_soon_threadsafe(self._schedule_emit, raw)
        except RuntimeError:
            pass

    def _schedule_emit(self, raw: Dict[str, Any]) -> None:
        asyncio.create_task(self.emit_event(raw))

    async def handle_event(self, raw: Dict[str, Any]) -> None:
        """Ingest a canonical key event (from the browser /event tap, or a
        host backend). Tracks the pressed set + runs keymap dispatch. Does
        NOT re-publish /event — the producer already did."""
        if not isinstance(raw, dict):
            return
        ev = normalize_event(raw)
        self._last_event = ev
        token = event_token(ev)
        changed = False
        if ev["type"] == "down":
            if token and not ev["repeat"] and token not in self._pressed:
                self._pressed.add(token); changed = True
        else:
            if token in self._pressed:
                self._pressed.discard(token); changed = True
        await self._dispatch(ev)
        # Republish state on real (non-repeat) transitions so the UI's
        # pressed/last-key readout stays live without flooding on auto-repeat.
        if changed or not ev["repeat"]:
            await self._publish_state()

    async def _dispatch(self, ev: Dict[str, Any]) -> None:
        """Publish bound messages for every binding matching ``ev``. Auto-
        repeat is ignored so a held key fires the action once on press."""
        if ev.get("repeat"):
            return
        for b in self.config.bindings:
            if not binding_matches(ev, b):
                continue
            topic = b.get("topic")
            payload = b.get("on_down") if ev["type"] == "down" else b.get("on_up")
            if topic and payload is not None:
                try:
                    await self.bus.publish(topic, payload)
                except Exception:  # noqa: BLE001
                    logger.exception("%s: keymap publish to %s failed", self.proxy_id, topic)

    async def _release_all(self) -> None:
        """All-stop: publish every binding's on_up so nothing keeps running
        after capture ends / the service stops. Best-effort + idempotent."""
        for b in self.config.bindings:
            topic = b.get("topic")
            payload = b.get("on_up")
            if topic and payload is not None:
                try:
                    await self.bus.publish(topic, payload)
                except Exception:  # noqa: BLE001
                    logger.exception("%s: release_all publish to %s failed", self.proxy_id, topic)
        self._pressed.clear()

    # ─── state ────────────────────────────────────────────────────────
    def _snapshot(self) -> Dict[str, Any]:
        return {
            "capturing": self._capturing,
            "scope": self.config.scope,
            "suppress": self.config.suppress,
            "bindings": list(self.config.bindings),
            "pressed": sorted(self._pressed),
            "last_event": self._last_event,
            "source": type(self).source,
            "last_error": self._last_error,
        }

    async def _publish_state(self) -> None:
        await self.publish("state", self._snapshot(), retained=True)

    @property
    def last_event_ts(self) -> float:
        return float(self._last_event["ts"]) if self._last_event else 0.0
