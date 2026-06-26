# unmanaged
"""Unit tests for the arduino_telemetrix subprocess service.

Covers the TelemetrixBoard wrapper (mocking telemetrix-aio) and the
ArduinoTelemetrixService @service_method actions (mocking the board AND
the bus). No serial port is opened — telemetrix-aio is replaced with a
FakeTelemetrix fixture so the tests run anywhere without hardware.

The service lives in its own subprocess venv with its own pyproject. We
add its src/ to sys.path so pytest can import it from the top-level
robotlab_x venv. The wrapper imports telemetrix-aio lazily inside
TelemetrixBoard.connect(), which lets us stub it via sys.modules just
before that import runs.
"""
from __future__ import annotations

import sys
import types
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import AsyncMock, MagicMock

import pytest

_TLM_SRC = Path(__file__).resolve().parents[1] / "repo" / "arduino_telemetrix" / "1.0.0" / "src"
if str(_TLM_SRC) not in sys.path:
    sys.path.insert(0, str(_TLM_SRC))


# ─────────────────────────────────────────────────────────────────────
# Fake telemetrix-aio
# ─────────────────────────────────────────────────────────────────────
class FakeTelemetrixBoard:
    """Stand-in for telemetrix_aio.TelemetrixAIO.

    Every board call the wrapper makes (start_aio, shutdown,
    set_pin_mode_*, servo_*, neopixel_*, pwm_write, i2c_*, …) is a
    coroutine in the real library, so missing attributes resolve to a
    cached AsyncMock — tests can assert against them. ``firmware_version``
    is a real list attribute (filled by start_aio in the real lib)."""

    def __init__(self, **kwargs: Any) -> None:
        self.constructed_with: Dict[str, Any] = kwargs
        self.firmware_version: List[int] = [1, 2]
        self._async: Dict[str, AsyncMock] = {}

    def __getattr__(self, name: str) -> AsyncMock:
        # Only fires for attributes not set in __init__ — i.e. the async
        # board methods. Cache so assertions see a stable mock.
        cache = self.__dict__.setdefault("_async", {})
        am = cache.get(name)
        if am is None:
            am = AsyncMock()
            cache[name] = am
        return am


class _FakeTelemetrixModule:
    """sys.modules['telemetrix_aio'] replacement.

    Real shape::

        from telemetrix_aio import telemetrix_aio
        board = telemetrix_aio.TelemetrixAIO(...)
    """

    def __init__(self, board_factory) -> None:
        self.telemetrix_aio = types.SimpleNamespace(TelemetrixAIO=board_factory)


def _install_fake_telemetrix(board_factory):
    fake = _FakeTelemetrixModule(board_factory)
    saved = (sys.modules.get("telemetrix_aio"), sys.modules.get("telemetrix_aio.telemetrix_aio"))
    sys.modules["telemetrix_aio"] = fake                       # type: ignore[assignment]
    sys.modules["telemetrix_aio.telemetrix_aio"] = fake.telemetrix_aio  # type: ignore[assignment]
    return saved


def _restore_telemetrix(saved) -> None:
    prev_top, prev_sub = saved
    for k, v in (("telemetrix_aio", prev_top), ("telemetrix_aio.telemetrix_aio", prev_sub)):
        if v is None:
            sys.modules.pop(k, None)
        else:
            sys.modules[k] = v


@pytest.fixture
def fake_telemetrix():
    class Controller:
        def __init__(self):
            self.next_board = FakeTelemetrixBoard()
            self.constructed_with: Dict[str, Any] = {}

        def __call__(self, *args, **kwargs):
            self.constructed_with = kwargs
            self.next_board.constructed_with = kwargs
            return self.next_board

    ctrl = Controller()
    saved = _install_fake_telemetrix(ctrl)
    try:
        yield ctrl
    finally:
        _restore_telemetrix(saved)


# ─────────────────────────────────────────────────────────────────────
# TelemetrixBoard wrapper tests
# ─────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_connect_starts_board_and_returns_info(fake_telemetrix):
    from arduino_telemetrix_service.telemetrix_wrapper import TelemetrixBoard
    board = TelemetrixBoard()
    info = await board.connect("/dev/ttyACM0", baud=115200)
    assert board.connected is True
    assert board.port == "/dev/ttyACM0"
    # start_aio() was awaited; constructor got our port + autostart=False
    fake_telemetrix.next_board.start_aio.assert_awaited_once()
    assert fake_telemetrix.constructed_with["com_port"] == "/dev/ttyACM0"
    assert fake_telemetrix.constructed_with["autostart"] is False
    assert info["firmware_version"] == "1.2"
    assert info["firmware_name"] == "Telemetrix4Arduino"


@pytest.mark.asyncio
async def test_connect_failure_propagates(fake_telemetrix):
    fake_telemetrix.next_board.start_aio = AsyncMock(side_effect=RuntimeError("no board found"))
    from arduino_telemetrix_service.telemetrix_wrapper import TelemetrixBoard
    board = TelemetrixBoard()
    with pytest.raises(RuntimeError, match="no board found"):
        await board.connect("/dev/ttyACM0")
    assert board.connected is False


@pytest.mark.asyncio
async def test_connect_replaces_existing_board(fake_telemetrix):
    from arduino_telemetrix_service.telemetrix_wrapper import TelemetrixBoard
    first = fake_telemetrix.next_board
    board = TelemetrixBoard()
    await board.connect("/dev/ttyACM0")
    fake_telemetrix.next_board = FakeTelemetrixBoard()
    await board.connect("/dev/ttyACM0")
    first.shutdown.assert_awaited_once()


@pytest.mark.asyncio
async def test_disconnect_clears_state(fake_telemetrix):
    from arduino_telemetrix_service.telemetrix_wrapper import TelemetrixBoard
    board = TelemetrixBoard()
    await board.connect("/dev/ttyACM0")
    underlying = fake_telemetrix.next_board
    await board.pixel_configure(6, 8)
    await board.disconnect()
    assert board.connected is False
    assert board.pins == {}
    assert board.pixel_pin is None
    assert board.pixel_count == 0
    underlying.shutdown.assert_awaited_once()


@pytest.mark.asyncio
async def test_require_raises_when_not_connected():
    from arduino_telemetrix_service.telemetrix_wrapper import TelemetrixBoard
    board = TelemetrixBoard()
    with pytest.raises(RuntimeError, match="not connected"):
        await board.digital_write(13, 1)


@pytest.mark.asyncio
async def test_servo_contract(fake_telemetrix):
    from arduino_telemetrix_service.telemetrix_wrapper import TelemetrixBoard
    board = TelemetrixBoard()
    await board.connect("/dev/ttyACM0")
    b = fake_telemetrix.next_board
    await board.servo_attach(9)
    b.set_pin_mode_servo.assert_awaited_with(9)
    assert board.pins[9]["mode"] == "servo"
    await board.servo_write(9, 999)  # clamps to 180
    b.servo_write.assert_awaited_with(9, 180)
    assert board.pins[9]["value"] == 180
    await board.servo_detach(9)
    b.servo_detach.assert_awaited_with(9)
    assert board.pins[9]["mode"] == "input"


@pytest.mark.asyncio
async def test_analog_write_clamps(fake_telemetrix):
    from arduino_telemetrix_service.telemetrix_wrapper import TelemetrixBoard
    board = TelemetrixBoard()
    await board.connect("/dev/ttyACM0")
    await board.analog_write(3, 999)
    fake_telemetrix.next_board.pwm_write.assert_awaited_with(3, 255)
    assert board.pins[3]["value"] == 255


# ─────────────────────────────────────────────────────────────────────
# pixel_strip wrapper tests
# ─────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_pixel_configure_sets_state(fake_telemetrix):
    from arduino_telemetrix_service.telemetrix_wrapper import TelemetrixBoard
    board = TelemetrixBoard()
    await board.connect("/dev/ttyACM0")
    await board.pixel_configure(6, 16, width=4, height=4, serpentine=True)
    fake_telemetrix.next_board.set_pin_mode_neopixel.assert_awaited_with(pin_number=6, num_pixels=16)
    assert board.pixel_pin == 6
    assert board.pixel_count == 16
    assert board.pixel_width == 4
    assert board.pixel_serpentine is True
    assert board.pixel_brightness == 255


@pytest.mark.asyncio
async def test_pixel_set_requires_configure(fake_telemetrix):
    from arduino_telemetrix_service.telemetrix_wrapper import TelemetrixBoard
    board = TelemetrixBoard()
    await board.connect("/dev/ttyACM0")
    with pytest.raises(RuntimeError, match="no pixel strip configured"):
        await board.pixel_set(0, 255, 0, 0)


@pytest.mark.asyncio
async def test_pixel_set_out_of_range(fake_telemetrix):
    from arduino_telemetrix_service.telemetrix_wrapper import TelemetrixBoard
    board = TelemetrixBoard()
    await board.connect("/dev/ttyACM0")
    await board.pixel_configure(6, 4)
    with pytest.raises(ValueError, match="out of range"):
        await board.pixel_set(4, 1, 2, 3)


@pytest.mark.asyncio
async def test_pixel_set_writes_and_buffers(fake_telemetrix):
    from arduino_telemetrix_service.telemetrix_wrapper import TelemetrixBoard
    board = TelemetrixBoard()
    await board.connect("/dev/ttyACM0")
    await board.pixel_configure(6, 4)
    await board.pixel_set(2, 255, 100, 50, show=True)
    fake_telemetrix.next_board.neopixel_set_value.assert_awaited_with(2, 255, 100, 50, auto_show=True)
    assert board._pixel_buf[2] == (255, 100, 50)


@pytest.mark.asyncio
async def test_pixel_set_xy_serpentine(fake_telemetrix):
    from arduino_telemetrix_service.telemetrix_wrapper import TelemetrixBoard
    board = TelemetrixBoard()
    await board.connect("/dev/ttyACM0")
    await board.pixel_configure(6, 8, width=4, height=2, serpentine=True)
    # row 1 is reversed: (x=0,y=1) → x'=3 → index 1*4+3 = 7
    await board.pixel_set_xy(0, 1, 10, 20, 30, show=False)
    fake_telemetrix.next_board.neopixel_set_value.assert_awaited_with(7, 10, 20, 30, auto_show=False)


@pytest.mark.asyncio
async def test_pixel_fill_and_clear(fake_telemetrix):
    from arduino_telemetrix_service.telemetrix_wrapper import TelemetrixBoard
    board = TelemetrixBoard()
    await board.connect("/dev/ttyACM0")
    await board.pixel_configure(6, 3)
    await board.pixel_fill(9, 8, 7)
    fake_telemetrix.next_board.neopixel_fill.assert_awaited_with(9, 8, 7, auto_show=True)
    assert board._pixel_buf == [(9, 8, 7)] * 3
    await board.pixel_clear()
    fake_telemetrix.next_board.neopixel_clear.assert_awaited_with(auto_show=True)
    assert board._pixel_buf == [(0, 0, 0)] * 3


@pytest.mark.asyncio
async def test_pixel_brightness_rescales_buffer(fake_telemetrix):
    from arduino_telemetrix_service.telemetrix_wrapper import TelemetrixBoard
    board = TelemetrixBoard()
    await board.connect("/dev/ttyACM0")
    await board.pixel_configure(6, 2)
    await board.pixel_set(0, 200, 100, 50, show=False)
    b = fake_telemetrix.next_board
    b.neopixel_set_value.reset_mock()
    await board.pixel_set_brightness(128)
    # raw (200,100,50) scaled by 128/255 → (100,50,25)
    b.neopixel_set_value.assert_any_await(0, 100, 50, 25, auto_show=False)
    b.neopixel_show.assert_awaited()
    assert board.pixel_brightness == 128


# ─────────────────────────────────────────────────────────────────────
# Service method tests
# ─────────────────────────────────────────────────────────────────────
class _FakeBus:
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
    from arduino_telemetrix_service.service import ArduinoTelemetrixService

    svc = ArduinoTelemetrixService("tlm-test", _FakeBus())
    svc.board = MagicMock()
    svc.board.connected = False
    svc.board.port = None
    svc.board.pins = {}
    svc.board.pixel_pin = None
    svc.board.pixel_count = 0
    svc.board.pixel_width = 0
    svc.board.pixel_height = 0
    svc.board.pixel_serpentine = False
    svc.board.pixel_brightness = 255
    for name in (
        "connect", "disconnect", "set_pin_mode", "digital_write", "analog_write",
        "servo_attach", "servo_write", "servo_detach",
        "pixel_configure", "pixel_set", "pixel_set_xy", "pixel_fill",
        "pixel_clear", "pixel_show", "pixel_set_brightness",
        "sonar_setup",
    ):
        setattr(svc.board, name, AsyncMock())
    svc.board.digital_read = AsyncMock(return_value=1)
    svc.board.analog_read = AsyncMock(return_value=512)
    svc.board.sonar_read = AsyncMock(return_value=42.5)

    svc._update_config_calls: List[Dict[str, Any]] = []  # type: ignore[attr-defined]
    async def _record_update(patch):
        svc._update_config_calls.append(patch)  # type: ignore[attr-defined]
        for k, v in patch.items():
            setattr(svc.config, k, v)
    monkeypatch.setattr(svc, "update_config", _record_update)
    return svc


@pytest.mark.asyncio
async def test_m_connect_persists_and_publishes(service):
    INFO = {"firmware_name": "Telemetrix4Arduino", "firmware_version": "1.2"}
    def _post_connect(*a, **k):
        service.board.connected = True
        service.board.port = "/dev/ttyACM0"
        return INFO
    service.board.connect = AsyncMock(side_effect=_post_connect)
    result = await service.m_connect("/dev/ttyACM0", 115200)
    assert result["firmware_name"] == "Telemetrix4Arduino"
    assert service._update_config_calls == [
        {"last_port": "/dev/ttyACM0", "last_baud": 115200, "autoreconnect": True}
    ]
    states = service.bus.by_topic_suffix("/state")
    assert states[-1]["retained"] is True
    assert states[-1]["payload"]["connected"] is True


@pytest.mark.asyncio
async def test_m_connect_failure_publishes_error(service):
    service.board.connect = AsyncMock(side_effect=RuntimeError("no board found"))
    result = await service.m_connect("/dev/ttyACM0")
    assert result["connected"] is False
    assert "no board found" in result["error"]
    states = service.bus.by_topic_suffix("/state")
    assert states[-1]["payload"]["connect_error"].startswith("RuntimeError:")
    assert service._update_config_calls == []


@pytest.mark.asyncio
async def test_snapshot_includes_pixel_block(service):
    service.board.pixel_pin = 6
    service.board.pixel_count = 16
    service.board.pixel_width = 4
    service.board.pixel_height = 4
    service.board.pixel_serpentine = True
    service.board.pixel_brightness = 200
    snap = service._snapshot()
    assert snap["pixel"] == {
        "pin": 6, "count": 16, "width": 4, "height": 4,
        "serpentine": True, "brightness": 200,
    }


@pytest.mark.asyncio
async def test_m_servo_write_publishes_pin_topic(service):
    service.board.connected = True
    await service.m_servo_write(9, 90)
    service.board.servo_write.assert_awaited_with(9, 90)
    pin = [m for m in service.bus.published if "/pin/9" in m["topic"]]
    assert pin == [{"topic": pin[0]["topic"], "payload": {"value": 90}, "retained": False}]


@pytest.mark.asyncio
async def test_m_pixel_configure_routes_and_publishes_state(service):
    result = await service.m_pixel_configure(6, 16, 4, 4, True)
    service.board.pixel_configure.assert_awaited_with(6, 16, 4, 4, True)
    assert result["count"] == 16
    assert service.bus.by_topic_suffix("/state")


@pytest.mark.asyncio
async def test_m_pixel_set_routes(service):
    result = await service.m_pixel_set(2, 255, 100, 50, True)
    service.board.pixel_set.assert_awaited_with(2, 255, 100, 50, True)
    assert result == {"index": 2, "rgb": [255, 100, 50]}


@pytest.mark.asyncio
async def test_m_pixel_fill_and_clear_route(service):
    await service.m_pixel_fill(1, 2, 3, True)
    service.board.pixel_fill.assert_awaited_with(1, 2, 3, True)
    await service.m_pixel_clear()
    service.board.pixel_clear.assert_awaited_with(True)


@pytest.mark.asyncio
async def test_m_pixel_brightness_routes_and_publishes(service):
    result = await service.m_pixel_set_brightness(128)
    service.board.pixel_set_brightness.assert_awaited_with(128)
    assert result == {"brightness": 128}
    assert service.bus.by_topic_suffix("/state")


# ─────────────────────────────────────────────────────────────────────
# Config schema
# ─────────────────────────────────────────────────────────────────────
def test_config_defaults():
    from arduino_telemetrix_service.service import ArduinoTelemetrixConfig
    c = ArduinoTelemetrixConfig()
    assert c.last_port is None
    assert c.last_baud == 115200
    assert c.autoreconnect is False
