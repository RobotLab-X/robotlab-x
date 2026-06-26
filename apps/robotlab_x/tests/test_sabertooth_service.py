# unmanaged
"""Unit tests for the sabertooth subprocess service.

Two layers:
  * the pure Packetized Serial encoder (protocol.py) — checksum, the
    signed-float → command/data mapping, config packets. No hardware,
    no bus.
  * the SabertoothService @service_method handlers — driven with a fake
    SerialLink that records every byte written, and a no-op bus, so we
    assert on the exact wire packets the motor_controller actions emit.

sabertooth_service lives in its own subprocess venv (pyserial). pyserial
is imported lazily inside SerialLink.open(), so importing the service
module here in the top-level test venv is fine — no port is ever opened.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List

import pytest

_SABER_SRC = Path(__file__).resolve().parents[1] / "repo" / "sabertooth" / "1.0.0" / "src"
if str(_SABER_SRC) not in sys.path:
    sys.path.insert(0, str(_SABER_SRC))


from sabertooth_service import protocol  # noqa: E402


# ─────────────────────────────────────────────────────────────────────
# protocol.py — pure encoder
# ─────────────────────────────────────────────────────────────────────


def test_checksum_masks_high_bit():
    # (128 + 0 + 127) = 255 → & 0x7F = 127
    assert protocol.checksum(128, 0, 127) == 127
    # (135 + 5 + 64) = 204 → 204 & 0x7F = 76
    assert protocol.checksum(135, 5, 64) == 76
    # checksum never sets the high bit (only address bytes do)
    for d in range(0, 128):
        assert protocol.checksum(128, 0, d) < 128


def test_packet_shape_and_checksum():
    pkt = protocol.packet(128, protocol.CMD_M1_FORWARD, 64)
    assert pkt == bytes([128, 0, 64, (128 + 0 + 64) & 0x7F])
    assert len(pkt) == 4


@pytest.mark.parametrize("addr", [127, 136, 0, 200])
def test_packet_rejects_bad_address(addr):
    with pytest.raises(ValueError):
        protocol.packet(addr, 0, 0)


@pytest.mark.parametrize("data", [-1, 128, 200])
def test_packet_rejects_bad_data(data):
    with pytest.raises(ValueError):
        protocol.packet(128, 0, data)


def test_value_to_data_full_scale():
    assert protocol.value_to_data(0.0) == 0
    assert protocol.value_to_data(1.0) == 127
    assert protocol.value_to_data(-1.0) == 127      # sign dropped here
    assert protocol.value_to_data(0.5) == 64        # round(0.5*127)=64
    # out-of-range clamps, never overflows the data byte
    assert protocol.value_to_data(5.0) == 127
    assert protocol.value_to_data(-5.0) == 127


def test_drive_packet_picks_direction_command():
    # motor 1 forward = command 0, backward = command 1
    fwd = protocol.drive_packet(128, 1, 0.5)
    assert fwd[1] == protocol.CMD_M1_FORWARD and fwd[2] == 64
    back = protocol.drive_packet(128, 1, -0.5)
    assert back[1] == protocol.CMD_M1_BACKWARD and back[2] == 64
    # motor 2 forward = command 4, backward = command 5
    assert protocol.drive_packet(128, 2, 0.25)[1] == protocol.CMD_M2_FORWARD
    assert protocol.drive_packet(128, 2, -0.25)[1] == protocol.CMD_M2_BACKWARD


def test_drive_packet_zero_is_forward_stop():
    pkt = protocol.drive_packet(128, 1, 0.0)
    assert pkt[1] == protocol.CMD_M1_FORWARD
    assert pkt[2] == 0


def test_drive_packet_rejects_bad_motor():
    with pytest.raises(ValueError):
        protocol.drive_packet(128, 3, 0.5)


def test_stop_packet_is_zero_data():
    assert protocol.stop_packet(128, 2)[2] == 0


def test_config_packets():
    assert protocol.serial_timeout_packet(128, 10)[1] == protocol.CMD_SERIAL_TIMEOUT
    assert protocol.serial_timeout_packet(128, 10)[2] == 10
    # clamp into 0..127
    assert protocol.serial_timeout_packet(128, 500)[2] == 127
    assert protocol.ramping_packet(128, 99)[2] == 80     # clamped to 80
    assert protocol.deadband_packet(128, 200)[2] == 127   # clamped to 127


# ─────────────────────────────────────────────────────────────────────
# SabertoothService — @service_method handlers
# ─────────────────────────────────────────────────────────────────────


class FakeLink:
    """Records every write; stands in for SerialLink so no port opens."""

    def __init__(self) -> None:
        self.port = "/dev/ttyUSB0"
        self.baudrate = 9600
        self.writes: List[bytes] = []

    @property
    def connected(self) -> bool:
        return True

    async def write(self, data: bytes) -> int:
        self.writes.append(bytes(data))
        return len(data)

    async def close(self) -> None:
        pass


@pytest.fixture
def saber(monkeypatch):
    """A SabertoothService with a recording fake link + no-op bus."""
    from unittest.mock import MagicMock
    from sabertooth_service.service import SabertoothService

    svc = SabertoothService("sabertooth-1", MagicMock())

    async def _noop_publish(*_a, **_k):
        return None

    async def _merge_update(updates):
        # Mirror update_config's local merge without touching a bus.
        svc.config = svc.config.merge_dict(updates)

    monkeypatch.setattr(svc, "publish", _noop_publish)
    monkeypatch.setattr(svc, "update_config", _merge_update)
    link = FakeLink()
    svc._link = link
    svc._link_fake = link  # type: ignore[attr-defined]
    return svc


@pytest.mark.asyncio
async def test_motor_set_emits_drive_packet(saber):
    await saber.m_motor_set(motor=1, value=0.5)
    assert saber._link_fake.writes[-1] == protocol.drive_packet(128, 1, 0.5)
    assert saber._motors[1] == 0.5


@pytest.mark.asyncio
async def test_motor_set_clamped_to_max_output(saber):
    # Lower the driver-side ceiling, then command full throttle.
    await saber.m_set_max_output(max_output=0.4)
    res = await saber.m_motor_set(motor=2, value=1.0)
    assert res["value"] == pytest.approx(0.4)
    # The wire packet carries the clamped magnitude, not 127.
    assert saber._link_fake.writes[-1] == protocol.drive_packet(128, 2, 0.4)


@pytest.mark.asyncio
async def test_lowering_max_output_reclamps_running_motor(saber):
    await saber.m_motor_set(motor=1, value=0.9)
    await saber.m_set_max_output(max_output=0.3)
    # The already-running motor was re-clamped + re-sent.
    assert saber._motors[1] == pytest.approx(0.3)
    assert saber._link_fake.writes[-1] == protocol.drive_packet(128, 1, 0.3)


@pytest.mark.asyncio
async def test_motor_stop_all_zeros_both_channels(saber):
    await saber.m_motor_set(motor=1, value=0.5)
    await saber.m_motor_set(motor=2, value=-0.5)
    saber._link_fake.writes.clear()
    await saber.m_motor_stop_all()
    assert saber._motors == {1: 0.0, 2: 0.0}
    # Both channels got an explicit stop packet.
    assert protocol.stop_packet(128, 1) in saber._link_fake.writes
    assert protocol.stop_packet(128, 2) in saber._link_fake.writes


@pytest.mark.asyncio
async def test_motor_set_rejects_unknown_channel(saber):
    with pytest.raises(ValueError):
        await saber.m_motor_set(motor=3, value=0.1)
