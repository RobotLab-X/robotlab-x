"""Blocking-read poll thread + coalescing logic for SerialService.

pyserial's ``Serial.read()`` blocks. To avoid deadlocking the
service's asyncio event loop we run reads on a daemon thread and
shuttle bytes back into the loop via ``loop.call_soon_threadsafe``.

The reader coalesces bytes that arrive within ``coalesce_s`` into a
single ``on_rx`` callback so a high-baud stream produces a small
number of large bus messages rather than thousands of single-byte
ones. Hard cap ``max_chunk`` keeps any one publish bounded.
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time
from typing import Awaitable, Callable, Optional


# Type aliases so the constructor signature reads cleanly.
RxCallback = Callable[[bytes], Awaitable[None]]
ErrorCallback = Callable[[BaseException], Awaitable[None]]


class PortReader:
    """Owns a pyserial.Serial handle and the read poll thread.

    Lifecycle:
      ``await open()``   — open the port, start the read thread
      ``await write(b)`` — async write (dispatched to executor)
      ``set_options(..)``— live-tweak baud/parity/etc on the open port
      ``await close()``  — stop the thread, close the port. Idempotent.

    Thread model:
      * The read thread loops, calling ``read(in_waiting or 1)`` with
        a short timeout. New bytes are appended to ``_pending``.
      * When the coalesce window elapses (or ``max_chunk`` fills),
        the thread schedules ``on_rx(pending)`` on the asyncio loop.
      * Errors propagate to ``on_error`` (also via the loop).
    """

    def __init__(
        self,
        *,
        port: str,
        baudrate: int,
        bytesize: int,
        parity: str,
        stopbits: float,
        read_timeout: float,
        coalesce_s: float,
        max_chunk: int,
        on_rx: RxCallback,
        on_error: ErrorCallback,
        logger: Optional[logging.Logger] = None,
    ) -> None:
        self.port = port
        self.baudrate = int(baudrate)
        self.bytesize = int(bytesize)
        self.parity = str(parity).upper()[:1]
        self.stopbits = float(stopbits)
        self._read_timeout = float(read_timeout)
        self._coalesce_s = float(coalesce_s)
        self._max_chunk = int(max_chunk)
        self._on_rx = on_rx
        self._on_error = on_error
        self._logger = logger or logging.getLogger(__name__)

        self._serial = None  # pyserial.Serial
        self._thread: Optional[threading.Thread] = None
        self._stop_evt = threading.Event()
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        # Write serialisation lock — pyserial.write isn't documented as
        # thread-safe and we may interleave writes from multiple
        # actions; serialise to be safe.
        self._write_lock = threading.Lock()

    # ─── lifecycle ───────────────────────────────────────────────────

    async def open(self) -> None:
        """Open the port + start the read thread."""
        if self._serial is not None:
            return
        self._loop = asyncio.get_running_loop()
        # Construct on the calling thread (synchronous); pyserial's
        # Serial() constructor blocks briefly for device discovery on
        # some platforms. Acceptable here because it's a one-shot
        # operator action, not a hot path.
        import serial as pyserial  # type: ignore
        # ``exclusive=True`` → pyserial calls TIOCEXCL on Linux so a
        # second service trying to open the same /dev/tty* gets a
        # clean ``[Errno 16] Device or resource busy`` instead of
        # silently sharing the device + producing scrambled traffic.
        # We've seen exactly this footgun with arduino + serial both
        # holding /dev/ttyACM0. Harmless on macOS / Windows —
        # pyserial ignores the option on platforms without TIOCEXCL.
        self._serial = pyserial.Serial(
            port=self.port,
            baudrate=self.baudrate,
            bytesize=self.bytesize,
            parity=self.parity,
            stopbits=self.stopbits,
            timeout=self._read_timeout,
            exclusive=True,
        )
        self._stop_evt.clear()
        self._thread = threading.Thread(
            target=self._read_loop,
            name=f"serial-read-{self.port}",
            daemon=True,
        )
        self._thread.start()

    async def close(self) -> None:
        """Stop the read thread + close the port. Safe to call more
        than once."""
        self._stop_evt.set()
        thread = self._thread
        self._thread = None
        # Wait briefly for the thread to notice. Bounded so we don't
        # hang shutdown if a blocked read somehow lingers — daemon
        # thread will be reaped on process exit either way.
        if thread is not None and thread.is_alive():
            await asyncio.to_thread(thread.join, 1.0)
        serial = self._serial
        self._serial = None
        if serial is not None:
            try:
                await asyncio.to_thread(serial.close)
            except Exception:  # noqa: BLE001
                self._logger.exception("serial close raised")

    def matches(
        self,
        port: str,
        baudrate: int,
        bytesize: int,
        parity: str,
        stopbits: float,
    ) -> bool:
        """True iff the open port matches the requested settings —
        used by m_connect to avoid a re-open on a no-op request."""
        return (
            self._serial is not None
            and self.port == port
            and self.baudrate == int(baudrate)
            and self.bytesize == int(bytesize)
            and self.parity == str(parity).upper()[:1]
            and self.stopbits == float(stopbits)
        )

    # ─── write path ──────────────────────────────────────────────────

    async def write(self, data: bytes) -> int:
        """Async write — dispatched to a worker thread because
        pyserial.write blocks on the OS buffer. Returns the number
        of bytes actually written."""
        if self._serial is None:
            raise RuntimeError("port is not open")
        return await asyncio.to_thread(self._blocking_write, data)

    def _blocking_write(self, data: bytes) -> int:
        with self._write_lock:
            if self._serial is None:
                raise RuntimeError("port closed during write")
            n = self._serial.write(data)
            # pyserial may return None for some backends — coerce.
            return int(n) if n is not None else len(data)

    # ─── live options ───────────────────────────────────────────────

    def set_options(
        self,
        *,
        baudrate: Optional[int] = None,
        bytesize: Optional[int] = None,
        parity: Optional[str] = None,
        stopbits: Optional[float] = None,
    ) -> None:
        """Apply framing changes to the open port via pyserial's
        runtime setters. Each property assignment triggers a
        tcsetattr underneath; safe between reads."""
        if self._serial is None:
            return
        if baudrate is not None:
            self._serial.baudrate = int(baudrate)
            self.baudrate = int(baudrate)
        if bytesize is not None:
            self._serial.bytesize = int(bytesize)
            self.bytesize = int(bytesize)
        if parity is not None:
            self._serial.parity = str(parity).upper()[:1]
            self.parity = str(parity).upper()[:1]
        if stopbits is not None:
            self._serial.stopbits = float(stopbits)
            self.stopbits = float(stopbits)

    # ─── read poll thread ───────────────────────────────────────────

    def _read_loop(self) -> None:
        """Daemon-thread body. Polls the port + coalesces bytes
        within ``coalesce_s`` windows, dispatching to ``on_rx`` on
        the asyncio loop."""
        pending = bytearray()
        window_start: float = 0.0
        try:
            while not self._stop_evt.is_set():
                serial = self._serial
                if serial is None:
                    return
                try:
                    # Read whatever's available (or block up to
                    # read_timeout for at least 1 byte). ``in_waiting``
                    # avoids waking up for nothing when the port's
                    # idle.
                    available = getattr(serial, "in_waiting", 0) or 1
                    chunk = serial.read(available)
                except Exception as exc:  # noqa: BLE001
                    # Bubble to the service. The service will close
                    # the port; we exit.
                    self._schedule_error(exc)
                    return
                now = time.monotonic()
                if chunk:
                    if not pending:
                        window_start = now
                    pending.extend(chunk)
                    if len(pending) >= self._max_chunk:
                        self._dispatch_chunk(bytes(pending))
                        pending.clear()
                        continue
                # Flush when:
                #   * coalesce window elapsed AND we have bytes
                #   * the read returned empty AND we have bytes
                #     (port went idle — flush what we have)
                if pending and (now - window_start >= self._coalesce_s or not chunk):
                    self._dispatch_chunk(bytes(pending))
                    pending.clear()
        finally:
            # On thread exit, flush any leftover bytes.
            if pending:
                self._dispatch_chunk(bytes(pending))

    def _dispatch_chunk(self, data: bytes) -> None:
        """Schedule ``on_rx(data)`` on the asyncio loop from this
        worker thread. Uses ``run_coroutine_threadsafe`` because
        ``on_rx`` is a coroutine."""
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        try:
            asyncio.run_coroutine_threadsafe(self._on_rx(data), loop)
        except Exception:  # noqa: BLE001
            self._logger.exception("dispatch rx chunk failed")

    def _schedule_error(self, exc: BaseException) -> None:
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        try:
            asyncio.run_coroutine_threadsafe(self._on_error(exc), loop)
        except Exception:  # noqa: BLE001
            self._logger.exception("dispatch error failed")
