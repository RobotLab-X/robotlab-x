# unmanaged
"""Periodic /runtime/<id>/state publisher — process + OS + CPU + memory + disk.

The runtime service is uniquely positioned to publish data about ITSELF
(its hosting process) and the box it runs on. Every other service has a
specialised state shape; this one is the system-info dashboard.

Topic: ``/runtime/<proxy_id>/state`` (retained). The proxy id is always
``"runtime"`` for the singleton, so the canonical full topic is
``/runtime/runtime/state``.

Wire shape (kept stable — UI matches field names verbatim):

    {
      "language": "python",
      "process": {
        "pid": int,
        "uptime_s": float,
        "cmdline": str,             # space-joined argv
        "cwd": str,
        "threads": int,
        "rss_bytes": int,
        "cpu_percent": float,       # this process only
      },
      "os": {
        "name": "Linux" | "macOS" | "Windows",
        "version": str,             # short, user-readable
        "kernel": str,              # raw uname release for diagnostics
        "arch": str,                # "x86_64", "arm64", ...
        "hostname": str,
      },
      "cpu": {
        "logical": int,
        "physical": int | None,
        "percent": float,           # system-wide, last interval
        "load_avg_1": float | None, # unix-only
        "load_avg_5": float | None,
        "load_avg_15": float | None,
      },
      "memory": {
        "total_bytes": int,
        "available_bytes": int,
        "used_bytes": int,
        "percent": float,
      },
      "disk": {                     # root mount only — keeps the wire small
        "mount": "/",
        "total_bytes": int,
        "used_bytes": int,
        "free_bytes": int,
        "percent": float,
      }
    }
"""
from __future__ import annotations

import asyncio
import logging
import os
import platform
import socket
from typing import Any, Dict, Optional

import psutil

from robotlab_x.runtime.bus import get_bus


logger = logging.getLogger(__name__)


# Normalise psutil/platform's OS strings to something a UI can render
# without exposing kernel-level detail in the primary label. ``platform.
# system()`` returns 'Linux' / 'Darwin' / 'Windows'; we rename Darwin to
# 'macOS' since that's what people actually call it.
_OS_NAME_MAP = {
    "Linux": "Linux",
    "Darwin": "macOS",
    "Windows": "Windows",
}


def _os_version() -> str:
    """User-readable OS version. Falls back to platform.release() if a
    nicer label isn't available. We try platform.freedesktop_os_release()
    first on Linux (Ubuntu 24.04, Debian 12, etc.), then mac_ver, then
    win32_ver, then the kernel release."""
    sysname = platform.system()
    if sysname == "Linux":
        try:
            info = platform.freedesktop_os_release()  # py 3.10+
            pretty = info.get("PRETTY_NAME") or info.get("NAME")
            if pretty:
                return pretty
        except (AttributeError, OSError):
            pass
    elif sysname == "Darwin":
        try:
            ver, _, _ = platform.mac_ver()
            if ver:
                return f"macOS {ver}"
        except Exception:  # noqa: BLE001
            pass
    elif sysname == "Windows":
        try:
            ver = platform.win32_ver()[0]
            if ver:
                return f"Windows {ver}"
        except Exception:  # noqa: BLE001
            pass
    return platform.release()


def _snapshot_os() -> Dict[str, Any]:
    sysname = platform.system()
    return {
        "name": _OS_NAME_MAP.get(sysname, sysname),
        "version": _os_version(),
        "kernel": platform.release(),
        "arch": platform.machine(),
        "hostname": socket.gethostname(),
    }


class SystemStatePublisher:
    """Background task that publishes /runtime/<id>/state every interval.

    Use as::

        pub = SystemStatePublisher(proxy_id="runtime", interval_s=3.0)
        pub.start()
        ...
        await pub.stop()

    Each instance owns one psutil.Process handle for the current PID and
    primes the cpu_percent counters so the first published value isn't
    a meaningless zero. Multiple instances would just publish duplicate
    frames — there's no reason to make more than one.
    """

    def __init__(self, proxy_id: str = "runtime", interval_s: float = 3.0) -> None:
        self.proxy_id = proxy_id
        self.interval_s = interval_s
        self.topic = f"/runtime/{proxy_id}/state"
        # psutil.Process handle for THIS process. Created on start() so
        # instantiation is cheap + safe at import time.
        self._proc: Optional[psutil.Process] = None
        self._task: Optional[asyncio.Task[None]] = None
        self._stop = asyncio.Event()

    def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._proc = psutil.Process(os.getpid())
        # Prime cpu_percent — the first call always returns 0.0 and
        # establishes the baseline for diff measurement. Same for the
        # system-wide counter.
        psutil.cpu_percent(interval=None)
        try:
            self._proc.cpu_percent(interval=None)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass

        self._stop.clear()
        self._task = asyncio.create_task(self._run(), name="runtime.system_state")
        logger.info("runtime.system_state: started (topic=%s interval=%.1fs)",
                    self.topic, self.interval_s)

    async def stop(self) -> None:
        if self._task is None:
            return
        self._stop.set()
        try:
            await asyncio.wait_for(self._task, timeout=2.0)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            self._task.cancel()
        self._task = None
        logger.info("runtime.system_state: stopped")

    async def _run(self) -> None:
        # Publish once immediately so subscribers don't wait a full
        # interval for the first sample. Subsequent ticks happen after
        # interval_s, broken by the stop event.
        while True:
            try:
                payload = self._snapshot()
                get_bus().publish_sync(self.topic, payload, retained=True)
            except Exception:  # noqa: BLE001
                logger.exception("runtime.system_state: snapshot/publish failed")
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self.interval_s)
                # stop event fired — exit the loop.
                return
            except asyncio.TimeoutError:
                continue  # normal tick

    def _snapshot(self) -> Dict[str, Any]:
        proc = self._proc
        # ── process ──
        process: Dict[str, Any] = {"pid": os.getpid()}
        if proc is not None:
            try:
                with proc.oneshot():
                    create_t = proc.create_time()
                    cmdline = proc.cmdline()
                    cwd = proc.cwd()
                    threads = proc.num_threads()
                    mem = proc.memory_info()
                    cpu = proc.cpu_percent(interval=None)
                process.update({
                    "uptime_s": max(0.0, psutil.time.time() - create_t),
                    "cmdline": " ".join(cmdline) if cmdline else "",
                    "cwd": cwd,
                    "threads": threads,
                    "rss_bytes": int(mem.rss),
                    "cpu_percent": float(cpu),
                })
            except (psutil.NoSuchProcess, psutil.AccessDenied) as exc:
                # Self-introspection failed (very unusual). Log and ship
                # what we have; the UI tolerates missing fields.
                logger.debug("runtime.system_state: proc introspect failed: %s", exc)

        # ── cpu (system-wide) ──
        try:
            load1, load5, load15 = os.getloadavg()  # unix only
        except (AttributeError, OSError):
            load1 = load5 = load15 = None
        cpu_block: Dict[str, Any] = {
            "logical": psutil.cpu_count(logical=True) or 0,
            "physical": psutil.cpu_count(logical=False),
            "percent": float(psutil.cpu_percent(interval=None)),
            "load_avg_1": load1,
            "load_avg_5": load5,
            "load_avg_15": load15,
        }

        # ── memory ──
        vmem = psutil.virtual_memory()
        mem_block = {
            "total_bytes": int(vmem.total),
            "available_bytes": int(vmem.available),
            "used_bytes": int(vmem.used),
            "percent": float(vmem.percent),
        }

        # ── disk (root only) ──
        try:
            du = psutil.disk_usage("/")
            disk_block: Dict[str, Any] = {
                "mount": "/",
                "total_bytes": int(du.total),
                "used_bytes": int(du.used),
                "free_bytes": int(du.free),
                "percent": float(du.percent),
            }
        except OSError as exc:
            logger.debug("runtime.system_state: disk usage failed: %s", exc)
            disk_block = {"mount": "/", "error": str(exc)}

        return {
            "language": "python",
            "language_version": platform.python_version(),
            "language_implementation": platform.python_implementation(),
            "process": process,
            "os": _snapshot_os(),
            "cpu": cpu_block,
            "memory": mem_block,
            "disk": disk_block,
        }


# Module-level singleton — there's exactly one runtime per process so
# one publisher is the right shape. Started by event_handlers.on_startup.
_publisher: Optional[SystemStatePublisher] = None


def start_publisher(proxy_id: str = "runtime", interval_s: float = 3.0) -> None:
    """Idempotent — calling twice is a no-op."""
    global _publisher
    if _publisher is None:
        _publisher = SystemStatePublisher(proxy_id=proxy_id, interval_s=interval_s)
    _publisher.start()


async def stop_publisher() -> None:
    """Best-effort shutdown for tests + clean exits."""
    global _publisher
    if _publisher is not None:
        await _publisher.stop()
        _publisher = None
