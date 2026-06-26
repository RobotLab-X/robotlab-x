# unmanaged
"""RaspiService unit tests.

We test:
  * board.detect_board() correctly identifies a Pi via mocked
    /proc/device-tree/model + /proc/cpuinfo, and falls back to mock
    otherwise.
  * MockBackend faithfully implements the wire surface (set_pin_mode,
    digital_write/read, pwm_write, i2c_scan/read/write).
  * RaspiService @service_method handlers route to the backend and
    persist pin_modes + pin_polls via update_config.

No real GPIO library is imported — the HwBackend path is exercised
only at import-time via gpio_backend; tests use MockBackend exclusively.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import AsyncMock, MagicMock

import pytest

# Make raspi_service importable from the top-level test venv. The real
# subprocess venv has gpiozero + smbus2; this venv doesn't, so we stub
# them only when an actual HwBackend test runs (we don't run any here).
_RASPI_SRC = Path(__file__).resolve().parents[1] / "repo" / "raspi" / "1.0.0" / "src"
if str(_RASPI_SRC) not in sys.path:
    sys.path.insert(0, str(_RASPI_SRC))


# ─────────────────────────────────────────────────────────────────────
# board.detect_board
# ─────────────────────────────────────────────────────────────────────


def test_detect_board_returns_mock_on_non_pi(tmp_path, monkeypatch):
    from raspi_service import board
    # Force the /proc reads to come up empty
    monkeypatch.setattr(board, "_read_text", lambda path: None)
    monkeypatch.setattr(board, "_parse_cpuinfo", lambda: {})
    info = board.detect_board()
    assert info["kind"] == "mock"
    assert "gpio_pins" in info
    assert info["pin_functions"]  # populated


def test_detect_board_recognises_raspberry_pi(monkeypatch):
    from raspi_service import board
    # Fake /proc/device-tree/model + /proc/cpuinfo
    model = "Raspberry Pi 4 Model B Rev 1.4"
    cpuinfo = {"Revision": "c03114", "Serial": "10000000abcdef00", "Hardware": "BCM2711"}
    monkeypatch.setattr(board, "_read_text",
                        lambda path: model if "model" in path else None)
    monkeypatch.setattr(board, "_parse_cpuinfo", lambda: cpuinfo)
    info = board.detect_board()
    assert info["kind"] == "raspi"
    assert "Raspberry Pi 4" in info["model"]
    assert info["revision_code"] == "c03114"
    assert info["serial"] == "10000000abcdef00"
    # Revision decoding should pick up SoC bits
    assert info["soc"]  # non-empty string


def test_revision_decoder_handles_new_format():
    from raspi_service.board import _decode_revision
    # 0xa22082 = Pi 3B, BCM2837, 1GB → new-flag bit 23 NOT set so this is OLD format
    # Use 0xc03114 (Pi 4B Rev 1.4, BCM2711, 4GB) which has the new flag
    d = _decode_revision("c03114")
    assert d.get("soc") == "BCM2711"
    assert d.get("revision_code") == "c03114"


def test_revision_decoder_returns_empty_on_garbage():
    from raspi_service.board import _decode_revision
    assert _decode_revision("not-hex") == {}


# ─────────────────────────────────────────────────────────────────────
# MockBackend
# ─────────────────────────────────────────────────────────────────────


def test_mock_backend_set_pin_mode_validates():
    from raspi_service.gpio_backend import MockBackend
    b = MockBackend()
    with pytest.raises(ValueError):
        b.set_pin_mode(17, "tachyon")


def test_mock_backend_digital_write_read_round_trip():
    from raspi_service.gpio_backend import MockBackend
    b = MockBackend()
    b.set_pin_mode(17, "output")
    b.digital_write(17, 1)
    assert b.digital_read(17) == 1
    b.digital_write(17, 0)
    assert b.digital_read(17) == 0


def test_mock_backend_pwm_clamps():
    from raspi_service.gpio_backend import MockBackend
    b = MockBackend()
    b.pwm_write(18, 1.5)   # over 1.0
    assert b.pins[18]["value"] == 1.0
    b.pwm_write(18, -0.5)  # under 0.0
    assert b.pins[18]["value"] == 0.0


def test_mock_backend_i2c_surface_is_quiet():
    """Mock I2C never finds devices but does not raise — UI smoke
    against the mock should produce a well-formed empty result."""
    from raspi_service.gpio_backend import MockBackend
    b = MockBackend()
    assert b.i2c_scan() == []
    assert b.i2c_read(0x50, 0x00, 4) == [0, 0, 0, 0]
    b.i2c_write(0x50, [0x01, 0x02])  # no raise


def test_mock_backend_release_clears_pin_state():
    from raspi_service.gpio_backend import MockBackend
    b = MockBackend()
    b.set_pin_mode(17, "output")
    b.digital_write(17, 1)
    b.release(17)
    # Re-reads return 0 (no state)
    assert b.digital_read(17) == 0


# ─────────────────────────────────────────────────────────────────────
# open_backend picks the right concrete backend
# ─────────────────────────────────────────────────────────────────────


def test_open_backend_returns_mock_when_not_raspi():
    from raspi_service.gpio_backend import open_backend, MockBackend
    b = open_backend("mock")
    assert isinstance(b, MockBackend)


# ─────────────────────────────────────────────────────────────────────
# RaspiService @service_method handlers
# ─────────────────────────────────────────────────────────────────────


@pytest.fixture
def svc(monkeypatch):
    """Build a RaspiService with MockBackend, no live bus."""
    from raspi_service.service import RaspiService
    # rlx_bus.SubprocessService constructor takes (proxy_id, bus).
    bus = _FakeBus()
    s = RaspiService("raspi-1", bus)
    # Skip on_start (which would call detect_board + open_backend); set
    # backend directly so we can drive @service_methods.
    from raspi_service.gpio_backend import MockBackend
    s.backend = MockBackend()
    s.board = {"kind": "mock", "gpio_pins": list(range(2, 28))}
    # Replace update_config with a recorder
    s._update_config_calls: List[Dict[str, Any]] = []
    async def _record_update(patch):
        s._update_config_calls.append(patch)
        for k, v in patch.items():
            setattr(s.config, k, v)
    monkeypatch.setattr(s, "update_config", _record_update)
    return s


class _FakeBus:
    """Minimal stand-in for SubprocessService's BusClient."""
    def __init__(self) -> None:
        self.published: List[Dict[str, Any]] = []
    async def publish(self, topic: str, payload: Any, *, retained: bool = False) -> None:
        self.published.append({"topic": topic, "payload": payload, "retained": retained})
    async def subscribe(self, topic: str, handler) -> None:
        pass

    def by_topic_endswith(self, suffix: str) -> List[Dict[str, Any]]:
        return [m for m in self.published if m["topic"].endswith(suffix)]


@pytest.mark.asyncio
async def test_m_set_pin_mode_configures_backend_and_persists(svc):
    await svc.m_set_pin_mode(17, "output")
    assert svc.backend.pins[17]["mode"] == "output"
    # update_config called with pin_modes including pin 17
    assert any("pin_modes" in c and c["pin_modes"].get("17") == "output"
               for c in svc._update_config_calls)


@pytest.mark.asyncio
async def test_m_digital_write_publishes_to_pin_topic(svc):
    await svc.m_set_pin_mode(17, "output")
    svc.bus.published.clear()
    await svc.m_digital_write(17, 1)
    publishes_to_pin = [p for p in svc.bus.published if p["topic"].endswith("/pin/17")]
    assert publishes_to_pin == [{"topic": "/raspi/raspi-1/pin/17",
                                  "payload": {"value": 1}, "retained": False}]


@pytest.mark.asyncio
async def test_m_digital_read_returns_value(svc):
    await svc.m_set_pin_mode(17, "input")
    svc.backend.digital_write(17, 1)   # mock backend lets us "drive" the input
    result = await svc.m_digital_read(17)
    assert result == {"pin": 17, "value": 1}


@pytest.mark.asyncio
async def test_m_pwm_write_clamps_and_returns_duty(svc):
    await svc.m_set_pin_mode(18, "pwm")
    result = await svc.m_pwm_write(18, 0.42)
    assert result == {"pin": 18, "duty": 0.42}
    # And clamps above
    result2 = await svc.m_pwm_write(18, 99.9)
    assert result2["duty"] == 1.0


@pytest.mark.asyncio
async def test_m_release_pin_clears_state(svc):
    await svc.m_set_pin_mode(17, "output")
    await svc.m_release_pin(17)
    assert 17 not in svc.backend.pins
    # update_config recorded the removal
    last = svc._update_config_calls[-1]
    assert "17" not in (last.get("pin_modes") or {})


@pytest.mark.asyncio
async def test_m_i2c_scan_publishes_addresses(svc):
    result = await svc.m_i2c_scan(bus=1)
    assert result["bus"] == 1
    assert result["addresses"] == []   # mock backend has no devices
    scans = svc.bus.by_topic_endswith("/i2c/scan")
    assert scans and scans[-1]["payload"]["bus"] == 1


@pytest.mark.asyncio
async def test_m_i2c_read_returns_list(svc):
    result = await svc.m_i2c_read(addr=0x50, reg=0x00, count=4, bus=1)
    assert result == {"bus": 1, "addr": 0x50, "reg": 0x00, "data": [0, 0, 0, 0]}


# ─────────────────────────────────────────────────────────────────────
# Polling
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_poll_pin_fires_at_interval(svc):
    """Start a 50ms poll, let it tick a few times, then stop."""
    await svc.m_set_pin_mode(17, "input")
    svc.backend.digital_write(17, 1)
    await svc.m_poll_pin(pin=17, interval_ms=20)
    await asyncio.sleep(0.12)   # ~5 ticks
    await svc.m_stop_poll(pin=17)

    pin_publishes = [p for p in svc.bus.published if p["topic"].endswith("/pin/17")]
    # At least 2 publishes (one initial + one after first sleep)
    assert len(pin_publishes) >= 2
    for p in pin_publishes:
        assert p["payload"]["value"] == 1


@pytest.mark.asyncio
async def test_poll_pin_zero_interval_stops(svc):
    await svc.m_set_pin_mode(17, "input")
    await svc.m_poll_pin(pin=17, interval_ms=20)
    await asyncio.sleep(0.05)
    # interval_ms=0 → equivalent to stop_poll
    result = await svc.m_poll_pin(pin=17, interval_ms=0)
    assert result.get("polling") is False
    # Verify the task is gone
    assert 17 not in svc._poll_tasks or svc._poll_tasks[17].done()


@pytest.mark.asyncio
async def test_poll_pin_persists_to_config(svc):
    await svc.m_set_pin_mode(17, "input")
    await svc.m_poll_pin(pin=17, interval_ms=100)
    last = svc._update_config_calls[-1]
    assert last.get("pin_polls", {}).get("17") == 100
    await svc.m_stop_poll(pin=17)


# ─────────────────────────────────────────────────────────────────────
# Config schema
# ─────────────────────────────────────────────────────────────────────


def test_raspi_config_defaults():
    from raspi_service.service import RaspiConfig
    c = RaspiConfig()
    assert c.pin_modes == {}
    assert c.pin_polls == {}
    assert c.topic_remap == {}
