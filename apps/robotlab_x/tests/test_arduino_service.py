# unmanaged
"""Unit tests for the arduino subprocess service.

Covers the ArduinoBoard wrapper (mocking pymata4) and the ArduinoService
@service_method actions (mocking the board AND the bus). No serial port
is opened — pymata4 is replaced with a FakePymata4 fixture so the tests
run anywhere without hardware.

The arduino service lives in its own subprocess venv with its own
pyproject. We add its src/ to sys.path here so pytest can import it from
the top-level robotlab_x venv. The wrapper imports pymata4 lazily inside
ArduinoBoard.connect(), which lets us stub it via sys.modules just before
that import runs.
"""
from __future__ import annotations

import asyncio
import sys
import types
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import AsyncMock, MagicMock

import pytest

# Make arduino_service importable from the top-level test venv. The real
# subprocess venv has pymata4 + pyserial; this venv doesn't, so we stub
# both before importing the service code.
_ARDUINO_SRC = Path(__file__).resolve().parents[1] / "repo" / "arduino" / "1.0.0" / "src"
if str(_ARDUINO_SRC) not in sys.path:
    sys.path.insert(0, str(_ARDUINO_SRC))


# ─────────────────────────────────────────────────────────────────────
# Module-level stubs
# ─────────────────────────────────────────────────────────────────────
# `serial.tools.list_ports` is imported lazily inside detect_ports() and
# its ImportError is already handled — no stub needed.
# `pymata4` is imported lazily inside ArduinoBoard.connect(). The
# FakePymata4 fixture below installs a stub into sys.modules per test so
# each test can control what the wrapper sees.


class _FakePymata4Module:
    """sys.modules['pymata4'] replacement.

    The real shape is::

        from pymata4 import pymata4
        board = pymata4.Pymata4(...)

    so we need a top-level module that has a `pymata4` attribute that
    in turn has a `Pymata4` callable.
    """

    def __init__(self, board_factory) -> None:
        inner = types.SimpleNamespace(Pymata4=board_factory)
        self.pymata4 = inner


def _install_fake_pymata4(board_factory):
    """Insert a FakePymata4 module into sys.modules.

    Returns the modules dict's prior value so the test fixture can
    restore it on teardown. Stub both 'pymata4' (top-level) and
    'pymata4.pymata4' (submodule access) since the wrapper writes
    ``from pymata4 import pymata4``.
    """
    fake = _FakePymata4Module(board_factory)
    saved = (sys.modules.get("pymata4"), sys.modules.get("pymata4.pymata4"))
    sys.modules["pymata4"] = fake               # type: ignore[assignment]
    sys.modules["pymata4.pymata4"] = fake.pymata4  # type: ignore[assignment]
    return saved


def _restore_pymata4(saved) -> None:
    prev_top, prev_sub = saved
    for k, v in (("pymata4", prev_top), ("pymata4.pymata4", prev_sub)):
        if v is None:
            sys.modules.pop(k, None)
        else:
            sys.modules[k] = v


@pytest.fixture
def fake_pymata():
    """Yield a controller that builds the next FakePymata4 board instance.

    Each test sets ``controller.next_board`` (a MagicMock with the
    pymata4 methods the wrapper calls) before invoking connect(). The
    fixture cleans up sys.modules afterwards.
    """
    class Controller:
        def __init__(self):
            self.next_board: MagicMock = self._default_board()
            self.constructed_with: Dict[str, Any] = {}

        def _default_board(self) -> MagicMock:
            b = MagicMock()
            b.get_firmware_version.return_value = "1.2 FirmataExpress.ino"
            b.get_protocol_version.return_value = (2, 5)
            return b

        def __call__(self, *args, **kwargs):
            self.constructed_with = kwargs
            return self.next_board

    ctrl = Controller()
    saved = _install_fake_pymata4(ctrl)
    try:
        yield ctrl
    finally:
        _restore_pymata4(saved)


# ─────────────────────────────────────────────────────────────────────
# ArduinoBoard wrapper tests
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_connect_returns_board_info(fake_pymata):
    from arduino_service.pymata_wrapper import ArduinoBoard
    board = ArduinoBoard()
    info = await board.connect("/dev/ttyACM0", baud=115200)
    assert board.connected is True
    assert board.port == "/dev/ttyACM0"
    assert board.baud == 115200
    # "1.2 FirmataExpress.ino" → version="1.2", name="FirmataExpress.ino"
    assert info["firmware_version"] == "1.2"
    assert info["firmware_name"] == "FirmataExpress.ino"
    assert info["firmata_version"] == "2.5"
    # constructor received the right args
    assert fake_pymata.constructed_with["com_port"] == "/dev/ttyACM0"
    assert fake_pymata.constructed_with["baud_rate"] == 115200


@pytest.mark.asyncio
async def test_firmware_unparseable_falls_back_to_raw(fake_pymata):
    """If pymata4 returns something that doesn't match the expected
    "<version> <name>" shape, both fields should still surface the raw
    string rather than collapsing to None."""
    fake_pymata.next_board.get_firmware_version.return_value = "MysteryFirmware"
    from arduino_service.pymata_wrapper import ArduinoBoard
    info = await ArduinoBoard().connect("/dev/ttyACM0", baud=57600)
    assert info["firmware_name"] == "MysteryFirmware"
    assert info["firmware_version"] == "MysteryFirmware"


@pytest.mark.asyncio
async def test_connect_replaces_existing_board(fake_pymata):
    """A second connect() should shut down the old board first."""
    from arduino_service.pymata_wrapper import ArduinoBoard
    first = fake_pymata.next_board
    board = ArduinoBoard()
    await board.connect("/dev/ttyACM0")
    # Now connect again with a different fake; old one should get shutdown.
    fake_pymata.next_board = MagicMock()
    fake_pymata.next_board.get_firmware_version.return_value = "2.0 X"
    fake_pymata.next_board.get_protocol_version.return_value = (2, 6)
    await board.connect("/dev/ttyACM0")
    first.shutdown.assert_called_once()


@pytest.mark.asyncio
async def test_connect_pymata_failure_propagates(fake_pymata):
    def _explode(**kwargs):
        raise RuntimeError("Firmata Sketch Firmware Version Not Found")
    saved = _install_fake_pymata4(_explode)
    try:
        from arduino_service.pymata_wrapper import ArduinoBoard
        board = ArduinoBoard()
        with pytest.raises(RuntimeError, match="Firmware Version Not Found"):
            await board.connect("/dev/ttyACM0")
        assert board.connected is False
    finally:
        _restore_pymata4(saved)


@pytest.mark.asyncio
async def test_disconnect_clears_state(fake_pymata):
    from arduino_service.pymata_wrapper import ArduinoBoard
    board = ArduinoBoard()
    await board.connect("/dev/ttyACM0")
    underlying = fake_pymata.next_board
    await board.disconnect()
    assert board.connected is False
    assert board.pins == {}
    underlying.shutdown.assert_called_once()


@pytest.mark.asyncio
async def test_digital_write_caches_value(fake_pymata):
    from arduino_service.pymata_wrapper import ArduinoBoard
    board = ArduinoBoard()
    await board.connect("/dev/ttyACM0")
    await board.digital_write(13, 1)
    assert board.pins[13]["value"] == 1
    fake_pymata.next_board.digital_write.assert_called_with(13, 1)


@pytest.mark.asyncio
async def test_digital_read_returns_int_from_tuple(fake_pymata):
    """pymata4 returns (value, timestamp); wrapper should unpack."""
    from arduino_service.pymata_wrapper import ArduinoBoard
    board = ArduinoBoard()
    await board.connect("/dev/ttyACM0")
    fake_pymata.next_board.digital_read.return_value = (1, 12345)
    v = await board.digital_read(5)
    assert v == 1
    assert board.pins[5]["value"] == 1


@pytest.mark.asyncio
async def test_analog_read_returns_int(fake_pymata):
    from arduino_service.pymata_wrapper import ArduinoBoard
    board = ArduinoBoard()
    await board.connect("/dev/ttyACM0")
    fake_pymata.next_board.analog_read.return_value = (512, 1)
    v = await board.analog_read(0)
    assert v == 512
    assert board.pins[0]["value"] == 512


@pytest.mark.asyncio
async def test_set_pin_mode_unknown_raises(fake_pymata):
    from arduino_service.pymata_wrapper import ArduinoBoard
    board = ArduinoBoard()
    await board.connect("/dev/ttyACM0")
    with pytest.raises(ValueError, match="unknown pin mode"):
        await board.set_pin_mode(13, "tachyon")


@pytest.mark.asyncio
async def test_set_pin_mode_maps_to_pymata_setter(fake_pymata):
    from arduino_service.pymata_wrapper import ArduinoBoard
    board = ArduinoBoard()
    await board.connect("/dev/ttyACM0")
    await board.set_pin_mode(13, "output")
    fake_pymata.next_board.set_pin_mode_digital_output.assert_called_with(13)
    assert board.pins[13]["mode"] == "output"


@pytest.mark.asyncio
async def test_analog_write_clamps_to_byte_range(fake_pymata):
    from arduino_service.pymata_wrapper import ArduinoBoard
    board = ArduinoBoard()
    await board.connect("/dev/ttyACM0")
    await board.analog_write(9, 999)
    fake_pymata.next_board.pwm_write.assert_called_with(9, 255)
    assert board.pins[9]["value"] == 255


@pytest.mark.asyncio
async def test_require_raises_when_not_connected():
    """Calls before connect() must raise — no silent no-op."""
    from arduino_service.pymata_wrapper import ArduinoBoard
    board = ArduinoBoard()
    with pytest.raises(RuntimeError, match="not connected"):
        await board.digital_write(13, 1)


# ─────────────────────────────────────────────────────────────────────
# ArduinoService method tests
# ─────────────────────────────────────────────────────────────────────


class _FakeBus:
    """Minimal stand-in for the SubprocessService's BusClient.

    Records every publish so tests can assert about topic + retained
    flag. Mirrors the methods the service actually calls.
    """

    def __init__(self) -> None:
        self.published: List[Dict[str, Any]] = []
        self.subscribed: List[str] = []

    async def publish(self, topic: str, payload: Any, *, retained: bool = False) -> None:
        self.published.append({"topic": topic, "payload": payload, "retained": retained})

    async def subscribe(self, topic: str, handler):
        self.subscribed.append(topic)

    def by_topic_suffix(self, suffix: str) -> List[Dict[str, Any]]:
        return [m for m in self.published if m["topic"].endswith(suffix)]


@pytest.fixture
def service(monkeypatch):
    """Build an ArduinoService with a mocked ArduinoBoard + FakeBus.

    Patches ``update_config`` to a no-op recorder so we don't try to
    write a config_patch through the (real) bus.
    """
    # Import inside the fixture so the per-test fake_pymata stubbing
    # doesn't interact with the module-level import here.
    from arduino_service.service import ArduinoService

    svc = ArduinoService("arduino-test", _FakeBus())
    # Replace board with a fully mocked AsyncMock.
    svc.board = MagicMock()
    svc.board.connected = False
    svc.board.port = None
    svc.board.pins = {}
    svc.board.connect = AsyncMock()
    svc.board.disconnect = AsyncMock()
    svc.board.set_pin_mode = AsyncMock()
    svc.board.digital_write = AsyncMock()
    svc.board.digital_read = AsyncMock(return_value=1)
    svc.board.analog_read = AsyncMock(return_value=512)
    svc.board.analog_write = AsyncMock()
    svc.board.sonar_setup = AsyncMock()
    svc.board.sonar_read = AsyncMock(return_value=42.5)
    # update_config writes to the bus + persists — short-circuit to a recorder
    svc._update_config_calls: List[Dict[str, Any]] = []  # type: ignore[attr-defined]
    async def _record_update(patch):
        svc._update_config_calls.append(patch)  # type: ignore[attr-defined]
        for k, v in patch.items():
            setattr(svc.config, k, v)
    monkeypatch.setattr(svc, "update_config", _record_update)
    return svc


@pytest.mark.asyncio
async def test_m_connect_publishes_state_and_saves_config(service):
    """Happy path: connect calls board.connect, persists last_port/baud, publishes /state."""
    INFO = {
        "firmware_name": "FirmataExpress.ino",
        "firmware_version": "1.2",
        "firmata_version": "2.5",
        "port": "/dev/ttyACM0",
        "baud": 115200,
    }
    # board.connect() returns INFO AND flips its `connected` flag — that's
    # how the real ArduinoBoard behaves. Encode that in one side_effect.
    def _post_connect(*args, **kwargs):
        service.board.connected = True
        service.board.port = "/dev/ttyACM0"
        return INFO
    service.board.connect = AsyncMock(side_effect=_post_connect)

    result = await service.m_connect("/dev/ttyACM0", 115200)
    assert result["firmata_version"] == "2.5"
    # config persisted via update_config
    assert service._update_config_calls == [{"last_port": "/dev/ttyACM0", "last_baud": 115200, "autoreconnect": True}]
    # /state retained publish
    states = service.bus.by_topic_suffix("/state")
    assert len(states) >= 1
    final = states[-1]
    assert final["retained"] is True
    assert final["payload"]["connected"] is True
    assert final["payload"]["firmata_version"] == "2.5"


@pytest.mark.asyncio
async def test_m_connect_failure_publishes_error_state(service):
    """Connect failure is SURVIVABLE — m_connect returns a structured
    error envelope (it no longer re-raises; see its docstring) and
    publishes /state with connect_error so the UI can render it. Nothing
    is persisted on a failed connect (autoreconnect stays untouched)."""
    service.board.connect = AsyncMock(side_effect=RuntimeError("Firmata Sketch Firmware Version Not Found"))
    result = await service.m_connect("/dev/ttyACM0", 115200)
    assert result["connected"] is False
    assert "Firmware Version Not Found" in result["error"]
    states = service.bus.by_topic_suffix("/state")
    assert states[-1]["retained"] is True
    assert states[-1]["payload"]["connect_error"].startswith("RuntimeError:")
    assert service._update_config_calls == []


@pytest.mark.asyncio
async def test_m_disconnect_clears_info_and_publishes_state(service):
    service.board.connected = True
    service._info = {"firmata_version": "2.5"}
    # disconnect() flips connected → False
    async def _do_disconnect():
        service.board.connected = False
    service.board.disconnect = AsyncMock(side_effect=_do_disconnect)

    result = await service.m_disconnect()
    assert result == {"connected": False}
    assert service._info == {}
    states = service.bus.by_topic_suffix("/state")
    assert states[-1]["payload"]["connected"] is False


@pytest.mark.asyncio
async def test_m_digital_write_publishes_to_pin_topic(service):
    service.board.connected = True
    await service.m_digital_write(13, 1)
    pin_publishes = [m for m in service.bus.published if "/pin/13" in m["topic"]]
    assert len(pin_publishes) == 1
    assert pin_publishes[0]["payload"] == {"value": 1}


@pytest.mark.asyncio
async def test_m_set_pin_mode_publishes_state(service):
    service.board.connected = True
    await service.m_set_pin_mode(13, "output")
    service.board.set_pin_mode.assert_called_with(13, "output")
    # /state published after mode set
    assert service.bus.by_topic_suffix("/state"), "expected /state publish after set_pin_mode"


@pytest.mark.asyncio
async def test_m_sonar_read_publishes_distance(service):
    service.board.connected = True
    result = await service.m_sonar_read(7)
    assert result == {"trigger": 7, "distance_cm": 42.5}
    sonar = [m for m in service.bus.published if "/sonar/7" in m["topic"]]
    assert sonar == [{"topic": sonar[0]["topic"], "payload": {"distance_cm": 42.5}, "retained": False}]


@pytest.mark.asyncio
async def test_m_list_ports_returns_list(service):
    """detect_ports() reads pyserial — without it installed we expect [].

    The point of this test is that the method returns a structured dict,
    doesn't crash, and publishes /state.
    """
    result = await service.m_list_ports()
    assert "ports" in result
    assert isinstance(result["ports"], list)
    assert service.bus.by_topic_suffix("/state"), "expected /state publish"


# ─────────────────────────────────────────────────────────────────────
# ArduinoConfig schema test
# ─────────────────────────────────────────────────────────────────────


def test_arduino_config_defaults():
    from arduino_service.service import ArduinoConfig
    c = ArduinoConfig()
    assert c.last_port is None
    assert c.last_baud == 115200
    assert c.autoreconnect is False


def test_arduino_config_validates_baud_type():
    """last_baud is an int — strings that parse should be coerced, others rejected."""
    from arduino_service.service import ArduinoConfig
    c = ArduinoConfig(last_port="/dev/ttyACM0", last_baud=115200)
    assert c.last_baud == 115200
    # Pydantic v2 coerces numeric strings by default
    c2 = ArduinoConfig(last_baud="115200")
    assert c2.last_baud == 115200
