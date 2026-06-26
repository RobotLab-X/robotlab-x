# unmanaged
"""Unit tests for the in-process ServoService.

ServoService is hardware-agnostic — it publishes commands to a
controller's /control topic. These tests:
  * mock the bus to record every publish (no real subscribers needed)
  * mock save_config so we don't touch the DB
  * exercise attach/detach/write/sweep/set_limits

The tests assert on the wire-level commands the servo sends, which is
the contract every servo_controller implementation must accept.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import MagicMock

import pytest


# servo.py lives at <robotlab_x>/repo/servo/1.0.0/servo.py — make it
# importable. The clock tests follow the same pattern.
_SERVO_DIR = Path(__file__).resolve().parents[1] / "repo" / "servo" / "1.0.0"
if str(_SERVO_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVO_DIR))


# ─────────────────────────────────────────────────────────────────────
# Fixture: a ServoService wired to a recording bus + no DB
# ─────────────────────────────────────────────────────────────────────


@pytest.fixture
def servo(monkeypatch):
    """Build a ServoService and replace its publish/save_config with
    recorders so tests can introspect the wire-level commands without
    spinning up the real bus or DB.
    """
    from servo import ServoService
    from robotlab_x.framework.service import ServiceMetadata

    meta = ServiceMetadata(
        proxy_id="servo-1",
        service_meta_id="servo@1.0.0",
        type_name="servo",
        type_version="1.0.0",
        tags=[],
        singleton=False,
    )
    svc = ServoService(meta=meta, config={})

    published: List[Dict[str, Any]] = []
    def _publish(suffix: str, payload: Any, *, retained: bool = False) -> None:
        # Mirror Service.publish: relative paths get prefixed; absolute
        # paths (the controller's /control topic) pass through.
        topic = suffix if suffix.startswith("/") else f"/servo/{svc.proxy_id}/{suffix}"
        published.append({"topic": topic, "payload": payload, "retained": retained})
    monkeypatch.setattr(svc, "publish", _publish)
    monkeypatch.setattr(svc, "save_config", lambda: None)

    svc._published = published  # type: ignore[attr-defined]
    return svc


def _commands_to(svc, topic: str) -> List[Dict[str, Any]]:
    return [p["payload"] for p in svc._published if p["topic"] == topic]


def _state_publishes(svc) -> List[Dict[str, Any]]:
    return [p for p in svc._published if p["topic"] == "/servo/servo-1/state"]


# ─────────────────────────────────────────────────────────────────────
# attach / detach
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_attach_publishes_servo_attach_then_write_to_controller(servo):
    """Attach should: (1) send servo_attach to the controller, (2) replay
    current angle so the servo physically tracks our state, (3) publish
    retained /state with the new attachment."""
    await servo.m_attach(controller_type="arduino", controller_id="arduino-1", pin=9)

    cmds = _commands_to(servo, "/arduino/arduino-1/control")
    actions = [c["action"] for c in cmds]
    assert actions == ["servo_attach", "servo_write"]
    # Every message now carries the sending servo's id.
    assert cmds[0] == {"action": "servo_attach", "pin": 9, "servo_id": "servo-1"}
    # Replay should use the default angle (90)
    assert cmds[1]["action"] == "servo_write"
    assert cmds[1]["pin"] == 9
    assert cmds[1]["angle"] == 90
    assert cmds[1]["servo_id"] == "servo-1"
    # Binding recorded in the controllers list.
    assert [b.model_dump() for b in servo.config.controllers] == [
        {"controller_type": "arduino", "controller_id": "arduino-1", "pin": 9}
    ]

    # config persisted
    assert servo.config.controller_type == "arduino"
    assert servo.config.controller_id == "arduino-1"
    assert servo.config.pin == 9

    # retained /state mirrors the attach
    states = _state_publishes(servo)
    assert states[-1]["retained"] is True
    assert states[-1]["payload"]["attached"] is True
    assert states[-1]["payload"]["controller_id"] == "arduino-1"


@pytest.mark.asyncio
async def test_attach_adds_second_controller(servo):
    """Multi-controller: attaching a NEW controller ADDS it (does NOT
    detach the existing one) — a servo can drive several controllers at
    once (e.g. a real Arduino + a virtual robot_kinematics). The old
    controller keeps its binding; only the new one is configured."""
    await servo.m_attach(controller_type="arduino", controller_id="arduino-1", pin=9)
    servo._published.clear()
    await servo.m_attach(controller_type="arduino", controller_id="arduino-2", pin=10)

    old_cmds = _commands_to(servo, "/arduino/arduino-1/control")
    new_cmds = _commands_to(servo, "/arduino/arduino-2/control")
    assert old_cmds == []  # the previous controller is left alone
    assert [c["action"] for c in new_cmds] == ["servo_attach", "servo_write"]
    # Both bindings are now active.
    ids = {(b.controller_id, b.pin) for b in servo.config.controllers}
    assert ids == {("arduino-1", 9), ("arduino-2", 10)}


@pytest.mark.asyncio
async def test_attach_same_pin_does_not_redundantly_detach(servo):
    """Attaching to the SAME controller+pin shouldn't generate a
    spurious servo_detach — the framework should be idempotent."""
    await servo.m_attach(controller_type="arduino", controller_id="arduino-1", pin=9)
    servo._published.clear()
    await servo.m_attach(controller_type="arduino", controller_id="arduino-1", pin=9)
    cmds = _commands_to(servo, "/arduino/arduino-1/control")
    actions = [c["action"] for c in cmds]
    assert "servo_detach" not in actions


@pytest.mark.asyncio
async def test_attach_rejects_empty_controller(servo):
    with pytest.raises(ValueError, match="attach requires"):
        await servo.m_attach(controller_type="", controller_id="", pin=9)


@pytest.mark.asyncio
async def test_detach_sends_servo_detach_and_keeps_binding(servo):
    """Detach sends servo_detach + flips the ``attached`` intent flag,
    but DELIBERATELY keeps controller_type/controller_id/pin so a
    no-arg re-attach resumes the same binding (per m_detach docstring)."""
    await servo.m_attach(controller_type="arduino", controller_id="arduino-1", pin=9)
    servo._published.clear()
    await servo.m_detach()
    cmds = _commands_to(servo, "/arduino/arduino-1/control")
    assert cmds == [{"action": "servo_detach", "pin": 9, "servo_id": "servo-1"}]
    # Binding is preserved; only the intent flag flips.
    assert servo.config.controller_id == "arduino-1"
    assert servo.config.pin == 9
    assert len(servo.config.controllers) == 1
    assert servo.config.attached is False
    states = _state_publishes(servo)
    assert states[-1]["payload"]["attached"] is False


@pytest.mark.asyncio
async def test_detach_when_unattached_is_noop(servo):
    """Detach with no attachment should publish a /state (idempotent)
    but no controller command — there is no controller to talk to."""
    await servo.m_detach()
    # No publishes to any /control topic
    controls = [p for p in servo._published if "/control" in p["topic"] and p["topic"] != "/servo/servo-1/control"]
    assert controls == []


# ─────────────────────────────────────────────────────────────────────
# write
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_write_publishes_servo_write_to_controller(servo):
    # m_write now defers the actual send to a background motion task;
    # await it so the servo_write frame has been emitted. In the
    # default (instant) mode that's a single packet at the target.
    await servo.m_attach(controller_type="arduino", controller_id="arduino-1", pin=9)
    # Instant mode → a single servo_write packet at the target (default
    # mode interpolates and would emit a ramp of frames instead).
    await servo.m_set_speed_control_enabled(False)
    # Seed the live position so the write is a real move (a write whose
    # target equals the current angle is a zero-distance no-op that emits
    # no frame — the motion loop only sends when start != target).
    servo._current_angle = 0
    servo._published.clear()
    result = await servo.m_write(angle=42)
    if servo._motion_task is not None:
        await servo._motion_task
    cmds = _commands_to(servo, "/arduino/arduino-1/control")
    assert cmds == [{"action": "servo_write", "pin": 9, "angle": 42, "servo_id": "servo-1"}]
    assert result["angle"] == 42
    assert servo.config.angle == 42


@pytest.mark.asyncio
async def test_write_clamps_to_configured_limits(servo):
    await servo.m_attach(controller_type="arduino", controller_id="arduino-1", pin=9)
    await servo.m_set_limits(min_angle=30, max_angle=120)
    servo._current_angle = 90  # known live position so writes are real moves
    servo._published.clear()
    # Out-of-range high
    await servo.m_write(angle=999)
    if servo._motion_task is not None:
        await servo._motion_task
    cmds = _commands_to(servo, "/arduino/arduino-1/control")
    assert cmds[-1]["angle"] == 120
    # Out-of-range low
    servo._published.clear()
    await servo.m_write(angle=-50)
    if servo._motion_task is not None:
        await servo._motion_task
    cmds = _commands_to(servo, "/arduino/arduino-1/control")
    assert cmds[-1]["angle"] == 30


@pytest.mark.asyncio
async def test_write_without_attach_raises(servo):
    with pytest.raises(RuntimeError, match="not attached"):
        await servo.m_write(angle=90)


# ─────────────────────────────────────────────────────────────────────
# set_limits — soft envelope
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_set_limits_swaps_if_inverted(servo):
    """If the user gives min > max, the service should swap rather than
    refuse — typo-friendly + matches every drawing-tool convention."""
    res = await servo.m_set_limits(min_angle=170, max_angle=10)
    assert res["min_angle"] == 10
    assert res["max_angle"] == 170


@pytest.mark.asyncio
async def test_set_limits_reclamps_current_angle(servo):
    await servo.m_attach(controller_type="arduino", controller_id="arduino-1", pin=9)
    await servo.m_write(angle=170)
    assert servo.config.angle == 170
    await servo.m_set_limits(min_angle=0, max_angle=90)
    # current angle was 170 → outside new envelope → re-clamped to 90
    assert servo.config.angle == 90


# ─────────────────────────────────────────────────────────────────────
# sweep
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_sweep_drives_endpoints_and_can_be_stopped(servo):
    """Sweep now bounces between the two endpoints forever, reusing the
    per-write motion loop (no ``step``/``delay_ms`` — speed defines the
    rate). In instant mode each leg is a single servo_write at the leg's
    target endpoint. Verify it emits endpoint writes within range, then
    stops cleanly."""
    await servo.m_attach(controller_type="arduino", controller_id="arduino-1", pin=9)
    await servo.m_set_speed(360)  # fast legs so the test runs quickly
    servo._published.clear()
    res = await servo.m_sweep(start=0, end=20)
    assert res == {"sweeping": True, "start": 0, "end": 20}
    await asyncio.sleep(0.1)
    stop = await servo.m_stop_sweep()
    assert stop["stopped"] is True
    if servo._sweep_task is not None:
        await servo._sweep_task

    writes = [
        c["angle"] for c in _commands_to(servo, "/arduino/arduino-1/control")
        if c["action"] == "servo_write"
    ]
    assert writes, "sweep should have emitted at least one servo_write"
    # Instant mode → every write lands on an endpoint, inside [0, 20].
    assert all(0 <= a <= 20 for a in writes)
    # Stop clears the sweeping state.
    assert servo._snapshot()["sweeping"] is False


@pytest.mark.asyncio
async def test_sweep_descending_drives_lower_endpoint(servo):
    """end < start still works — the loop clamps + bounces between the
    two endpoints regardless of order."""
    await servo.m_attach(controller_type="arduino", controller_id="arduino-1", pin=9)
    await servo.m_set_speed(360)
    servo._published.clear()
    await servo.m_sweep(start=20, end=10)
    await asyncio.sleep(0.1)
    await servo.m_stop_sweep()
    if servo._sweep_task is not None:
        await servo._sweep_task
    writes = [
        c["angle"] for c in _commands_to(servo, "/arduino/arduino-1/control")
        if c["action"] == "servo_write"
    ]
    assert writes
    assert all(10 <= a <= 20 for a in writes)


@pytest.mark.asyncio
async def test_stop_sweep_cancels_in_flight(servo):
    """A slow INTERPOLATED sweep ramps gradually; stop_sweep cancels it
    mid-leg so it never reaches the far endpoint."""
    await servo.m_attach(controller_type="arduino", controller_id="arduino-1", pin=9)
    await servo.m_set_speed_control_enabled(True)  # interpolate (ramp)
    await servo.m_set_speed(60)                    # slow enough to catch mid-flight
    servo._published.clear()
    await servo.m_sweep(start=0, end=180)
    await asyncio.sleep(0.05)  # let it ramp a little
    result = await servo.m_stop_sweep()
    assert result == {"stopped": True, "angle": result["angle"]}
    if servo._sweep_task is not None:
        await servo._sweep_task
    writes = [
        c["angle"] for c in _commands_to(servo, "/arduino/arduino-1/control")
        if c["action"] == "servo_write"
    ]
    assert writes, "interpolated sweep should ramp out some frames"
    # Cancelled mid-ramp — never reached the far endpoint.
    assert max(writes) < 180


@pytest.mark.asyncio
async def test_sweep_without_attach_raises(servo):
    with pytest.raises(RuntimeError, match="not attached"):
        await servo.m_sweep(start=0, end=10)


# ─────────────────────────────────────────────────────────────────────
# Config schema
# ─────────────────────────────────────────────────────────────────────


def test_servo_config_defaults():
    from servo import ServoConfig
    c = ServoConfig()
    assert c.controller_id is None
    assert c.pin is None
    assert c.angle == 90
    assert c.min_angle == 0
    assert c.max_angle == 180


def test_servo_config_rejects_angle_over_180():
    from servo import ServoConfig
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        ServoConfig(angle=200)


# ─────────────────────────────────────────────────────────────────────
# multi-controller + virtual controllers
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_attach_virtual_controller_no_pin(servo):
    """A virtual controller (robot_kinematics) attaches with NO pin; the
    servo_attach carries only servo_id."""
    await servo.m_attach(controller_type="robot_kinematics", controller_id="robot_kinematics-1")
    cmds = _commands_to(servo, "/robot_kinematics/robot_kinematics-1/control")
    assert cmds[0] == {"action": "servo_attach", "servo_id": "servo-1"}
    assert "pin" not in cmds[0]
    assert servo.config.controllers[0].pin is None


@pytest.mark.asyncio
async def test_write_fans_out_to_all_controllers(servo):
    """One write reaches EVERY bound controller — a real Arduino (with
    its pin) and a virtual robot_kinematics (no pin), both tagged with
    servo_id."""
    await servo.m_attach(controller_type="arduino", controller_id="arduino-1", pin=9)
    await servo.m_attach(controller_type="robot_kinematics", controller_id="robot_kinematics-1")
    await servo.m_set_speed_control_enabled(False)
    servo._current_angle = 0
    servo._published.clear()
    await servo.m_write(angle=42)
    if servo._motion_task is not None:
        await servo._motion_task

    ard = _commands_to(servo, "/arduino/arduino-1/control")
    rk = _commands_to(servo, "/robot_kinematics/robot_kinematics-1/control")
    assert ard == [{"action": "servo_write", "pin": 9, "angle": 42, "servo_id": "servo-1"}]
    # virtual: no pin, identified by servo_id
    assert rk == [{"action": "servo_write", "angle": 42, "servo_id": "servo-1"}]


@pytest.mark.asyncio
async def test_detach_one_of_many_keeps_the_rest(servo):
    """Detaching a specific controller removes only that binding; others
    keep driving."""
    await servo.m_attach(controller_type="arduino", controller_id="arduino-1", pin=9)
    await servo.m_attach(controller_type="robot_kinematics", controller_id="robot_kinematics-1")
    servo._published.clear()
    await servo.m_detach(controller_type="arduino", controller_id="arduino-1")

    ard = _commands_to(servo, "/arduino/arduino-1/control")
    assert ard == [{"action": "servo_detach", "pin": 9, "servo_id": "servo-1"}]
    remaining = [(b.controller_type, b.controller_id) for b in servo.config.controllers]
    assert remaining == [("robot_kinematics", "robot_kinematics-1")]


@pytest.mark.asyncio
async def test_write_requires_a_controller(servo):
    with pytest.raises(RuntimeError, match="not attached"):
        await servo.m_write(angle=10)
