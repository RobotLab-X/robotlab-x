# unmanaged
"""ServoService — protocol-agnostic servo positioner.

Knows nothing about Arduino / Firmata / PCA9685 / etc. Stores three
things — which controller to talk to, which pin on it, and the current
angle — and publishes standardized commands to the controller's control
topic. The controller (whatever it is) translates those commands into
hardware writes.

Wire contract (what a servo_controller must implement)
-----------------------------------------------------
The controller's ``/{type}/{id}/control`` topic accepts:

  {"action": "servo_attach", "pin": int?, "servo_id": str}   # configure pin
  {"action": "servo_write",  "pin": int?, "angle": int, "servo_id": str}  # 0..180
  {"action": "servo_detach", "pin": int?, "servo_id": str}   # release the pin

Every message carries ``servo_id`` (the sending servo's proxy id).
``pin`` is for REAL controllers (Arduino → PWM pin). VIRTUAL controllers
(robot_kinematics / ik_solver) have no pins — they map the message to a
joint by ``servo_id`` via their calibration, so ``pin`` is omitted.

Multiple controllers: a servo may bind to SEVERAL controllers at once
(``config.controllers`` — real + virtual). One ``write`` fans out a
``servo_write`` to every binding, each with its own pin (or none).

Arduino is the reference REAL implementation (see
``repo/arduino/1.0.0/src/arduino_service/service.py``);
robot_kinematics / ik_solver are the reference VIRTUAL implementations.
Any service that declares ``implements: [servo_controller]`` in its package.yml
must accept these actions on its control topic.

Bus topics published by this service
------------------------------------
  /servo/{id}/state    retained — full snapshot of attach + angle
  /servo/{id}/control  incoming actions (attach/detach/write/sweep)

NOTE: This module deliberately does NOT use ``from __future__ import
annotations``. ServoConfig uses ``Optional[...]`` fields, and Pydantic
v2 resolves type hints against the class's ``__module__`` dict — which
fails when the module is loaded via importlib.util.spec_from_file_location
(the InProcessAdapter path) with future-style stringified annotations.
Keep annotations eager-evaluated in this file.
"""
import asyncio
import logging
import time
from typing import Any, Dict, Optional

from typing import List

from pydantic import BaseModel, Field, model_validator
from rlx_bus import ServiceConfig
from robotlab_x.framework import Service, service_method


logger = logging.getLogger(__name__)


DEFAULT_MIN = 0
DEFAULT_MAX = 180
DEFAULT_ANGLE = 90
DEFAULT_SPEED_DEG_PER_S = 90


class ControllerBinding(BaseModel):
    """One attachment of this servo to a ``servo_controller``.

    A servo may bind to SEVERAL controllers at once — e.g. a real
    ``arduino-1`` (drives a physical pin) AND a virtual
    ``robot_kinematics-1`` (drives a joint in the model) — so one
    ``write`` moves both simultaneously. The control topic is built as
    ``/{controller_type}/{controller_id}/control``.

    ``pin`` is the PWM pin for real controllers; virtual controllers
    (robot_kinematics / ik_solver) ignore it and map the incoming
    ``servo_write`` to a joint by the sending servo's id instead, so it
    is optional.
    """
    controller_type: str
    controller_id: str
    pin: Optional[int] = Field(None, ge=0)


class ServoConfig(ServiceConfig):
    """Strongly-typed config — survives restarts so the servo returns to
    the same controller + angle when the service comes back up.

    ``controller_type`` + ``controller_id`` are stored separately
    because the control topic is built as ``/{type}/{id}/control`` —
    both pieces are needed to address the controller. They're optional:
    a freshly-created servo service has no attachment until the user
    picks one.

    Speed-control design (changed 2026-06-07): a dedicated
    ``speed_control_enabled`` master switch decides whether writes
    interpolate. ``speed_deg_per_s`` is ALWAYS interpreted as a real
    movement rate (≥1). The earlier overload of ``speed_deg_per_s=0``
    to mean "disable interpolation" was footgun-prone — a user trying
    to dial speed down to "very slow" would silently land on
    instant-snap behaviour, which is dangerous on a robot that's
    already mid-motion. The two concepts are now separate fields.
    Persisted configs with ``speed_deg_per_s=0`` migrate to
    ``(speed_control_enabled=False, speed_deg_per_s=DEFAULT_SPEED_DEG_PER_S)``
    via the validator below.
    """

    # ``controllers`` is the source of truth for fan-out: a write is
    # sent to EVERY binding here (real + virtual). The legacy single
    # ``controller_type`` / ``controller_id`` / ``pin`` fields are kept
    # mirrored to ``controllers[0]`` for back-compat (UI, topology
    # template, older readers) and folded into ``controllers`` on load
    # by the migration validator below.
    controllers: List[ControllerBinding] = Field(
        default_factory=list,
        description="All controllers this servo drives. One write fans out to every binding.",
    )
    controller_type: Optional[str] = Field(None, description="(legacy, mirrors controllers[0]) Service type of the primary controller, e.g. 'arduino'.")
    controller_id: Optional[str] = Field(None, description="(legacy, mirrors controllers[0]) Proxy id of the primary controller, e.g. 'arduino-1'.")
    pin: Optional[int] = Field(None, ge=0, description="(legacy, mirrors controllers[0]) Pin of the primary controller.")
    attached: bool = Field(
        True,
        description=(
            "Operator-intent flag for the attachment. ``True`` (default) "
            "means on_start should re-issue ``servo_attach`` to the "
            "controller if controller_type/id/pin are set. Toggled to "
            "``False`` by ``m_detach`` — the controller fields STAY set "
            "so a subsequent ``attach()`` with no args resumes the same "
            "binding. Lets the UI offer Detach as a toggle without "
            "losing the operator's controller choice."
        ),
    )
    angle: int = Field(DEFAULT_ANGLE, ge=DEFAULT_MIN, le=DEFAULT_MAX, description="Last commanded angle (0..180)")
    min_angle: int = Field(DEFAULT_MIN, ge=0, le=180, description="Soft lower bound for write()")
    max_angle: int = Field(DEFAULT_MAX, ge=0, le=180, description="Soft upper bound for write()")
    speed_control_enabled: bool = Field(
        True,
        description=(
            "Master switch for speed-controlled (interpolated) motion. "
            "When False, every write is an instant single-packet "
            "servo_write — the controller commands the new angle and "
            "the hardware snaps to it at its physical maximum rate. "
            "When True, writes interpolate from the current angle to "
            "the target at ``speed_deg_per_s`` (host-side, ~50Hz)."
        ),
    )
    speed_deg_per_s: int = Field(
        DEFAULT_SPEED_DEG_PER_S, ge=1, le=360,
        description=(
            "Motion speed in degrees per second when ``speed_control_enabled`` "
            "is True. Minimum is 1 deg/s; use ``speed_control_enabled=False`` "
            "to turn interpolation off entirely. ``write()`` accepts a "
            "per-call override that wins over this field."
        ),
    )

    @model_validator(mode="before")
    @classmethod
    def _migrate_legacy_speed_zero(cls, data: Any) -> Any:
        """Pre-validation migration for configs persisted under the
        old contract where ``speed_deg_per_s=0`` meant "instant".

        Without this hook the new ``ge=1`` constraint on
        ``speed_deg_per_s`` would reject every existing servo's saved
        config and the service would fail to construct. Translates the
        legacy zero into the new explicit pair
        ``(speed_control_enabled=False, speed_deg_per_s=DEFAULT)`` so
        every existing instance picks up the safer semantics on first
        load. New configs (default ``speed_deg_per_s=90``) are
        untouched.
        """
        if isinstance(data, dict) and data.get("speed_deg_per_s") == 0:
            data = dict(data)
            data["speed_deg_per_s"] = DEFAULT_SPEED_DEG_PER_S
            data.setdefault("speed_control_enabled", False)
            logger.info(
                "servo: migrated legacy speed_deg_per_s=0 → "
                "speed_control_enabled=False, speed_deg_per_s=%d",
                DEFAULT_SPEED_DEG_PER_S,
            )
        # Fold a legacy single-controller config into the ``controllers``
        # list so existing servos keep working under the multi-controller
        # model. Only when no ``controllers`` were given explicitly.
        if isinstance(data, dict) and not data.get("controllers"):
            ctype, cid = data.get("controller_type"), data.get("controller_id")
            if ctype and cid:
                data = dict(data)
                data["controllers"] = [{
                    "controller_type": ctype,
                    "controller_id": cid,
                    "pin": data.get("pin"),
                }]
        return data


class ServoService(Service):
    """In-process servo positioner. See module docstring for the wire
    contract any servo_controller must implement."""

    config_class = ServoConfig
    # Always-on topics declared at the class level. The Composer's
    # Topics tab and the Topology page read this so the user can see
    # what this service-type emits without running an instance.
    publishes = ["state", "motion_events"]

    # Class-level defaults so methods can read these before on_start
    # has run (e.g. detach() called on a never-started instance, or
    # tests that drive @service_method handlers without on_start).
    _controller_task: Optional[asyncio.Task] = None
    _sweep_task: Optional[asyncio.Task] = None
    # In-memory motion state — NOT persisted. The motion task drives
    # _current_angle each frame; ``_moving`` flips true between start
    # and completion. After motion completes, _current_angle ==
    # config.angle.
    _motion_task: Optional[asyncio.Task] = None
    _current_angle: Optional[int] = None
    _moving: bool = False
    # Cooperative stop flag for the sweep loop. Set True from
    # m_stop_sweep (or m_write / m_stop) to ask sweep_loop to exit at
    # its next checkpoint, paired with a motion cancel that breaks the
    # current leg's sleep. Replaces task.cancel() — chasing cancelled
    # awaits through nested except-handlers turned out to deadlock
    # ("simpler holistic clean solutions first").
    _sweep_stop: bool = False

    # Motion-loop frame rate. 50 Hz matches the Arduino Servo library's
    # underlying PWM update rate — sending more often just wastes
    # bus packets without making the servo motion any smoother.
    _MOTION_FRAME_HZ = 50.0
    # How often to republish /state during motion. Lower than the
    # control-frame rate so the UI sees a live position without
    # flooding subscribers at full speed.
    _STATE_PUBLISH_EVERY_N_FRAMES = 5

    # Dead-reckoning assumption for instant single writes (no
    # interpolation, no operator-set rate). Typical hobby servos
    # (HiTec/Tower Pro, etc.) clear 60° in ~0.17s without load —
    # i.e. ~360 deg/sec. We use this only to estimate the
    # ``motion_events`` "ended" timing when the host-side loop has
    # no other rate to work with; the hardware moves at its own
    # physical max either way.
    _INSTANT_TYPICAL_DEG_PER_S = 360.0

    # ─── lifecycle ───────────────────────────────────────────────────
    async def on_start(self) -> None:
        # Best-effort: assume the servo's physical position equals the
        # last-commanded angle. There's no way to read back from a
        # passive servo via Firmata, so this is the cleanest seed.
        self._current_angle = self.config.angle
        await self._publish_state()
        # If config has a controller + pin from a previous session AND
        # the operator hasn't toggled Detach, re-issue servo_attach so
        # the controller knows to configure the pin again (the
        # controller may have restarted independently and forgotten).
        # ``attached=False`` means the operator deliberately detached
        # — leave the pin unconfigured until they toggle back.
        if self.config.attached and self.config.controllers:
            # Fan out servo_attach to every bound controller (each gets
            # its own pin; virtual controllers get none).
            await self._send_to_controller({"action": "servo_attach"})
        self._controller_task = asyncio.create_task(self._control_loop())

    async def on_stop(self) -> None:
        for task in (self._controller_task, self._sweep_task, self._motion_task):
            if task is not None and not task.done():
                task.cancel()
        await asyncio.gather(
            *(t for t in (self._controller_task, self._sweep_task, self._motion_task) if t is not None),
            return_exceptions=True,
        )

    # ─── @service_method actions ─────────────────────────────────────
    @service_method("attach", publishes=["state", "/{controller_type}/{controller_id}/control"])
    async def m_attach(
        self,
        controller_type: Optional[str] = None,
        controller_id: Optional[str] = None,
        pin: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Bind to a controller — real (Arduino → pin) OR virtual
        (robot_kinematics / ik_solver → joint). A servo may hold SEVERAL
        bindings at once; ``attach`` ADDS one (re-binding the same
        controller updates its pin).

        Idioms:
          * ``attach(controller_type="arduino", controller_id="arduino-1", pin=9)``
            — add a real binding on pin 9.
          * ``attach(controller_type="robot_kinematics", controller_id="robot_kinematics-1")``
            — add a virtual binding (no pin; the controller maps this
            servo to a joint via its calibration).
          * ``attach()`` with no args — resume (re-attach) all existing
            bindings (Basic view's Detach/Attach toggle).
        """
        # No args → resume all existing bindings.
        if controller_type is None and controller_id is None and pin is None:
            if not self.config.controllers:
                raise ValueError(
                    "attach requires controller_type + controller_id (+ pin for "
                    "real controllers) — nothing is configured to resume"
                )
            self.config = self.config.merge_dict({"attached": True})
            self.save_config()
            await self._send_to_controller({"action": "servo_attach"})
            await self._send_to_controller({"action": "servo_write", "angle": int(self.config.angle)})
            await self._publish_state()
            return self._snapshot()

        if not controller_type or not controller_id:
            raise ValueError("attach requires both controller_type and controller_id")
        rpin = int(pin) if pin is not None else None
        ctype, cid = str(controller_type), str(controller_id)
        # Add or update the binding for this (type, id).
        bindings = [
            b for b in self.config.controllers
            if not (b.controller_type == ctype and b.controller_id == cid)
        ]
        bindings.append(ControllerBinding(controller_type=ctype, controller_id=cid, pin=rpin))
        self.config = self.config.merge_dict({
            "controllers": [b.model_dump() for b in bindings],
            "attached": True,
        })
        self._mirror_legacy()
        self.save_config()
        # Attach + replay the current angle to THIS controller only.
        apayload: Dict[str, Any] = {"action": "servo_attach"}
        wpayload: Dict[str, Any] = {"action": "servo_write", "angle": int(self.config.angle)}
        if rpin is not None:
            apayload["pin"] = rpin
            wpayload["pin"] = rpin
        await self._send_to_controller(apayload, controller_type=ctype, controller_id=cid)
        await self._send_to_controller(wpayload, controller_type=ctype, controller_id=cid)
        await self._publish_state()
        return self._snapshot()

    @service_method("detach", publishes=["state", "/{controller_type}/{controller_id}/control"])
    async def m_detach(
        self,
        controller_type: Optional[str] = None,
        controller_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Detach a controller. With ``controller_type`` +
        ``controller_id`` given, REMOVE just that binding (and tell it to
        release the pin). With no args, mark ALL bindings detached
        (intent flag off) while keeping them for a later no-arg
        ``attach()`` resume — the Basic view's single-button toggle.
        """
        if controller_type and controller_id:
            ctype, cid = str(controller_type), str(controller_id)
            target = next(
                (b for b in self.config.controllers
                 if b.controller_type == ctype and b.controller_id == cid),
                None,
            )
            if target is not None:
                dp: Dict[str, Any] = {"action": "servo_detach"}
                if target.pin is not None:
                    dp["pin"] = int(target.pin)
                await self._send_to_controller(dp, controller_type=ctype, controller_id=cid)
            remaining = [
                b for b in self.config.controllers
                if not (b.controller_type == ctype and b.controller_id == cid)
            ]
            self.config = self.config.merge_dict({"controllers": [b.model_dump() for b in remaining]})
            self._mirror_legacy()
            self.save_config()
            await self._publish_state()
            return self._snapshot()
        # No args → detach all (keep bindings for resume).
        if self.config.controllers:
            await self._send_to_controller({"action": "servo_detach"})
        self.config = self.config.merge_dict({"attached": False})
        self.save_config()
        await self._publish_state()
        return self._snapshot()

    @service_method("write", publishes=["state", "/{controller_type}/{controller_id}/control"])
    async def m_write(self, angle: int, speed: Optional[int] = None) -> Dict[str, Any]:
        """Drive the servo to ``angle`` degrees, clamped to [min_angle, max_angle].

        Two paths depending on the speed-control master switch:

          * ``config.speed_control_enabled = False`` → single
            ``servo_write`` packet, hardware snaps to the target at
            its own physical max rate. No interpolation, no host loop.
          * ``config.speed_control_enabled = True`` → interpolate from
            the current angle to the target at the configured rate
            (or the per-call ``speed`` override if given).

        Per-call ``speed`` override:
          * None (default) → defer to ``config.speed_deg_per_s``
          * N ≥ 1          → force interpolation at N deg/s, even when
                             ``speed_control_enabled`` is False (lets
                             a single call request a smooth move
                             without flipping the config switch)
          * 0              → REJECTED. A speed of 0 used to mean
                             "instant"; now use
                             ``speed_control_enabled=False`` for that.
                             The old overload silently turned
                             "go slower" tweaks into "snap there now"
                             which is dangerous.

        An in-flight motion or sweep is cancelled before a new write
        so back-to-back writes always reach the latest target.
        """
        if not self.config.controllers:
            raise RuntimeError("servo is not attached — call attach() first")
        if speed is not None:
            speed = int(speed)
            if speed == 0:
                raise ValueError(
                    "speed=0 is no longer valid (used to mean 'instant'). "
                    "For an instant write, call set_speed_control_enabled(False) "
                    "first; for a slow move, pass speed >= 1."
                )
            if speed < 0:
                raise ValueError(f"speed must be >= 1 (got {speed})")
        target = max(self.config.min_angle, min(self.config.max_angle, int(angle)))
        # Cancel any in-flight motion AND sweep before re-targeting.
        # Otherwise two overlapping motion tasks fight over servo_write
        # frames, and an active sweep would immediately re-target away
        # from the user's intended angle on its next leg.
        await self._cancel_sweep()
        await self._cancel_motion()
        self.config = self.config.merge_dict({"angle": target})
        self.save_config()
        # Decide effective speed + interpolation mode:
        #   * per-call override (any non-zero ``speed`` arg) → always
        #     interpolate at that rate, even when the master switch
        #     is off. Lets a one-off "smooth move" coexist with a
        #     config'd instant-mode servo.
        #   * config says interpolated → interpolate at config rate.
        #   * config says instant → spawn motion_task anyway, but
        #     dead-reckon the typical hobby-servo speed
        #     (_INSTANT_TYPICAL_DEG_PER_S) so motion_events fires a
        #     reasonable "ended" timing. The hardware still snaps;
        #     the host loop just sleeps the estimated movement time
        #     so consumers see a plausible motion lifecycle.
        if speed is not None:
            effective_speed = int(speed)
            interpolated = True
        elif self.config.speed_control_enabled:
            effective_speed = int(self.config.speed_deg_per_s)
            interpolated = True
        else:
            effective_speed = int(self._INSTANT_TYPICAL_DEG_PER_S)
            interpolated = False
        start_angle = self._current_angle if self._current_angle is not None else target
        self._moving = True
        await self._publish_state()
        self._motion_task = asyncio.create_task(
            self._motion_loop(
                int(start_angle), target, effective_speed,
                interpolated=interpolated, source="write",
            )
        )
        return {
            "angle": target,
            "moving": True,
            "from": int(start_angle),
            "speed_deg_per_s": effective_speed,
            "interpolated": interpolated,
        }

    @service_method("set_speed", publishes=["state"])
    async def m_set_speed(self, speed_deg_per_s: int) -> Dict[str, Any]:
        """Set the default motion speed (deg/s) for subsequent
        interpolated writes. Minimum is 1; use
        ``set_speed_control_enabled(False)`` to turn interpolation off.

        Values <1 are rejected (the historical 0=instant overload is
        gone; see m_write for the new contract)."""
        speed = int(speed_deg_per_s)
        if speed < 1:
            raise ValueError(
                "speed_deg_per_s must be >= 1. Use "
                "set_speed_control_enabled(False) to disable interpolation."
            )
        speed = min(360, speed)
        self.config = self.config.merge_dict({"speed_deg_per_s": speed})
        self.save_config()
        await self._publish_state()
        return {"speed_deg_per_s": speed}

    @service_method("set_speed_control_enabled", publishes=["state"])
    async def m_set_speed_control_enabled(self, enabled: bool) -> Dict[str, Any]:
        """Master switch for interpolated motion.

        ``True``  → writes interpolate at ``speed_deg_per_s`` (default)
        ``False`` → writes are instant single-packet servo_writes

        This is the replacement for the old "set speed=0 to disable
        interpolation" pattern, which was easy to trip into accidentally
        when scrubbing a speed slider toward zero."""
        flag = bool(enabled)
        self.config = self.config.merge_dict({"speed_control_enabled": flag})
        self.save_config()
        await self._publish_state()
        return {"speed_control_enabled": flag}

    @service_method("stop")
    async def m_stop(self) -> Dict[str, Any]:
        """Halt any in-flight motion (or sweep) at the current
        intermediate angle. Acts as an emergency stop + lets you
        abandon a too-slow move."""
        was_moving = self._moving
        await self._cancel_sweep()
        await self._cancel_motion()
        # Lock in the position we actually reached so a subsequent
        # write starts from the right place. If we never moved, this
        # is a no-op.
        if self._current_angle is not None:
            self.config = self.config.merge_dict({"angle": int(self._current_angle)})
            self.save_config()
        await self._publish_state()
        return {"stopped": was_moving, "angle": self._current_angle}

    @service_method("set_limits", publishes=["state"])
    async def m_set_limits(self, min_angle: int, max_angle: int) -> Dict[str, Any]:
        """Adjust the soft min/max angle envelope. Existing angle is re-clamped."""
        lo = max(0, min(180, int(min_angle)))
        hi = max(0, min(180, int(max_angle)))
        if lo > hi:
            lo, hi = hi, lo
        clamped = max(lo, min(hi, int(self.config.angle)))
        self.config = self.config.merge_dict({
            "min_angle": lo,
            "max_angle": hi,
            "angle": clamped,
        })
        self.save_config()
        await self._publish_state()
        return {"min_angle": lo, "max_angle": hi, "angle": clamped}

    @service_method("sweep")
    async def m_sweep(self, start: int, end: int) -> Dict[str, Any]:
        """Bounce the servo between ``start`` and ``end`` forever using
        the configured ``speed_deg_per_s``. Each leg drives the standard
        motion loop end-to-end before the direction reverses.

        There's no ``step`` / ``delay_ms``: speed already defines the
        rate. Previously sweep had its own outer pulse on top of the
        per-write motion loop, and the two interpolators fought —
        every sweep step cancelled the prior in-flight motion before
        it finished. One rate, one loop.

        ``stop_sweep`` cancels both the sweep AND any in-flight motion
        so the servo halts where it is.
        """
        if not self.config.controllers:
            raise RuntimeError("servo is not attached")
        # Sweep works in BOTH speed-control modes:
        #   * interpolated → each leg ramps from one endpoint to the
        #     other at ``speed_deg_per_s``, ~50Hz
        #   * instant      → each leg snaps to the endpoint then dwells
        #     for the same abstract leg time
        #     (``abs(distance)/speed_deg_per_s``) before reversing
        # Same ``speed_deg_per_s`` paces both — only the trajectory
        # changes. ``speed_deg_per_s`` is always ≥1 under the new
        # contract so there's no degenerate tight-loop case to guard
        # against here.
        # Cancel any in-flight sweep AND motion — the new sweep owns
        # the motion task from here.
        await self._cancel_sweep()
        await self._cancel_motion()
        self._sweep_stop = False
        self._sweep_task = asyncio.create_task(self._sweep_loop(int(start), int(end)))
        await self._publish_state()
        return {"sweeping": True, "start": int(start), "end": int(end)}

    @service_method("stop_sweep")
    async def m_stop_sweep(self) -> Dict[str, Any]:
        """Stop a running sweep and halt motion at the current angle.
        Idempotent — calling when no sweep is active is a no-op."""
        active = self._sweep_task is not None and not self._sweep_task.done()
        await self._cancel_sweep()
        await self._cancel_motion()
        if self._current_angle is not None:
            self.config = self.config.merge_dict({"angle": int(self._current_angle)})
            self.save_config()
        await self._publish_state()
        return {"stopped": active, "angle": self._current_angle}

    # ─── internals ───────────────────────────────────────────────────
    def _mirror_legacy(self) -> None:
        """Keep the legacy single ``controller_type``/``controller_id``/
        ``pin`` fields pointing at ``controllers[0]`` so back-compat
        readers (UI, topology template, older code) stay correct."""
        b = self.config.controllers[0] if self.config.controllers else None
        self.config = self.config.merge_dict({
            "controller_type": b.controller_type if b else None,
            "controller_id": b.controller_id if b else None,
            "pin": b.pin if b else None,
        })

    def _snapshot(self) -> Dict[str, Any]:
        cur = self._current_angle if self._current_angle is not None else self.config.angle
        return {
            "controllers": [b.model_dump() for b in self.config.controllers],
            "controller_type": self.config.controller_type,
            "controller_id": self.config.controller_id,
            "pin": self.config.pin,
            "angle": self.config.angle,
            "current_angle": int(cur),
            "moving": bool(self._moving),
            "sweeping": bool(self._sweep_task is not None and not self._sweep_task.done()),
            "speed_control_enabled": bool(self.config.speed_control_enabled),
            "speed_deg_per_s": self.config.speed_deg_per_s,
            "min_angle": self.config.min_angle,
            "max_angle": self.config.max_angle,
            # ``attached`` = operator intent AND the config is sufficient
            # to act on it. The Basic view's toggle reads this; a servo
            # that's been detached but still has its controller config
            # reports attached=False AND emits controller_id/pin so the
            # UI can offer a no-arg re-attach.
            "attached": bool(self.config.attached and self.config.controllers),
        }

    async def _cancel_motion(self) -> None:
        """Cancel + wait for the in-flight motion task. Idempotent."""
        if self._motion_task is not None and not self._motion_task.done():
            self._motion_task.cancel()
            try:
                await self._motion_task
            except asyncio.CancelledError:
                pass
        self._motion_task = None
        self._moving = False

    async def _cancel_sweep(self) -> None:
        """Ask the sweep loop to exit and wait for it. Idempotent.

        Cooperative: sets ``_sweep_stop`` so the loop sees the request
        at its next checkpoint, and cancels the in-flight motion to
        break the current leg's sleep. Then awaits the task's natural
        completion — no exception handling, no cancellation cascade.
        """
        task = self._sweep_task
        if task is not None and not task.done():
            self._sweep_stop = True
            await self._cancel_motion()
            try:
                await task
            except Exception:  # noqa: BLE001
                logger.exception("servo %s: sweep task raised on shutdown", self.proxy_id)
        self._sweep_task = None
        self._sweep_stop = False

    async def _publish_motion_event(self, event: str, **fields: Any) -> None:
        """Publish one motion-lifecycle event on
        ``/servo/<id>/motion_events``. Non-retained — this is a
        stream, not a state snapshot; subscribers that connect
        between events get nothing replayed (they should look at
        ``/state`` for current position).

        ``self.publish`` on the in-process ``framework.Service`` base
        is SYNCHRONOUS (returns None) — it goes straight to
        ``bus.publish_sync``. Awaiting it raises ``TypeError: object
        NoneType can't be used in 'await' expression``. Match the
        pattern from ``_publish_state`` below — call without await.
        (If servo is ever refactored to a subprocess service the
        signature changes to async there too, and we'd switch to
        ``await``.)

        Best-effort: a publish failure is logged but never raised
        back into the motion loop (we'd rather miss an event than
        crash the run)."""
        try:
            payload: Dict[str, Any] = {"event": event, "ts": time.time(), **fields}
            self.publish("motion_events", payload, retained=False)
        except Exception:  # noqa: BLE001
            logger.exception("servo %s: motion_event publish failed", self.proxy_id)

    async def _motion_loop(
        self,
        start: int,
        end: int,
        speed_deg_per_s: int,
        *,
        interpolated: bool,
        source: str,
    ) -> None:
        """Walk from ``start`` to ``end`` at ``speed_deg_per_s``.

        ``interpolated`` picks the trajectory:

          * True — frame rate matches the Servo library's PWM update
            (50 Hz); intermediate angles ramp linearly from start to
            end over ``abs(distance)/speed_deg_per_s`` seconds. State
            republished every Nth frame so the UI tracks live
            position without saturating subscribers.
          * False — single ``servo_write`` to the target then sleep
            ``abs(distance)/speed_deg_per_s`` seconds. The hardware
            snaps; the dwell exists so motion-lifecycle events and
            the ``moving`` flag report a plausible window. Sweep
            passes the configured sweep rate here for paced
            endpoint dwells; m_write passes
            ``_INSTANT_TYPICAL_DEG_PER_S`` for dead-reckoned single
            instant writes.

        ``source`` ("write" / "sweep") tags the originating method
        on both ends of the motion_events pair so consumers can
        correlate start ↔ end and see what triggered each cycle.

        Emits a started/ended event pair on
        ``/servo/<id>/motion_events`` regardless of trajectory. The
        ended event carries the same identifying fields as started
        (so they correlate cleanly) plus an ``actual_duration_s``
        and a ``cancelled`` flag set true when the loop was cut
        short by m_stop or a new write.

        On completion or cancellation ``moving`` is cleared and a
        final state is published.
        """
        distance = end - start
        # Zero-distance moves: no real motion, no events. The
        # hardware doesn't need to be told either.
        if distance == 0:
            self._current_angle = end
            self._moving = False
            await self._publish_state()
            return

        total_s = abs(distance) / float(speed_deg_per_s)

        # ``command`` is the identifying tuple that lets consumers
        # pair a started with its matching ended — same fields on
        # both ends.
        command: Dict[str, Any] = {
            "source": source,
            "from": int(start),
            "to": int(end),
            "speed_deg_per_s": int(speed_deg_per_s),
            "interpolated": bool(interpolated),
            "estimated_duration_s": float(total_s),
        }
        started_at = time.monotonic()
        cancelled = False

        await self._publish_motion_event("started", **command)
        try:
            if not interpolated:
                # Instant leg: one packet then dwell. Fans out to all
                # bound controllers (per-binding pin / servo_id injected).
                await self._send_to_controller({"action": "servo_write", "angle": end})
                self._current_angle = end
                await self._publish_state()
                await asyncio.sleep(total_s)
            else:
                frame_dt = 1.0 / self._MOTION_FRAME_HZ
                steps = max(1, int(round(total_s * self._MOTION_FRAME_HZ)))
                for i in range(1, steps + 1):
                    # Linear interpolation. Easing curves (cubic,
                    # ease-in-out) can be added later by swapping the
                    # t→angle mapping; the framing is the same.
                    t = i / steps
                    angle = int(round(start + distance * t))
                    self._current_angle = angle
                    await self._send_to_controller({"action": "servo_write", "angle": angle})
                    # Publish state at a lower rate than the control
                    # frames. 50Hz publishes would saturate every
                    # chip-bar UI just to render a slider that moves
                    # ~10 px/sec.
                    if i % self._STATE_PUBLISH_EVERY_N_FRAMES == 0:
                        await self._publish_state()
                    await asyncio.sleep(frame_dt)
        except asyncio.CancelledError:
            cancelled = True
            # Swallow — the finally block needs to run + emit the
            # ended event before the task fully unwinds. Re-raising
            # would skip our await calls.
        finally:
            self._moving = False
            elapsed = time.monotonic() - started_at
            await self._publish_motion_event(
                "ended",
                **command,
                actual_duration_s=float(elapsed),
                cancelled=cancelled,
            )
            await self._publish_state()

    async def _publish_state(self) -> None:
        self.publish("state", self._snapshot(), retained=True)

    async def _send_to_controller(
        self,
        payload: Dict[str, Any],
        *,
        controller_type: Optional[str] = None,
        controller_id: Optional[str] = None,
    ) -> None:
        """Publish to the attached controller's /control topic.

        Defaults to the currently-configured controller; explicit args
        let detach-on-replace target the OLD controller before the
        config flips.
        """
        servo_id = getattr(self, "proxy_id", None)
        # Explicit single-target send (e.g. detach-on-replace targeting
        # the OLD controller before the binding list changes).
        if controller_type and controller_id:
            out = dict(payload)
            if servo_id is not None:
                out["servo_id"] = servo_id
            self.publish(f"/{controller_type}/{controller_id}/control", out)
            return
        # Fan out to every bound controller. Each gets its own pin (real
        # controllers) or none (virtual controllers map by servo_id).
        bindings = list(self.config.controllers)
        if not bindings:
            logger.warning("servo %s: send dropped — no controller bound", self.proxy_id)
            return
        for b in bindings:
            out = dict(payload)
            if servo_id is not None:
                out["servo_id"] = servo_id
            if b.pin is not None:
                out["pin"] = int(b.pin)
            else:
                out.pop("pin", None)
            self.publish(f"/{b.controller_type}/{b.controller_id}/control", out)

    async def _sweep_loop(self, start: int, end: int) -> None:
        """Bounce between ``start`` and ``end`` forever, reusing the
        per-write motion loop for each leg.

        Cooperative stop: checks ``self._sweep_stop`` at each leg
        boundary AND lets _cancel_motion break the current leg's
        sleep. Once stop is requested, the loop exits naturally — no
        cancellation, no nested except handlers.
        """
        leg_from, leg_to = int(start), int(end)
        speed = max(1, int(self.config.speed_deg_per_s))
        # Clamp legs into the soft envelope so a stale sweep call from
        # before a set_limits doesn't push past the new bounds.
        lo = int(self.config.min_angle)
        hi = int(self.config.max_angle)
        leg_from = max(lo, min(hi, leg_from))
        leg_to = max(lo, min(hi, leg_to))
        try:
            while not self._sweep_stop:
                start_angle = self._current_angle if self._current_angle is not None else leg_from
                self._moving = True
                await self._publish_state()
                self._motion_task = asyncio.create_task(
                    self._motion_loop(
                        int(start_angle), leg_to, speed,
                        interpolated=self.config.speed_control_enabled,
                        source="sweep",
                    )
                )
                # Wait for the leg to finish (or to be cut short by
                # _cancel_motion). Catch the task's own CancelledError
                # locally so it doesn't propagate to sweep_task —
                # we'd rather check the flag and exit cleanly.
                try:
                    await self._motion_task
                except asyncio.CancelledError:
                    pass
                self._motion_task = None
                if self._sweep_stop:
                    break
                self.config = self.config.merge_dict({"angle": leg_to})
                # Reverse for the next leg.
                leg_from, leg_to = leg_to, leg_from
        finally:
            # Always leave the service in a clean "not moving" state,
            # even if the loop exits via exception.
            self._motion_task = None
            self._moving = False
            await self._publish_state()

    async def _control_loop(self) -> None:
        """Translate /control bus messages into @service_method calls.

        Delegated to the framework's shared ``run_control_loop`` so the
        Layer-2 reply_to + publish_return logic lives in one place.
        """
        await self.run_control_loop()
