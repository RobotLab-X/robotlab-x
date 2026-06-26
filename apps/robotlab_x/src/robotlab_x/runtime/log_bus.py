# unmanaged
"""In-memory ring buffer of recent runtime log lines.

The UI Logs page live-tails *per-service* logs over the bus
(``/service_proxy/+/log``), but the backend's own logging (lifecycle,
services, errors — what lands in stdout / robotlab_x.log) was never
visible there, and the page had no history, so it sat empty until a
service happened to log while you watched.

This installs a logging.Handler that appends every record to a bounded
deque. It is *append-only* — no bus publish, no I/O — so it can't recurse
through the logging system and costs nothing on the hot path. The buffer
is served by ``GET /v1/logs`` (see api/logs_api.py); the UI backfills from
it on open and polls for the rolling window.
"""
from __future__ import annotations

import logging
from collections import deque
from threading import Lock
from typing import Any, Deque, Dict, List

_MAX = 1000
_BUFFER: Deque[Dict[str, Any]] = deque(maxlen=_MAX)
_LOCK = Lock()

# Loggers too noisy or self-referential to keep. uvicorn.access logs every
# HTTP request — including the UI's own poll of /v1/logs — which would fill
# the buffer with its own polling traffic.
_SKIP_PREFIXES = ("uvicorn.access",)


class RingLogHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        try:
            if record.name.startswith(_SKIP_PREFIXES):
                return
            with _LOCK:
                _BUFFER.append({
                    "ts": int(record.created * 1000),  # ms since epoch
                    "level": record.levelname,
                    "logger": record.name,
                    "line": record.getMessage(),
                })
        except Exception:  # noqa: BLE001 — logging must never raise
            pass


def recent(limit: int = 300) -> List[Dict[str, Any]]:
    """Return the most recent ``limit`` buffered records (oldest first)."""
    with _LOCK:
        items = list(_BUFFER)
    return items[-limit:] if limit and len(items) > limit else items


def install() -> None:
    """Attach the ring handler to the root logger (idempotent)."""
    root = logging.getLogger()
    if any(isinstance(h, RingLogHandler) for h in root.handlers):
        return
    handler = RingLogHandler()
    handler.setLevel(logging.INFO)
    root.addHandler(handler)
    logging.getLogger(__name__).info("log_bus: ring buffer installed (max=%d)", _MAX)
