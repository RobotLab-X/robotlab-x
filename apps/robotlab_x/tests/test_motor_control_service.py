# unmanaged
"""Unit tests for the in-process MotorControlService.

MotorControlService is hardware-agnostic — it clamps + slews + publishes
the standardized motor_controller commands (motor_set / motor_stop /
motor_stop_all) to a bound controller's /control topic. These tests:
  * mock the bus publish to record every command (no real subscribers)
  * mock save_config so we don't touch the DB
  * exercise add/remove/set/limits/stop/stop_all/estop + the pure slew
    and clamp helpers

The asserted wire commands ARE the motor_controller contract every
implementation (Sabertooth is the first) must accept.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List

import pytest

_MC_DIR = Path(__file__).resolve().parents[1] / "repo" / "motor_control" / "1.0.0"
if str(_MC_DIR) not in sys.path:
    sys.path.insert(0, str(_MC_DIR))


@pytest.fixture
def mc(monkeypatch):
    from motor_control import MotorControlService
    from robotlab_x.framework.service import ServiceMetadata

    meta = ServiceMetadata(
        proxy_id="motor_control-1",
        service_meta_id="motor_control@1.0.0",
        type_name="motor_control",
        type_version="1.0.0",
        tags=[],
        singleton=False,
    )
    svc = MotorControlService(meta=meta, config={})

    published: List[Dict[str, Any]] = []

    def _publish(suffix: str, payload: Any, *, retained: bool = False) -> None:
        topic = suffix if suffix.startswith("/") else f"/motor_control/{svc.proxy_id}/{suffix}"
        published.append({"topic": topic, "payload": payload, "retained": retained})

    monkeypatch.setattr(svc, "publish", _publish)
    monkeypatch.setattr(svc, "save_config", lambda: None)
    svc._published = published  # type: ignore[attr-defined]
    # Outputs are normally seeded in on_start; seed here so handlers that
    # read self._outputs don't trip over the class-level default.
    svc._outputs = {}
    svc._last_sent = {}
    return svc


def _commands_to(svc, topic: str) -> List[Dict[str, Any]]:
    return [p["payload"] for p in svc._published if p["topic"] == topic]


# ─────────────────────────────────────────────────────────────────────
# pure helpers
# ─────────────────────────────────────────────────────────────────────


def test_advance_instant_when_no_slew():
    from motor_control import MotorControlService as S
    assert S._advance(0.0, 1.0, 0.0, 0.02) == 1.0
    assert S._advance(0.5, -0.5, 0.0, 0.02) == -0.5


def test_advance_steps_toward_target_at_slew_rate():
    from motor_control import MotorControlService as S
    # slew 1.0/s, dt 0.1s → step 0.1
    assert S._advance(0.0, 1.0, 1.0, 0.1) == pytest.approx(0.1)
    assert S._advance(0.0, -1.0, 1.0, 0.1) == pytest.approx(-0.1)
    # snaps to target once within one step
    assert S._advance(0.95, 1.0, 1.0, 0.1) == 1.0


def test_order_limits_clamps_and_sorts():
    from motor_control import MotorControlService as S
    assert S._order_limits(-2.0, 2.0) == (-1.0, 1.0)
    assert S._order_limits(0.8, 0.2) == (0.2, 0.8)   # swapped


# ─────────────────────────────────────────────────────────────────────
# channel management + commands
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_add_channel_binds_and_persists(mc):
    await mc.m_add_channel(id="left", controller_type="sabertooth", controller_id="sabertooth-1", motor=1)
    assert len(mc.config.channels) == 1
    ch = mc.config.channels[0]
    assert ch.id == "left" and ch.controller_id == "sabertooth-1" and ch.motor == 1
    assert ch.value == 0.0


@pytest.mark.asyncio
async def test_set_clamps_to_channel_limits(mc):
    await mc.m_add_channel(id="left", controller_type="sabertooth", controller_id="sabertooth-1", motor=1,
                           min_output=-0.5, max_output=0.5)
    res = await mc.m_set(id="left", value=1.0)
    assert res["target"] == pytest.approx(0.5)   # clamped to max_output


@pytest.mark.asyncio
async def test_set_limits_reclamps_target(mc):
    await mc.m_add_channel(id="left", controller_type="sabertooth", controller_id="sabertooth-1", motor=1)
    await mc.m_set(id="left", value=0.9)
    await mc.m_set_limits(id="left", min_output=-0.3, max_output=0.3)
    assert mc.config.channels[0].value == pytest.approx(0.3)


@pytest.mark.asyncio
async def test_stop_zeros_and_commands_controller(mc):
    await mc.m_add_channel(id="left", controller_type="sabertooth", controller_id="sabertooth-1", motor=2)
    await mc.m_set(id="left", value=0.7)
    await mc.m_stop(id="left")
    assert mc.config.channels[0].value == 0.0
    cmds = _commands_to(mc, "/sabertooth/sabertooth-1/control")
    assert {"action": "motor_stop", "motor": 2} in cmds


@pytest.mark.asyncio
async def test_stop_all_latches_estop_and_broadcasts(mc):
    await mc.m_add_channel(id="left", controller_type="sabertooth", controller_id="sabertooth-1", motor=1)
    await mc.m_add_channel(id="right", controller_type="sabertooth", controller_id="sabertooth-1", motor=2)
    await mc.m_set(id="left", value=0.5)
    await mc.m_stop_all()
    assert mc.config.estopped is True
    # One motor_stop_all per DISTINCT controller (both channels share one).
    cmds = _commands_to(mc, "/sabertooth/sabertooth-1/control")
    assert cmds.count({"action": "motor_stop_all"}) == 1


@pytest.mark.asyncio
async def test_set_refused_while_estopped(mc):
    await mc.m_add_channel(id="left", controller_type="sabertooth", controller_id="sabertooth-1", motor=1)
    await mc.m_stop_all()
    with pytest.raises(RuntimeError, match="E-STOPPED"):
        await mc.m_set(id="left", value=0.2)
    # clear_estop releases the latch
    await mc.m_clear_estop()
    assert mc.config.estopped is False
    res = await mc.m_set(id="left", value=0.2)
    assert res["target"] == pytest.approx(0.2)


@pytest.mark.asyncio
async def test_remove_channel_stops_then_drops(mc):
    await mc.m_add_channel(id="left", controller_type="sabertooth", controller_id="sabertooth-1", motor=1)
    await mc.m_remove_channel(id="left")
    assert mc.config.channels == []
    cmds = _commands_to(mc, "/sabertooth/sabertooth-1/control")
    assert {"action": "motor_stop", "motor": 1} in cmds


@pytest.mark.asyncio
async def test_invert_flips_effective_output(mc):
    from motor_control import MotorChannel
    ch = MotorChannel(id="x", invert=True)
    assert mc._effective_output(ch, 0.5) == -0.5
    ch2 = MotorChannel(id="y", invert=False)
    assert mc._effective_output(ch2, 0.5) == 0.5


# ─────────────────────────────────────────────────────────────────────
# input-source streaming (joystick axis → channel target)
# ─────────────────────────────────────────────────────────────────────

_JOY_PAYLOAD = {"axes": [0.0, -0.5, 0.0, 0.73], "buttons": [0, 1], "hats": [[0, 1]], "balls": []}


def test_extract_input_linear_map():
    from motor_control import MotorControlService as S, InputSource
    src = InputSource(topic="/joystick/joystick-1/input", field="axes", index=3, scale=1.0)
    assert S._extract_input(src, _JOY_PAYLOAD) == pytest.approx(0.73)
    # scale + offset
    src2 = InputSource(topic="t", field="axes", index=1, scale=2.0, offset=0.1)
    assert S._extract_input(src2, _JOY_PAYLOAD) == pytest.approx(-0.5 * 2.0 + 0.1)


def test_extract_input_deadzone():
    from motor_control import MotorControlService as S, InputSource
    src = InputSource(topic="t", field="axes", index=0, scale=1.0, deadzone=0.1)
    # axis 0 is 0.0 → stays 0; a small noise value under deadzone → 0
    assert S._extract_input(src, {"axes": [0.04]}) == 0.0
    assert S._extract_input(src, {"axes": [0.5]}) == pytest.approx(0.5)


def test_extract_input_safe_on_bad_payload():
    from motor_control import MotorControlService as S, InputSource
    src = InputSource(topic="t", field="axes", index=9, scale=1.0)   # out of range
    assert S._extract_input(src, _JOY_PAYLOAD) is None
    assert S._extract_input(src, None) is None                        # not a dict
    assert S._extract_input(src, {"axes": "nope"}) is None            # not a list
    src_btn = InputSource(topic="t", field="buttons", index=1, scale=1.0)
    assert S._extract_input(src_btn, _JOY_PAYLOAD) == pytest.approx(1.0)


def test_apply_input_clamps_to_window():
    from motor_control import MotorControlService as S, MotorChannel, InputSource
    ch = MotorChannel(
        id="left", min_output=-0.8, max_output=0.8,
        input_source=InputSource(topic="t", field="axes", index=3, scale=100.0),
    )
    # raw 0.73 × 100 = 73 → saturates at max_output 0.8
    out = _apply_via(ch, _JOY_PAYLOAD, estopped=False)
    assert out == pytest.approx(0.8)
    assert ch.value == pytest.approx(0.8)


def test_apply_input_ignored_when_estopped_or_disabled():
    from motor_control import MotorChannel, InputSource
    src = InputSource(topic="t", field="axes", index=3, scale=1.0)
    ch = MotorChannel(id="left", input_source=src)
    assert _apply_via(ch, _JOY_PAYLOAD, estopped=True) is None
    ch.enabled = False
    assert _apply_via(ch, _JOY_PAYLOAD, estopped=False) is None


@pytest.mark.asyncio
async def test_set_input_binds_and_appears_in_state(mc, monkeypatch):
    # don't spawn a real bus subscription task in the unit test
    monkeypatch.setattr(mc, "_resync_input_subscriptions", lambda: None)
    await mc.m_add_channel(id="left", controller_type="sabertooth", controller_id="sabertooth-1", motor=1)
    await mc.m_set_input(id="left", topic="/joystick/joystick-1/input", field="axes", index=3, scale=100.0, deadzone=0.05)
    ch = mc._find("left")
    assert ch.input_source is not None
    assert ch.input_source.topic == "/joystick/joystick-1/input"
    assert ch.input_source.index == 3
    assert ch.input_source.scale == 100.0
    snap = mc._snapshot()["channels"][0]
    assert snap["input_source"]["field"] == "axes"
    assert snap["input_source"]["deadzone"] == 0.05


@pytest.mark.asyncio
async def test_clear_input_unbinds_and_zeros(mc, monkeypatch):
    monkeypatch.setattr(mc, "_resync_input_subscriptions", lambda: None)
    await mc.m_add_channel(id="left", controller_type="sabertooth", controller_id="sabertooth-1", motor=1)
    await mc.m_set_input(id="left", topic="/joystick/joystick-1/input", index=3)
    await mc.m_set(id="left", value=0.5)
    await mc.m_clear_input(id="left")
    ch = mc._find("left")
    assert ch.input_source is None
    assert ch.value == 0.0
    assert mc._snapshot()["channels"][0]["input_source"] is None


class _DummyEstop:
    def __init__(self, estopped):
        self.estopped = estopped


def _apply_via(ch, payload, *, estopped):
    """Call MotorControlService._apply_input with a minimal stand-in for
    self (only needs .config.estopped). _apply_input reads
    self.config.estopped, ch.enabled, ch.input_source and the static
    _extract_input / _clamp — none of which need a live service."""
    from motor_control import MotorControlService as S

    class _Stub:
        config = _DummyEstop(estopped)
        _extract_input = staticmethod(S._extract_input)
        _clamp = staticmethod(S._clamp)
    return S._apply_input(_Stub(), ch, payload)
