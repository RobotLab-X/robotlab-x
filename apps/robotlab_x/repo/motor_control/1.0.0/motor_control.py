# unmanaged
"""MotorControlService — protocol-agnostic multi-motor commander.

The high-level, UI-facing counterpart to a ``motor_controller`` driver
(Sabertooth is the first one). Knows nothing about serial protocols or
specific hardware: it manages a set of *channels*, each bound to a
``(controller_type, controller_id, motor)`` triple, and publishes the
standardized motor_controller commands to that controller's control
topic. One MotorControlService can drive many channels across many
different motor_controllers at once — that's the whole point of the
abstraction.

motor_controller interface (what a controller must implement)
-------------------------------------------------------------
The controller's ``/{type}/{id}/control`` topic accepts:

  {"action": "motor_set",      "motor": int, "value": float}  # -1.0..+1.0
  {"action": "motor_stop",     "motor": int}
  {"action": "motor_stop_all"}

Sabertooth is the reference implementation (see
``repo/sabertooth/1.0.0/src/sabertooth_service/service.py``). Any
service declaring ``implements: [motor_controller]`` must accept these.

motor_control interface (what THIS service promotes)
----------------------------------------------------
This service declares ``implements: [motor_control]`` so a brain or any
other high-level surface can discover and drive it. Its control topic
accepts the actions defined by the @service_method handlers below
(add_channel / set / stop / stop_all / ...).

Input sources (live stream → channel target)
---------------------------------------------
A channel can additionally be driven by another service's telemetry
instead of the UI slider — e.g. a joystick axis. ``set_input`` binds a
``(topic, field, index, scale, offset, deadzone)`` source to a channel;
this service then subscribes to that topic, extracts
``payload[field][index]``, applies ``raw*scale + offset`` (with
deadzone), and feeds the result into the channel's *target*. The value
still passes through the channel's clamp / slew / invert / E-STOP path
before reaching the controller, so a streamed input inherits all the
motor safety. ``clear_input`` returns the channel to manual control.

Safety model
------------
Three layers, host + hardware:

  * Per-channel output clamp ``[min_output, max_output]`` — every value
    is clamped here before it leaves this service.
  * Per-channel slew-rate limiting — ``slew_rate`` (units/sec) caps how
    fast an output can change, so a step command ramps instead of
    snapping. 0 disables (instant).
  * A latching emergency stop — ``stop_all`` (the UI's big STOP button
    and the space/enter key) forces every output to 0 AND latches
    ``estopped`` so no further motion happens until ``clear_estop``.

The driver (e.g. Sabertooth) adds its own clamp + hardware serial
timeout on top.

Bus topics published
--------------------
  /motor_control/{id}/state    retained — channels + outputs + estop
  /motor_control/{id}/control  incoming actions

NOTE: deliberately NO ``from __future__ import annotations`` — the
config models use ``Optional[...]`` and Pydantic v2 resolves hints
against ``__module__`` at class-build time, which fails when this file
is loaded via importlib (the in-process adapter path) with
stringified annotations. Mirrors the same note in ``servo.py``.
"""
import asyncio
import logging
import time
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field
from rlx_bus import ServiceConfig
from robotlab_x.framework import Service, service_method


logger = logging.getLogger(__name__)

# Host-side ramp tick rate. 50 Hz matches the servo motion loop — fast
# enough for smooth ramps, slow enough not to flood the bus.
_TICK_HZ = 50.0
# Republish /state at a lower rate than the tick so the UI tracks live
# outputs without saturating subscribers at full tick speed.
_STATE_PUBLISH_EVERY_N_TICKS = 5
# Outputs closer than this to their target are snapped to it (avoids
# an endless asymptotic crawl from float math).
_EPS = 1e-4


class InputSource(BaseModel):
    """Live stream binding that drives a channel's target.

    Instead of (or in addition to) the UI slider, a channel can be
    driven by another service's published telemetry — e.g. a joystick
    axis. This service subscribes to ``topic``, reads ``field[index]``
    out of each message payload (the joystick publishes
    ``{axes:[...], buttons:[...], hats:[...], balls:[...]}``), applies a
    simple linear map ``value = raw*scale + offset`` (with an optional
    deadzone), and feeds the result into the channel's *target* — so it
    still goes through the channel's clamp / slew / invert / E-STOP
    safety path before reaching the controller.

    The map output is clamped into the channel's ``[min_output,
    max_output]`` window like any other set(), so a ``scale`` large
    enough to exceed that window simply saturates at the limit. For
    motor_control's normalized -1..+1 model a joystick axis maps 1:1
    with ``scale=1.0``; larger scales are for inputs whose raw range is
    smaller than the desired throttle range.
    """

    topic: str = Field(..., description="Bus topic to subscribe for input, e.g. '/joystick/joystick-1/input'.")
    field: str = Field("axes", description="Array field in the payload to read from (e.g. 'axes' or 'buttons').")
    index: int = Field(0, ge=0, description="Index into the array field — e.g. the axis number.")
    scale: float = Field(1.0, description="Linear scale applied to the raw value: out = raw*scale + offset.")
    offset: float = Field(0.0, description="Linear offset added after scaling.")
    deadzone: float = Field(0.0, ge=0.0, description="Raw values with abs < deadzone are treated as 0 (suppresses creep).")


class MotorChannel(BaseModel):
    """One controllable motor, bound to a motor_controller channel.

    ``id`` is a local, operator-facing label unique within this
    service (e.g. "left", "right", "lift"). The binding triple
    addresses the controller's control topic as
    ``/{controller_type}/{controller_id}/control`` with the standard
    motor_controller actions; ``motor`` is the channel index on that
    controller.
    """

    id: str = Field(..., description="Local label, unique within this service (e.g. 'left').")
    controller_type: Optional[str] = Field(None, description="Service type of the bound motor_controller, e.g. 'sabertooth'.")
    controller_id: Optional[str] = Field(None, description="Proxy id of the bound controller, e.g. 'sabertooth-1'.")
    motor: int = Field(1, ge=1, description="Motor channel index on the controller (1-based).")
    value: float = Field(0.0, ge=-1.0, le=1.0, description="Last commanded target throttle (-1..+1), persisted across restarts.")
    min_output: float = Field(-1.0, ge=-1.0, le=1.0, description="Safety clamp — lowest output ever sent to the controller.")
    max_output: float = Field(1.0, ge=-1.0, le=1.0, description="Safety clamp — highest output ever sent to the controller.")
    slew_rate: float = Field(0.0, ge=0.0, description="Max output change per second (units/sec). 0 = instant, no ramp limiting.")
    invert: bool = Field(False, description="Flip the sign of the output before it's sent (for motors wired backwards).")
    enabled: bool = Field(True, description="When False the channel is held at 0 and ignores set().")
    input_source: Optional[InputSource] = Field(None, description="Optional live input stream driving this channel's target. None = manual (UI slider / set).")


class MotorControlConfig(ServiceConfig):
    """Persisted config. ``channels`` is the full channel set; an empty
    list is the fresh-install state (operator adds channels via the
    UI). ``estopped`` is latched across restarts on purpose — if the
    operator hit E-STOP, a restart must not silently re-energise
    motors."""

    channels: List[MotorChannel] = Field(default_factory=list, description="Configured motor channels.")
    estopped: bool = Field(False, description="Latched emergency stop. When True every output is forced to 0 and set() is refused until clear_estop.")


class MotorControlService(Service):
    """In-process multi-motor commander. See module docstring for both
    the consumed motor_controller contract and the promoted
    motor_control contract."""

    config_class = MotorControlConfig
    publishes = ["state"]

    _tick_task: Optional[asyncio.Task] = None
    _controller_task: Optional[asyncio.Task] = None
    # Live output per channel id — the value actually being sent to the
    # controller this instant. Ramps toward the channel's target
    # ``value`` at ``slew_rate``. NOT persisted (rebuilt on start).
    _outputs: Dict[str, float] = {}
    # The last value we actually published to each controller, so the
    # tick loop only re-sends on change (steady state is silent — the
    # driver's own keepalive handles refresh).
    _last_sent: Dict[str, float] = {}
    # One subscription task per channel that has an input_source, keyed
    # by channel id. _input_topics records the topic each task is bound
    # to so _resync can detect a re-pointed source. Rebuilt on start.
    _input_tasks: Dict[str, asyncio.Task] = {}
    _input_topics: Dict[str, str] = {}

    # ─── lifecycle ───────────────────────────────────────────────────
    async def on_start(self) -> None:
        # Seed outputs from persisted targets so a restart resumes the
        # last commanded state — UNLESS latched-estopped, in which case
        # everything starts (and stays) at 0.
        self._outputs = {}
        self._last_sent = {}
        self._input_tasks = {}
        self._input_topics = {}
        for ch in self.config.channels:
            self._outputs[ch.id] = 0.0 if self.config.estopped else float(ch.value)
        await self._publish_state()
        self._tick_task = asyncio.create_task(self._tick_loop())
        self._controller_task = asyncio.create_task(self._control_loop())
        self._resync_input_subscriptions()

    async def on_stop(self) -> None:
        tasks = [self._tick_task, self._controller_task, *self._input_tasks.values()]
        for task in tasks:
            if task is not None and not task.done():
                task.cancel()
        await asyncio.gather(
            *(t for t in tasks if t is not None),
            return_exceptions=True,
        )
        self._input_tasks = {}
        self._input_topics = {}

    # ─── channel management ──────────────────────────────────────────
    @service_method("add_channel", publishes=["state"])
    async def m_add_channel(
        self,
        id: str,
        controller_type: Optional[str] = None,
        controller_id: Optional[str] = None,
        motor: int = 1,
        min_output: float = -1.0,
        max_output: float = 1.0,
        slew_rate: float = 0.0,
        invert: bool = False,
    ) -> Dict[str, Any]:
        """Add a channel (or replace one with the same id). The new
        channel starts at value 0."""
        if not id:
            raise ValueError("add_channel requires a non-empty id")
        lo, hi = self._order_limits(min_output, max_output)
        channel = MotorChannel(
            id=str(id),
            controller_type=controller_type,
            controller_id=controller_id,
            motor=int(motor),
            value=0.0,
            min_output=lo,
            max_output=hi,
            slew_rate=max(0.0, float(slew_rate)),
            invert=bool(invert),
            enabled=True,
        )
        channels = [c for c in self.config.channels if c.id != channel.id]
        channels.append(channel)
        self._persist_channels(channels)
        self._outputs[channel.id] = 0.0
        self._last_sent.pop(channel.id, None)
        await self._publish_state()
        return self._snapshot()

    @service_method("remove_channel", publishes=["state"])
    async def m_remove_channel(self, id: str) -> Dict[str, Any]:
        """Stop + unbind + drop a channel."""
        ch = self._find(id)
        if ch is not None:
            # Best-effort stop on the controller before we forget the
            # binding.
            await self._send_to_controller(ch, {"action": "motor_stop", "motor": ch.motor})
        channels = [c for c in self.config.channels if c.id != id]
        self._persist_channels(channels)
        self._outputs.pop(id, None)
        self._last_sent.pop(id, None)
        self._resync_input_subscriptions()
        await self._publish_state()
        return self._snapshot()

    @service_method("update_channel", publishes=["state"])
    async def m_update_channel(
        self,
        id: str,
        controller_type: Optional[str] = None,
        controller_id: Optional[str] = None,
        motor: Optional[int] = None,
        invert: Optional[bool] = None,
        enabled: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """Update a channel's binding / invert / enabled flags. Limits
        and slew have their own action (``set_limits``)."""
        ch = self._find(id)
        if ch is None:
            raise ValueError(f"no channel with id {id!r}")
        prev_binding = (ch.controller_type, ch.controller_id, ch.motor)
        if controller_type is not None:
            ch.controller_type = controller_type
        if controller_id is not None:
            ch.controller_id = controller_id
        if motor is not None:
            ch.motor = int(motor)
        if invert is not None:
            ch.invert = bool(invert)
        if enabled is not None:
            ch.enabled = bool(enabled)
        # If the binding moved, stop the OLD target so we don't orphan a
        # running motor on a controller we no longer command.
        new_binding = (ch.controller_type, ch.controller_id, ch.motor)
        if prev_binding != new_binding and prev_binding[1]:
            await self._send_raw(prev_binding[0], prev_binding[1],
                                 {"action": "motor_stop", "motor": prev_binding[2]})
        if not ch.enabled:
            self._outputs[ch.id] = 0.0
        self._persist_channels(self.config.channels)
        await self._publish_state()
        return self._snapshot()

    @service_method("set_limits", publishes=["state"])
    async def m_set_limits(
        self,
        id: str,
        min_output: Optional[float] = None,
        max_output: Optional[float] = None,
        slew_rate: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Adjust a channel's safety envelope. The target value is
        re-clamped into the new window immediately."""
        ch = self._find(id)
        if ch is None:
            raise ValueError(f"no channel with id {id!r}")
        lo, hi = self._order_limits(
            min_output if min_output is not None else ch.min_output,
            max_output if max_output is not None else ch.max_output,
        )
        ch.min_output = lo
        ch.max_output = hi
        if slew_rate is not None:
            ch.slew_rate = max(0.0, float(slew_rate))
        # Re-clamp the standing target into the new window.
        ch.value = self._clamp(ch, ch.value)
        self._persist_channels(self.config.channels)
        await self._publish_state()
        return self._snapshot()

    # ─── input-source binding ─────────────────────────────────────────
    @service_method("set_input", publishes=["state"])
    async def m_set_input(
        self,
        id: str,
        topic: str,
        field: str = "axes",
        index: int = 0,
        scale: float = 1.0,
        offset: float = 0.0,
        deadzone: float = 0.0,
    ) -> Dict[str, Any]:
        """Bind a live input stream to a channel's target. From now on,
        each message on ``topic`` sets the channel target to
        ``payload[field][index] * scale + offset`` (clamped to the
        channel's limit window, and still subject to slew + E-STOP). The
        UI slider becomes a read-only readout while a source is bound.
        Replaces any existing source on the channel."""
        ch = self._find(id)
        if ch is None:
            raise ValueError(f"no channel with id {id!r}")
        if not topic:
            raise ValueError("set_input requires a non-empty topic")
        ch.input_source = InputSource(
            topic=str(topic),
            field=str(field),
            index=int(index),
            scale=float(scale),
            offset=float(offset),
            deadzone=max(0.0, float(deadzone)),
        )
        self._persist_channels(self.config.channels)
        self._resync_input_subscriptions()
        await self._publish_state()
        return self._snapshot()

    @service_method("clear_input", publishes=["state"])
    async def m_clear_input(self, id: str) -> Dict[str, Any]:
        """Detach a channel's input stream and return it to manual
        (slider) control. The target is zeroed so the motor doesn't
        coast on the last streamed value."""
        ch = self._find(id)
        if ch is None:
            raise ValueError(f"no channel with id {id!r}")
        ch.input_source = None
        ch.value = 0.0
        self._persist_channels(self.config.channels)
        self._resync_input_subscriptions()
        await self._publish_state()
        return self._snapshot()

    # ─── motion ──────────────────────────────────────────────────────
    @service_method("set", publishes=["state"])
    async def m_set(self, id: str, value: float) -> Dict[str, Any]:
        """Command a channel to ``value`` (-1..+1). Clamped to the
        channel's [min_output, max_output] window. The actual output
        ramps toward it at ``slew_rate`` (or snaps if slew is 0). A
        latched E-STOP refuses the command."""
        if self.config.estopped:
            raise RuntimeError("E-STOPPED — call clear_estop before commanding motion")
        ch = self._find(id)
        if ch is None:
            raise ValueError(f"no channel with id {id!r}")
        if not ch.enabled:
            raise RuntimeError(f"channel {id!r} is disabled")
        ch.value = self._clamp(ch, float(value))
        self._persist_channels(self.config.channels)
        await self._publish_state()
        return {"id": ch.id, "target": ch.value, "output": self._outputs.get(ch.id, 0.0)}

    @service_method("stop", publishes=["state"])
    async def m_stop(self, id: str) -> Dict[str, Any]:
        """Stop one channel immediately (target + output → 0, ignoring
        slew) and send motor_stop to its controller."""
        ch = self._find(id)
        if ch is None:
            raise ValueError(f"no channel with id {id!r}")
        ch.value = 0.0
        self._outputs[ch.id] = 0.0
        self._persist_channels(self.config.channels)
        await self._send_to_controller(ch, {"action": "motor_stop", "motor": ch.motor})
        self._last_sent[ch.id] = 0.0
        await self._publish_state()
        return {"id": ch.id, "stopped": True}

    @service_method("stop_all", publishes=["state"])
    async def m_stop_all(self) -> Dict[str, Any]:
        """Emergency stop — force every output to 0, latch ``estopped``,
        and broadcast motor_stop_all to every distinct bound controller.
        This is the UI's big STOP button and the space/enter key.

        Latching is deliberate: after this, ``set`` is refused until
        ``clear_estop``. Slew is ignored — stopping is always instant."""
        for ch in self.config.channels:
            ch.value = 0.0
            self._outputs[ch.id] = 0.0
            self._last_sent[ch.id] = 0.0
        self.config = self.config.merge_dict({
            "channels": [c.model_dump() for c in self.config.channels],
            "estopped": True,
        })
        self.save_config()
        # One motor_stop_all per distinct controller (dedup so we don't
        # spam a controller hosting several channels).
        for ctype, cid in self._distinct_controllers():
            await self._send_raw(ctype, cid, {"action": "motor_stop_all"})
        await self._publish_state()
        return {"estopped": True}

    @service_method("clear_estop", publishes=["state"])
    async def m_clear_estop(self) -> Dict[str, Any]:
        """Release the latched emergency stop. Channels stay at 0 — the
        operator must command motion again deliberately."""
        self.config = self.config.merge_dict({"estopped": False})
        self.save_config()
        await self._publish_state()
        return {"estopped": False}

    # ─── internals ───────────────────────────────────────────────────
    def _find(self, id: str) -> Optional[MotorChannel]:
        for c in self.config.channels:
            if c.id == id:
                return c
        return None

    @staticmethod
    def _order_limits(lo: float, hi: float) -> tuple:
        """Clamp both bounds to [-1, 1] and ensure lo <= hi."""
        lo = max(-1.0, min(1.0, float(lo)))
        hi = max(-1.0, min(1.0, float(hi)))
        if lo > hi:
            lo, hi = hi, lo
        return lo, hi

    @staticmethod
    def _clamp(ch: MotorChannel, value: float) -> float:
        return max(ch.min_output, min(ch.max_output, float(value)))

    def _distinct_controllers(self) -> List[tuple]:
        seen = []
        for c in self.config.channels:
            if c.controller_type and c.controller_id:
                key = (c.controller_type, c.controller_id)
                if key not in seen:
                    seen.append(key)
        return seen

    def _persist_channels(self, channels: List[MotorChannel]) -> None:
        """Write the channel list back to config + persist. Goes
        through merge_dict so it re-validates against the schema."""
        self.config = self.config.merge_dict({
            "channels": [c.model_dump() for c in channels],
        })
        self.save_config()

    async def _send_to_controller(self, ch: MotorChannel, payload: Dict[str, Any]) -> None:
        await self._send_raw(ch.controller_type, ch.controller_id, payload)

    async def _send_raw(self, ctype: Optional[str], cid: Optional[str], payload: Dict[str, Any]) -> None:
        """Publish to a controller's /control topic. No-op (logged) if
        the channel is unbound."""
        if not ctype or not cid:
            logger.debug("motor_control %s: send dropped — channel unbound", self.proxy_id)
            return
        # Service.publish is synchronous on the in-process base.
        self.publish(f"/{ctype}/{cid}/control", payload)

    def _effective_output(self, ch: MotorChannel, output: float) -> float:
        """Apply invert just before the value leaves this service."""
        return -output if ch.invert else output

    async def _tick_loop(self) -> None:
        """Advance every channel's live output toward its target at the
        channel's slew rate, sending motor_set to the controller only
        when the (inverted) output actually changes.

        Single shared loop rather than per-channel tasks — simpler, and
        N motors on one robot want a coherent control frame anyway."""
        dt = 1.0 / _TICK_HZ
        frame = 0
        try:
            while True:
                await asyncio.sleep(dt)
                frame += 1
                changed = False
                for ch in self.config.channels:
                    target = 0.0 if (self.config.estopped or not ch.enabled) else ch.value
                    cur = self._outputs.get(ch.id, 0.0)
                    nxt = self._advance(cur, target, ch.slew_rate, dt)
                    if nxt != cur:
                        self._outputs[ch.id] = nxt
                    # Only emit on a real change in the value the
                    # controller would see (post-invert), so steady
                    # state is silent on the bus.
                    eff = self._effective_output(ch, nxt)
                    if self._last_sent.get(ch.id) != eff:
                        self._last_sent[ch.id] = eff
                        await self._send_to_controller(ch, {"action": "motor_set", "motor": ch.motor, "value": eff})
                        changed = True
                if changed or frame % _STATE_PUBLISH_EVERY_N_TICKS == 0:
                    await self._publish_state()
        except asyncio.CancelledError:
            pass

    @staticmethod
    def _advance(current: float, target: float, slew_rate: float, dt: float) -> float:
        """Move ``current`` toward ``target`` by at most ``slew_rate*dt``.
        slew_rate <= 0 means instant (snap to target)."""
        if slew_rate <= 0.0:
            return target
        step = slew_rate * dt
        delta = target - current
        if abs(delta) <= step + _EPS:
            return target
        return current + (step if delta > 0 else -step)

    # ─── input-source streaming ───────────────────────────────────────
    def _resync_input_subscriptions(self) -> None:
        """Reconcile the running subscription tasks with the channels'
        configured input sources. Cancels tasks for channels whose
        source was removed or re-pointed at a different topic, and starts
        a task for each newly-bound source. Idempotent — safe to call
        after any channel mutation."""
        desired = {
            c.id: c.input_source.topic
            for c in self.config.channels
            if c.input_source and c.input_source.topic
        }
        for cid, task in list(self._input_tasks.items()):
            if cid not in desired or self._input_topics.get(cid) != desired[cid] or task.done():
                task.cancel()
                self._input_tasks.pop(cid, None)
                self._input_topics.pop(cid, None)
        for cid, topic in desired.items():
            if cid not in self._input_tasks:
                self._input_tasks[cid] = asyncio.create_task(self._input_loop(cid, topic))
                self._input_topics[cid] = topic

    async def _input_loop(self, channel_id: str, topic: str) -> None:
        """Subscribe to one input source and drive its channel's target.
        The channel + map params are re-read each message so live edits
        to scale/index/offset take effect without resubscribing; only a
        topic change (handled by _resync) tears this task down."""
        try:
            async for msg in self.subscribe_iter(topic, subscriber_id=f"motor_control-{self.proxy_id}-input-{channel_id}"):
                if getattr(msg, "topic", None) == "__terminate__" or self.is_stopping():
                    break
                ch = self._find(channel_id)
                if ch is None or ch.input_source is None or ch.input_source.topic != topic:
                    break  # binding removed or re-pointed — this task is stale
                self._apply_input(ch, getattr(msg, "payload", None))
        except asyncio.CancelledError:
            pass

    def _apply_input(self, ch: MotorChannel, payload: Any) -> Optional[float]:
        """Compute and set ``ch``'s target from one input payload.
        Returns the new clamped target, or None if the message was
        ignored (estopped / disabled / unextractable). Updates the
        target IN MEMORY only — the value stream is too hot to persist
        per frame, and the next message overwrites it anyway."""
        if ch.input_source is None or self.config.estopped or not ch.enabled:
            return None
        raw = self._extract_input(ch.input_source, payload)
        if raw is None:
            return None
        ch.value = self._clamp(ch, raw)
        return ch.value

    @staticmethod
    def _extract_input(src: "InputSource", payload: Any) -> Optional[float]:
        """Pull ``payload[src.field][src.index]`` and apply the linear
        map (deadzone → scale → offset). Returns None when the payload
        doesn't carry the expected array/index (so a malformed or
        partial message is simply skipped, not fatal)."""
        if not isinstance(payload, dict):
            return None
        arr = payload.get(src.field)
        if not isinstance(arr, list) or src.index < 0 or src.index >= len(arr):
            return None
        try:
            raw = float(arr[src.index])
        except (TypeError, ValueError):
            return None
        if src.deadzone > 0.0 and abs(raw) < src.deadzone:
            raw = 0.0
        return raw * src.scale + src.offset

    def _snapshot(self) -> Dict[str, Any]:
        return {
            "estopped": bool(self.config.estopped),
            "channels": [
                {
                    "id": c.id,
                    "controller_type": c.controller_type,
                    "controller_id": c.controller_id,
                    "motor": c.motor,
                    "value": c.value,                       # commanded target
                    "output": round(self._outputs.get(c.id, 0.0), 4),  # live, post-slew
                    "min_output": c.min_output,
                    "max_output": c.max_output,
                    "slew_rate": c.slew_rate,
                    "invert": c.invert,
                    "enabled": c.enabled,
                    "bound": bool(c.controller_type and c.controller_id),
                    "input_source": c.input_source.model_dump() if c.input_source else None,
                }
                for c in self.config.channels
            ],
        }

    async def _publish_state(self) -> None:
        # Service.publish is synchronous on the in-process base.
        self.publish("state", self._snapshot(), retained=True)

    async def _control_loop(self) -> None:
        """Translate /control bus messages into @service_method calls
        via the framework's shared reply_to-aware dispatcher."""
        await self.run_control_loop()
