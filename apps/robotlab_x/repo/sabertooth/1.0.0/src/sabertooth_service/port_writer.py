"""Write-only serial port handle for the Sabertooth service.

The Sabertooth in Packetized Serial mode is a one-way device — it
accepts command packets but sends nothing back, so unlike the
diagnostic ``serial`` service there is no read-poll thread here. This
module owns the pyserial handle and serialises writes behind a lock
(pyserial.write is not documented thread-safe and we may interleave
writes from the keepalive task and operator commands).

Open/close are dispatched to a worker thread via ``asyncio.to_thread``
because pyserial's constructor and write both block.
"""
from __future__ import annotations

import asyncio
import logging
import threading
from typing import Optional


class SerialLink:
    """Owns a pyserial.Serial handle for write-only command output.

    Lifecycle::

        await link.open()      # open the port
        await link.write(b)    # async write (dispatched to a thread)
        await link.close()     # close the port. Idempotent.
    """

    def __init__(
        self,
        *,
        port: str,
        baudrate: int,
        logger: Optional[logging.Logger] = None,
    ) -> None:
        self.port = port
        self.baudrate = int(baudrate)
        self._logger = logger or logging.getLogger(__name__)
        self._serial = None  # pyserial.Serial
        # Serialise writes — the keepalive task and operator commands
        # can both call write() concurrently.
        self._write_lock = threading.Lock()

    async def open(self) -> None:
        """Open the port. No-op if already open."""
        if self._serial is not None:
            return
        import serial as pyserial  # type: ignore

        # ``exclusive=True`` takes TIOCEXCL on Linux so a second
        # service opening the same /dev/tty* fails cleanly with
        # "Device or resource busy" instead of silently sharing the
        # device and scrambling motor commands. Ignored on platforms
        # without TIOCEXCL.
        self._serial = await asyncio.to_thread(
            pyserial.Serial,
            self.port,
            self.baudrate,
            timeout=0,
            write_timeout=1.0,
            exclusive=True,
        )

    async def close(self) -> None:
        """Close the port. Safe to call more than once."""
        serial = self._serial
        self._serial = None
        if serial is not None:
            try:
                await asyncio.to_thread(serial.close)
            except Exception:  # noqa: BLE001
                self._logger.exception("sabertooth: serial close raised")

    @property
    def connected(self) -> bool:
        return self._serial is not None

    async def write(self, data: bytes) -> int:
        """Async write — dispatched to a worker thread because
        pyserial.write blocks on the OS buffer."""
        if self._serial is None:
            raise RuntimeError("serial link is not open")
        return await asyncio.to_thread(self._blocking_write, data)

    def _blocking_write(self, data: bytes) -> int:
        with self._write_lock:
            if self._serial is None:
                raise RuntimeError("serial link closed during write")
            n = self._serial.write(data)
            return int(n) if n is not None else len(data)
