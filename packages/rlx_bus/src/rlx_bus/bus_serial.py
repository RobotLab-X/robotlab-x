"""Bus-backed serial port — a pyserial-compatible object whose
reads + writes flow through a robotlab_x ``serial`` service rather
than the OS device directly.

Why
---
Two services that both want to talk to the same physical Arduino
can't both own ``/dev/ttyACM0`` (one of them gets ``EBUSY`` thanks
to the exclusive-mode lock in port_io.py). The fix is to let ONE
service (the ``serial`` service) own the OS port and have other
services consume the same byte stream by configuration:

    arduino-1   ──▶  bus:serial-1   ──▶  serial-1   ──▶  /dev/ttyACM0
              writes bytes        reads bytes        owns port

The serial service publishes RX bytes on ``/serial/<id>/rx`` and
accepts ``write_bytes`` actions on ``/serial/<id>/control``. This
class wraps both into the pyserial API surface pymata4 (and similar
libraries) expect.

How
---
pymata4 calls ``serial.Serial(port, baud, ...)`` from its own
thread and then ``read()`` / ``write()`` from a producer/consumer
pair. The asyncio bus client runs in the main loop. So this class
bridges by:

  * Subscribing to ``/serial/<id>/rx`` from the bus loop. Callback
    appends bytes to a shared ``bytearray`` under a
    ``threading.Condition``.
  * ``read(size)`` runs on pymata4's blocking thread — acquires
    the condition, waits until at least ``size`` bytes are
    available OR the configured timeout elapses, slices + returns.
  * ``write(data)`` schedules an async ``bus.publish(...)`` via
    ``run_coroutine_threadsafe`` and waits briefly for it to send.

URL string format: ``bus:<proxy-id>``. The caller is responsible
for stripping the prefix before passing to this constructor.

Limitations / caveats
---------------------
  * Bytes are coalesced both ways. Min RTT ≈ 20ms on top of normal
    serial latency. Fine for firmata at 115200 baud (typical 1-3
    byte commands) but slow for tight, latency-sensitive loops.
  * No DTR / RTS control yet. Most firmata sketches don't need it
    because they're already past the reset window by the time
    arduino re-connects.
  * Configurable framing (baud, parity, etc.) is IGNORED — the
    real port's framing is whatever the serial service is set to.
    Mismatched baud is a per-service configuration concern.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import threading
import time
from typing import Any, Optional


logger = logging.getLogger(__name__)


# How long write() waits for the underlying bus.publish() to ack
# before giving up. Bus publishes are normally <10ms; 1s is a
# generous ceiling that catches "the bus is gone" without making
# pymata4's writer thread hang on shutdown.
_WRITE_PUBLISH_TIMEOUT_S = 1.0


class BusBackedSerial:
    """pyserial-shaped object backed by a bus serial proxy.

    The constructor accepts (and ignores) extra positional / keyword
    args so it's drop-in compatible with ``serial.Serial(...)`` call
    sites in third-party libraries (pymata4 passes baud_rate,
    timeout, writeTimeout). The framing args are stored for
    introspection but don't affect behaviour — see module docstring.
    """

    def __init__(
        self,
        bus: Any,                       # rlx_bus.BusClient — typed Any to dodge the import cycle
        proxy_id: str,
        baudrate: int = 115200,
        timeout: Optional[float] = 1.0,
        writeTimeout: Optional[float] = None,  # noqa: N803 — pyserial casing
        loop: Optional[asyncio.AbstractEventLoop] = None,
        **_ignored: Any,
    ) -> None:
        if not proxy_id:
            raise ValueError("BusBackedSerial requires a non-empty proxy_id")
        self._bus = bus
        self._proxy_id = str(proxy_id)
        self._baudrate = int(baudrate)
        # pyserial uses ``None`` for blocking-forever and a float for
        # bounded blocking. Mirror that semantics.
        self._timeout: Optional[float] = timeout
        self._write_timeout: Optional[float] = writeTimeout

        # The asyncio loop the bus client runs in. We need to
        # schedule subscribes/publishes onto it from outside its
        # thread. Caller can supply it explicitly; otherwise we grab
        # the running loop at construction (which is the right one
        # for the typical case where the SubprocessService creates
        # us from its own coroutine).
        if loop is None:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                # Construction from a thread without a running loop —
                # pymata4 sometimes does this. Caller must call
                # ``attach_loop`` before any I/O. Log so missing
                # attachment is loud.
                logger.warning(
                    "BusBackedSerial(%s): no running loop at construction; "
                    "must call attach_loop() before I/O", self._proxy_id,
                )
        self._loop = loop

        # RX accumulator. The bus subscription appends here from the
        # asyncio loop; read() drains it from the consumer thread.
        # ``Condition`` lets us wait + signal without polling.
        self._buf = bytearray()
        self._cv = threading.Condition()
        # Set True when the bus reports the upstream serial service
        # has disconnected. read() returns empty bytes when both
        # buffer is empty AND upstream is down — pymata4 treats this
        # as "no data" and the operator can disconnect cleanly.
        self._upstream_down = False
        self._closed = False
        # Subscribe-ready gate. Until the subscribe frame is ACKed by
        # the runtime AND the subscriber is registered on the bus
        # side, any /rx publishes go to subscribers that DOESN'T
        # include us — they're lost forever (rx is non-retained). A
        # write that happens before this is ready can produce a
        # board reply we never see. ``write()`` blocks on this event
        # so the first byte out the door is guaranteed to find a
        # ready subscription downstream.
        self._sub_ready = threading.Event()

        # Topics — derived once.
        self._rx_topic = f"/serial/{self._proxy_id}/rx"
        self._state_topic = f"/serial/{self._proxy_id}/state"
        self._control_topic = f"/serial/{self._proxy_id}/control"

        # Open immediately — pyserial's Serial() opens unless
        # ``do_not_open=True`` is passed. We don't bother modelling
        # the closed state.
        if self._loop is not None:
            self._subscribe_via_loop()

    # ─── pyserial API surface ────────────────────────────────────────

    @property
    def is_open(self) -> bool:
        return not self._closed

    @property
    def port(self) -> str:
        return f"bus:{self._proxy_id}"

    @property
    def baudrate(self) -> int:
        return self._baudrate

    @baudrate.setter
    def baudrate(self, value: int) -> None:
        self._baudrate = int(value)

    @property
    def timeout(self) -> Optional[float]:
        return self._timeout

    @timeout.setter
    def timeout(self, value: Optional[float]) -> None:
        self._timeout = value

    @property
    def in_waiting(self) -> int:
        with self._cv:
            return len(self._buf)

    def inWaiting(self) -> int:  # noqa: N802  — legacy pyserial method
        """Legacy alias for ``in_waiting``. pymata4 (and other older
        consumers) call ``inWaiting()`` as a method, not the modern
        ``in_waiting`` property. Without this, pymata4's
        ``_serial_receiver`` thread silently AttributeError's on
        every loop iteration (it's a daemon thread, exception
        eaten), no bytes get buffered, and the firmware-version
        query times out with the misleading "Firmata Sketch
        Firmware Version Not Found"."""
        return self.in_waiting

    def read(self, size: int = 1) -> bytes:
        """Block until ``size`` bytes are available or ``timeout``
        elapses. Returns whatever's available — possibly fewer than
        ``size`` bytes on timeout, including an empty ``b""``."""
        if size <= 0 or self._closed:
            return b""
        deadline = (time.monotonic() + self._timeout) if self._timeout is not None else None
        with self._cv:
            while not self._closed and len(self._buf) < size:
                # Upstream gone + buffer empty → return whatever we've
                # got. pymata4 reads this as "no data, retry later".
                if self._upstream_down and not self._buf:
                    break
                if deadline is None:
                    self._cv.wait()
                else:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        break
                    self._cv.wait(timeout=remaining)
            take = min(size, len(self._buf))
            out = bytes(self._buf[:take])
            del self._buf[:take]
        return out

    def read_all(self) -> bytes:
        """Return everything currently buffered. Non-blocking — used
        by pymata4 for sysex drains. pyserial calls this
        ``read_all`` (with no underscore separator)."""
        with self._cv:
            out = bytes(self._buf)
            self._buf.clear()
        return out

    def read_until(
        self,
        expected: bytes = b"\n",
        size: Optional[int] = None,
    ) -> bytes:
        """Block until ``expected`` is found OR ``size`` bytes have
        accumulated OR ``timeout`` elapses. Used by pymata4 to
        consume sysex frames (terminator ``\\xf7``).
        """
        if self._closed:
            return b""
        deadline = (time.monotonic() + self._timeout) if self._timeout is not None else None
        out = bytearray()
        # Match pyserial: ``expected`` may be a multi-byte sequence
        # — we scan ``out`` for it after each chunk read in.
        while not self._closed:
            if size is not None and len(out) >= size:
                break
            chunk_size = 1 if size is None else max(1, size - len(out))
            remaining = None if deadline is None else max(0.0, deadline - time.monotonic())
            if remaining is not None and remaining <= 0:
                break
            # Reuse self.read which already respects deadline +
            # condition wait — we just need to keep accumulating.
            prev_timeout = self._timeout
            try:
                self._timeout = remaining
                chunk = self.read(chunk_size)
            finally:
                self._timeout = prev_timeout
            if not chunk:
                # Timeout / EOF.
                break
            out.extend(chunk)
            if expected and expected in out:
                break
        return bytes(out)

    def write(self, data: bytes) -> int:
        """Publish ``data`` to the serial service's control topic and
        return the byte count written. Blocking only for the bus
        publish; the actual port write happens server-side.

        First call also blocks (briefly) on ``_sub_ready`` — the
        flag set by ``_do_subscribe`` once the subscribe ack lands.
        Otherwise the very first write would race the subscribe and
        the board's reply could be published to a runtime that
        hasn't registered us yet (rx is non-retained, no replay).
        Bounded by the subscribe ack_timeout (~4s) so a hung
        runtime doesn't hang the write forever.
        """
        if self._closed:
            raise RuntimeError(f"BusBackedSerial(bus:{self._proxy_id}) is closed")
        if not data:
            return 0
        if self._loop is None:
            raise RuntimeError(
                f"BusBackedSerial(bus:{self._proxy_id}): no asyncio loop attached"
            )
        # Gate the first write on subscribe-registration. Subsequent
        # writes find the event already set (zero-cost ``wait``).
        if not self._sub_ready.wait(timeout=5.0):
            logger.warning(
                "BusBackedSerial(bus:%s): subscribe not confirmed within 5s, "
                "writing anyway — reply may be dropped",
                self._proxy_id,
            )
        payload = {
            "action": "write_bytes",
            "data": base64.b64encode(bytes(data)).decode("ascii"),
        }
        fut = asyncio.run_coroutine_threadsafe(
            self._bus.publish(self._control_topic, payload),
            self._loop,
        )
        try:
            fut.result(timeout=_WRITE_PUBLISH_TIMEOUT_S)
        except Exception:  # noqa: BLE001
            # Best-effort — log and report the bytes as "written"
            # anyway. The upstream may still process the publish if
            # it lands shortly after the timeout; the alternative
            # (re-queueing) introduces its own ordering issues.
            logger.exception(
                "BusBackedSerial(bus:%s): write publish failed",
                self._proxy_id,
            )
        return len(data)

    def flush(self) -> None:
        """No-op. Writes are fire-and-forget via the bus; the
        serial service serialises them on the OS side."""
        return None

    def reset_input_buffer(self) -> None:
        with self._cv:
            self._buf.clear()

    def reset_output_buffer(self) -> None:
        # No client-side outbound queue — writes go straight to the
        # bus. Nothing to reset.
        return None

    def close(self) -> None:
        """Mark closed + wake any blocked read(). The BusClient
        doesn't expose unsubscribe (handlers are keyed by topic and
        replaced, not removed); our handlers gate on ``_closed`` so
        any late callbacks just no-op."""
        if self._closed:
            return
        self._closed = True
        with self._cv:
            self._cv.notify_all()

    # ─── internals ──────────────────────────────────────────────────

    def attach_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Attach the asyncio loop after construction — for the rare
        case the caller constructed us off-loop. Idempotent. Triggers
        the subscription setup if it hadn't already run."""
        if self._loop is loop:
            return
        if self._loop is not None:
            raise RuntimeError(
                "BusBackedSerial: cannot reattach to a different loop"
            )
        self._loop = loop
        self._subscribe_via_loop()

    def _subscribe_via_loop(self) -> None:
        """Spawn the rx + state subscriptions on the bus loop. The
        subscriptions append to the buffer + flip _upstream_down
        respectively, and signal the condition so blocked reads
        unblock promptly.

        We are reliably OFF the asyncio loop here — BusBackedSerial
        is constructed by pymata4 inside an executor thread (via
        ``self._run(_open)`` in pymata_wrapper) which has no running
        loop. ``run_coroutine_threadsafe`` is the right primitive
        for cross-thread submission and is also safe when called
        from the loop thread itself, so we don't need to branch.
        Earlier versions used ``get_event_loop()`` to disambiguate
        — that raises on Python 3.12 from non-main threads, which
        is exactly the failure path that surfaced as
        ``RuntimeError: There is no current event loop in thread
        'asyncio_0'``.
        """
        loop = self._loop
        if loop is None:
            return
        async def _do_subscribe() -> None:
            try:
                # rlx_bus.BusClient.subscribe waits for the server's
                # subscribe-ack frame before returning (see client.py).
                # When this awaits returns, the runtime has registered
                # us as a subscriber — any subsequent publish on the
                # topic will fan out to us. This closes the race
                # window where a board reply published by serial-1
                # could arrive at the runtime before our subscriber
                # was registered.
                await self._bus.subscribe(self._rx_topic, self._on_rx)
                await self._bus.subscribe(self._state_topic, self._on_state)
            except Exception:  # noqa: BLE001
                logger.exception(
                    "BusBackedSerial(bus:%s): subscribe failed",
                    self._proxy_id,
                )
            finally:
                # Mark ready EVEN on failure so write() doesn't
                # deadlock — the operator gets a meaningful
                # "Invalid Arduino ID reply length" diagnostic
                # rather than a hang.
                self._sub_ready.set()
        asyncio.run_coroutine_threadsafe(_do_subscribe(), loop)

    async def _on_rx(self, payload: Any) -> None:
        """Subscription callback for ``/serial/<id>/rx``. Decodes
        base64 + appends to the shared buffer + wakes any reader."""
        if self._closed:
            return
        if not isinstance(payload, dict):
            return
        data_b64 = payload.get("data")
        if not isinstance(data_b64, str):
            return
        try:
            raw = base64.b64decode(data_b64, validate=True)
        except Exception:  # noqa: BLE001
            logger.exception("BusBackedSerial(bus:%s): bad b64 on rx", self._proxy_id)
            return
        if not raw:
            return
        with self._cv:
            self._buf.extend(raw)
            self._cv.notify_all()

    async def _on_state(self, payload: Any) -> None:
        """Subscription callback for ``/serial/<id>/state``. We only
        care about ``connected`` — when it flips false, set the
        upstream-down flag so reads stop waiting forever."""
        if not isinstance(payload, dict):
            return
        connected = bool(payload.get("connected"))
        new_down = not connected
        if new_down != self._upstream_down:
            self._upstream_down = new_down
            # Wake any blocked reader so they can observe the change.
            with self._cv:
                self._cv.notify_all()
            if new_down:
                logger.info(
                    "BusBackedSerial(bus:%s): upstream reports disconnected",
                    self._proxy_id,
                )

    # Convenience for callers that want a less-confusing close.
    def __del__(self) -> None:
        try:
            self.close()
        except Exception:  # noqa: BLE001
            pass
