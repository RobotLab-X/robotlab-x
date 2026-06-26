"""SerialService — diagnostic serial-port service.

Subclasses ``rlx_bus.SubprocessService`` so the boilerplate (env
loading, bus client, hello, control dispatch, heartbeat, signals,
consume loop, graceful shutdown) lives in the framework. This module
defines only what's serial-specific: the @service_method actions,
the state publish, and the read-poll loop in ``port_io``.

Wire contract
-------------
Topics published:

  /serial/{id}/state    retained — connection + port + stats snapshot
  /serial/{id}/control  incoming actions (see below)
  /serial/{id}/rx       non-retained — bytes from the port (base64)
  /serial/{id}/tx       non-retained — bytes written to the port (loopback)
  /serial/{id}/heartbeat 1Hz (auto, base class)
  /serial/{id}/meta     retained — service-type meta (auto)

Actions accepted on /control:

  {"action":"list_ports"}
  {"action":"connect",   "port":"/dev/ttyACM0", "baudrate":115200,
                         "bytesize":8, "parity":"N", "stopbits":1}
  {"action":"disconnect"}
  {"action":"write_bytes", "data":"<base64>"}                       # OR
  {"action":"write_bytes", "text":"hello\\n", "eol":"\\n"}          # OR
  {"action":"write_bytes", "hex":"DE AD BE EF"}                     # accepts spaces/colons
  {"action":"send_file",   "data":"<base64-of-file>", "chunk_bytes":4096}
  {"action":"set_options", ...partial config...}
  {"action":"clear_counters"}

RX / TX payload shape::

    {"data": "<base64>", "len": 64, "ts": 1234567890.123,
     "source": "write_bytes"}   # only on /tx
"""
from __future__ import annotations

import asyncio
import base64
import binascii
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pydantic import Field
from rlx_bus import (
    ServiceConfig,
    SubprocessService,
    list_serial_ports,
    service_method,
)

from .port_io import PortReader


logger = logging.getLogger(__name__)


# ─── config ──────────────────────────────────────────────────────────


class SerialConfig(ServiceConfig):
    """Strongly-typed config for SerialService.

    Persistence semantics — every field below survives a restart so
    the UI's last selection is replayed on the next session.
    ``autoreconnect`` is the persisted *desired connection state*: it
    tracks whether the port was connected, so a port that was open
    re-opens itself on the next start (and one explicitly disconnected
    stays closed).
    """
    last_port: Optional[str] = Field(
        None,
        description="Device path of the last successful Connect (e.g. ``/dev/ttyACM0``). UI pre-selects this in the dropdown on next session.",
    )
    last_baud: int = Field(
        115200,
        description="Last successful baud rate. Default 115200 matches what arduino's FirmataExpress sketch handshakes at.",
    )
    bytesize: int = Field(8, description="Data bits per character (5..8).")
    parity: str = Field("N", description="Parity: N / E / O / M / S.")
    stopbits: float = Field(1, description="Stop bits (1, 1.5, 2).")
    read_timeout: float = Field(
        0.05,
        description="Per-blocking-read timeout in seconds. Tight (default 50ms) so the read loop yields back to the event loop quickly even when no bytes are arriving.",
    )
    rx_coalesce_ms: int = Field(
        20,
        description="Coalesce reads within this window into a single ``/rx`` publish. Reduces bus chatter for high-baud streams.",
    )
    rx_max_chunk_bytes: int = Field(
        4096,
        description="Hard cap on bytes per ``/rx`` publish. Bigger chunks split into multiple messages so individual bus payloads stay bounded.",
    )
    autoreconnect: bool = Field(
        False,
        description="Desired connection state. Set True automatically on a successful connect, False on an explicit disconnect; on start the port re-opens when this is True and last_port is set. Defaults False so a fresh instance never opens a guessed port.",
    )




# ─── service ────────────────────────────────────────────────────────


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class SerialService(SubprocessService):
    """Diagnostic serial-port service. See module docstring for the
    full wire contract."""

    type_name = "serial"
    heartbeat_interval_s = 1.0
    config_class = SerialConfig
    # Class-level publishes — the framework's introspection uses this
    # to know what topics this service-type emits even on a stopped
    # instance. ``rx`` and ``tx`` are non-retained streams; ``state``
    # is the retained snapshot.
    publishes = ["state", "rx", "tx"]

    def __init__(self, proxy_id, bus) -> None:
        super().__init__(proxy_id, bus)
        # ``_reader`` owns the actual pyserial.Serial handle + the
        # blocking read poll thread. None when disconnected.
        self._reader: Optional[PortReader] = None
        # Byte counters since last connect (clear_counters resets).
        self._rx_bytes: int = 0
        self._tx_bytes: int = 0
        self._errors: int = 0
        self._last_error: Optional[str] = None
        self._connected_at: Optional[str] = None

    # ─── lifecycle ───────────────────────────────────────────────────

    async def on_start(self) -> None:
        await self._publish_state()
        if self.config.autoreconnect and self.config.last_port:
            try:
                await self._open(
                    port=self.config.last_port,
                    baudrate=self.config.last_baud,
                    bytesize=self.config.bytesize,
                    parity=self.config.parity,
                    stopbits=self.config.stopbits,
                )
            except Exception:  # noqa: BLE001
                # Don't crash startup over a stale port. Logged + the
                # operator can click Connect once the device is back.
                logger.exception("serial %s: autoreconnect to %s failed",
                                 self.proxy_id, self.config.last_port)
                await self._publish_state()

    async def on_stop(self) -> None:
        if self._reader is not None:
            try:
                await self._reader.close()
            except Exception:  # noqa: BLE001
                logger.exception("serial %s: close raised during stop", self.proxy_id)
            self._reader = None

    # ─── @service_method actions ────────────────────────────────────

    @service_method("list_ports")
    async def m_list_ports(self) -> Dict[str, Any]:
        """Rescan + republish state. Returns the current port list so
        callers that want the answer synchronously don't have to also
        subscribe to /state."""
        await self._publish_state()
        return {"ports": list_serial_ports()}

    @service_method("connect", publishes=["state"])
    async def m_connect(
        self,
        port: str,
        baudrate: int = 115200,
        bytesize: Optional[int] = None,
        parity: Optional[str] = None,
        stopbits: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Open the port. If already connected to a DIFFERENT port,
        the previous one closes first. Re-connecting to the same
        (port, baud, framing) tuple is a no-op."""
        if not port:
            raise ValueError("connect requires a port")
        bytesize = bytesize if bytesize is not None else self.config.bytesize
        parity = parity if parity is not None else self.config.parity
        stopbits = stopbits if stopbits is not None else self.config.stopbits
        # No-op if already on this exact configuration.
        if self._reader is not None and self._reader.matches(port, baudrate, bytesize, parity, stopbits):
            return self._snapshot()
        await self._open(port, baudrate, bytesize, parity, stopbits)
        return self._snapshot()

    @service_method("disconnect", publishes=["state"])
    async def m_disconnect(self) -> Dict[str, Any]:
        """Close the port. ``last_port`` / ``last_baud`` stay in
        config so the UI dropdown re-selects them on next session.
        Clears ``autoreconnect`` — an explicit disconnect means "stay
        down on the next start" (a shutdown preserves it)."""
        if self._reader is not None:
            await self._reader.close()
            self._reader = None
        self._connected_at = None
        await self.update_config({"autoreconnect": False})
        await self._publish_state()
        return self._snapshot()

    @service_method("write_bytes", publishes=["tx", "state"])
    async def m_write_bytes(
        self,
        data: Optional[str] = None,
        text: Optional[str] = None,
        hex: Optional[str] = None,
        eol: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Send bytes to the port. Exactly one of ``data`` (base64),
        ``text`` (ascii-ish), or ``hex`` must be provided.

          * data — base64-encoded raw bytes. The canonical form;
            other encodings get normalised to this for /tx publish.
          * text — UTF-8 string. Appends ``eol`` if given (e.g.
            ``"\\n"`` or ``"\\r\\n"``).
          * hex — hex string. Tolerates spaces, colons, dashes (so
            both ``"DEADBEEF"`` and ``"DE:AD:BE:EF"`` work). Odd
            length raises.
        """
        raw = self._normalise_tx_payload(data, text, hex, eol)
        if not raw:
            return {"written": 0}
        if self._reader is None:
            raise RuntimeError("serial is not connected — call connect() first")
        try:
            n = await self._reader.write(raw)
        except Exception as exc:  # noqa: BLE001
            self._errors += 1
            self._last_error = f"write: {exc}"
            await self._publish_state()
            raise
        self._tx_bytes += n
        await self._publish_tx(raw, source="write_bytes")
        await self._publish_state()
        return {"written": n}

    @service_method("send_file", publishes=["tx", "state"])
    async def m_send_file(
        self,
        data: Optional[str] = None,
        path: Optional[str] = None,
        chunk_bytes: int = 4096,
    ) -> Dict[str, Any]:
        """Stream a binary file's contents to the port. Either
        ``data`` (base64-encoded file contents — uploaded by the UI
        from the operator's machine) OR ``path`` (a server-side
        absolute path). ``chunk_bytes`` controls the per-write block
        size; default 4 KiB is small enough to keep the bus fast on
        progress publishes."""
        if path and data:
            raise ValueError("send_file: pass data OR path, not both")
        if path:
            blob = await asyncio.to_thread(_read_file_bytes, path)
        elif data:
            blob = base64.b64decode(data, validate=True)
        else:
            raise ValueError("send_file requires data or path")
        if self._reader is None:
            raise RuntimeError("serial is not connected — call connect() first")
        total = 0
        chunk = max(1, int(chunk_bytes))
        for i in range(0, len(blob), chunk):
            piece = blob[i:i + chunk]
            try:
                n = await self._reader.write(piece)
            except Exception as exc:  # noqa: BLE001
                self._errors += 1
                self._last_error = f"send_file: {exc}"
                await self._publish_state()
                raise
            self._tx_bytes += n
            total += n
            # Publish each chunk on /tx so the UI sees progress; an
            # alternative would be one big /tx at the end but big
            # base64 messages stress the bus + the UI's rendering.
            await self._publish_tx(piece, source="send_file")
        await self._publish_state()
        return {"written": total, "chunks": (len(blob) + chunk - 1) // chunk}

    @service_method("set_options", publishes=["state"])
    async def m_set_options(
        self,
        baudrate: Optional[int] = None,
        bytesize: Optional[int] = None,
        parity: Optional[str] = None,
        stopbits: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Live-update framing options. Persisted to config and (when
        connected) applied to the open port via pyserial's runtime
        setters."""
        updates: Dict[str, Any] = {}
        if baudrate is not None:
            updates["last_baud"] = int(baudrate)
        if bytesize is not None:
            updates["bytesize"] = int(bytesize)
        if parity is not None:
            updates["parity"] = str(parity).upper()[:1]
        if stopbits is not None:
            updates["stopbits"] = float(stopbits)
        if updates:
            await self.update_config(updates)
        if self._reader is not None and updates:
            try:
                self._reader.set_options(
                    baudrate=updates.get("last_baud"),
                    bytesize=updates.get("bytesize"),
                    parity=updates.get("parity"),
                    stopbits=updates.get("stopbits"),
                )
            except Exception as exc:  # noqa: BLE001
                self._errors += 1
                self._last_error = f"set_options: {exc}"
                logger.exception("serial %s: set_options failed", self.proxy_id)
        await self._publish_state()
        return self._snapshot()

    @service_method("clear_counters", publishes=["state"])
    async def m_clear_counters(self) -> Dict[str, Any]:
        """Reset RX/TX/error counters. Doesn't touch the port."""
        self._rx_bytes = 0
        self._tx_bytes = 0
        self._errors = 0
        self._last_error = None
        await self._publish_state()
        return self._snapshot()

    # ─── internals ───────────────────────────────────────────────────

    @staticmethod
    def _normalise_tx_payload(
        data: Optional[str],
        text: Optional[str],
        hex_str: Optional[str],
        eol: Optional[str],
    ) -> bytes:
        """Resolve the three accepted input shapes to a single
        ``bytes`` payload. Validates inputs strictly so a malformed
        request never silently sends partial bytes."""
        chosen = sum(1 for x in (data, text, hex_str) if x is not None)
        if chosen == 0:
            return b""
        if chosen > 1:
            raise ValueError("write_bytes: pass exactly one of data, text, or hex")
        if data is not None:
            try:
                return base64.b64decode(data, validate=True)
            except binascii.Error as exc:
                raise ValueError(f"write_bytes: invalid base64 ({exc})") from exc
        if text is not None:
            out = text.encode("utf-8")
            if eol:
                out += eol.encode("utf-8")
            return out
        # hex_str: tolerate separators
        cleaned = "".join(c for c in (hex_str or "") if c.isalnum())
        if len(cleaned) % 2:
            raise ValueError("write_bytes: odd-length hex string")
        try:
            return bytes.fromhex(cleaned)
        except ValueError as exc:
            raise ValueError(f"write_bytes: invalid hex ({exc})") from exc

    async def _open(
        self,
        port: str,
        baudrate: int,
        bytesize: int,
        parity: str,
        stopbits: float,
    ) -> None:
        """Open ``port`` + spawn the reader. Idempotent w.r.t. an
        already-matching open via m_connect's pre-check; this is the
        raw implementation that always closes-then-opens."""
        if self._reader is not None:
            await self._reader.close()
            self._reader = None
        reader = PortReader(
            port=port,
            baudrate=baudrate,
            bytesize=bytesize,
            parity=parity,
            stopbits=stopbits,
            read_timeout=self.config.read_timeout,
            coalesce_s=self.config.rx_coalesce_ms / 1000.0,
            max_chunk=self.config.rx_max_chunk_bytes,
            on_rx=self._handle_rx_chunk,
            on_error=self._handle_port_error,
            logger=logger,
        )
        try:
            await reader.open()
        except Exception as exc:  # noqa: BLE001
            self._errors += 1
            self._last_error = f"open {port}: {exc}"
            await self._publish_state()
            raise
        self._reader = reader
        self._connected_at = _iso_now()
        self._last_error = None
        # Persist the choice so the UI can pre-select next session.
        # ``update_config`` does merge + persist + revalidate in one
        # call — the in-process ``save_config()`` we'd reach for in a
        # Service subclass doesn't exist on ``SubprocessService``.
        await self.update_config({
            "last_port": port,
            "last_baud": int(baudrate),
            "bytesize": int(bytesize),
            "parity": str(parity).upper()[:1],
            "stopbits": float(stopbits),
            # Desired connection state — re-opens this port on next start.
            "autoreconnect": True,
        })
        await self._publish_state()

    async def _handle_rx_chunk(self, raw: bytes) -> None:
        """Called by PortReader for every coalesced chunk. Updates
        counters + publishes the base64 payload on /rx."""
        if not raw:
            return
        self._rx_bytes += len(raw)
        payload = {
            "data": base64.b64encode(raw).decode("ascii"),
            "len": len(raw),
            "ts": time.time(),
        }
        try:
            await self.publish("rx", payload, retained=False)
        except Exception:  # noqa: BLE001
            logger.exception("serial %s: rx publish failed", self.proxy_id)

    async def _handle_port_error(self, exc: BaseException) -> None:
        """PortReader bubbles unexpected errors here. We mark the
        port as disconnected so the UI sees the failure and the
        operator can re-open."""
        self._errors += 1
        self._last_error = f"port_io: {exc}"
        logger.warning("serial %s: port error (%s)", self.proxy_id, exc)
        if self._reader is not None:
            try:
                await self._reader.close()
            except Exception:  # noqa: BLE001
                pass
            self._reader = None
        self._connected_at = None
        await self._publish_state()

    async def _publish_tx(self, raw: bytes, *, source: str) -> None:
        """Echo outbound bytes on /tx so the diagnostic UI can show
        them in the scroll buffer alongside RX. Same shape as /rx
        plus a ``source`` field naming the action that emitted it."""
        if not raw:
            return
        payload = {
            "data": base64.b64encode(raw).decode("ascii"),
            "len": len(raw),
            "ts": time.time(),
            "source": source,
        }
        try:
            await self.publish("tx", payload, retained=False)
        except Exception:  # noqa: BLE001
            logger.exception("serial %s: tx publish failed", self.proxy_id)

    def _snapshot(self) -> Dict[str, Any]:
        connected = self._reader is not None
        return {
            "connected": connected,
            "port": self._reader.port if connected else None,
            "baudrate": (self._reader.baudrate if connected else self.config.last_baud),
            "bytesize": (self._reader.bytesize if connected else self.config.bytesize),
            "parity": (self._reader.parity if connected else self.config.parity),
            "stopbits": (self._reader.stopbits if connected else self.config.stopbits),
            "rx_bytes": self._rx_bytes,
            "tx_bytes": self._tx_bytes,
            "errors": self._errors,
            "last_error": self._last_error,
            "ports": list_serial_ports(),
            "last_port": self.config.last_port,
            "last_baud": self.config.last_baud,
            "autoreconnect": self.config.autoreconnect,
            "connected_at": self._connected_at,
        }

    async def _publish_state(self) -> None:
        await self.publish("state", self._snapshot(), retained=True)


def _read_file_bytes(path: str) -> bytes:
    """Server-side file read. Synchronous; called via
    ``asyncio.to_thread`` so the event loop isn't blocked."""
    with open(path, "rb") as fh:
        return fh.read()
