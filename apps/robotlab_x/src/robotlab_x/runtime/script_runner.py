# unmanaged
"""Real subprocess execution for the Script Editor.

SECURITY MODEL — read this before touching.

This module runs *arbitrary Python* with the backend process's full
privileges. There is no sandboxing today: a script can import os,
network, file system, the database. That is deliberate for a desktop /
LAN robotics tool where the "Admin" role belongs to the operator who
already controls the host. The PRD's vision treats RobotLab-X as the
user's own machine, not a multi-tenant service.

Mitigations we *do* apply:
  • The HTTP endpoint is gated by the Admin role (default in robotlab_x.yml).
  • Wall-clock timeout (5s default) kills the subprocess + its process group.
  • The subprocess is started in its own process group via os.setsid()
    so killing the group reaps any children it spawned.
  • Output is streamed line-by-line (not buffered to EOF) so the UI
    sees progress even for long-running scripts before they time out.
  • The script body lands in a temp file rather than via argv to avoid
    argv-length limits and accidental shell semantics (we never call a
    shell).

What we do NOT mitigate (Phase 5 leaves these for Phase 6 — process
management — where the broader sandboxing story lives):
  • Resource limits (CPU, memory, disk).
  • Filesystem isolation (the script can read/write anywhere the
    backend can).
  • Network egress restriction.

If RobotLab-X ever ships as a hosted multi-tenant service, this whole
file needs a hard rewrite behind containerised execution.
"""

from __future__ import annotations

import logging
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from robotlab_x.runtime.bus import get_bus


logger = logging.getLogger(__name__)

# Default wall-clock budget per run. Aggressive on purpose: scripts in
# the editor are exploratory snippets, not long jobs. Long-running work
# belongs to a real service_proxy in Phase 6.
DEFAULT_TIMEOUT_SECONDS = 5.0


def _output_topic(script_id: str) -> str:
    return f"/script/{script_id}/output"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _publish(topic: str, payload: dict) -> None:
    get_bus().publish_sync(topic, payload)


def run_in_background(
    script_id: str,
    body: str,
    *,
    language: str = "python",
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    output_topic: Optional[str] = None,
) -> str:
    """Start a script run in a daemon thread; return the run_id immediately.

    The caller (the HTTP route OR a service-method handler) gets back a
    run_id immediately. Live output is published as ``{stream, line,
    run_id}`` messages on ``output_topic`` (default
    ``/script/{script_id}/output``). The new python service-type
    passes its own ``/python/{proxy_id}/output`` so all activity from
    a single python instance lives on one consumer-friendly stream.
    """
    if language != "python":
        raise ValueError(f"unsupported language: {language!r}")

    run_id = uuid.uuid4().hex[:12]
    topic = output_topic or _output_topic(script_id)

    thread = threading.Thread(
        target=_run_blocking,
        args=(script_id, run_id, body, topic, timeout),
        name=f"script_run:{script_id}:{run_id}",
        daemon=True,
    )
    thread.start()
    return run_id


def _run_blocking(
    script_id: str,
    run_id: str,
    body: str,
    topic: str,
    timeout: float,
) -> None:
    """The actual subprocess runner. Always emits an `end` event."""
    _publish(topic, {
        "stream": "meta",
        "event": "start",
        "run_id": run_id,
        "script_id": script_id,
        "timestamp": _now_iso(),
    })

    # Body goes to a temp file rather than argv so the size limit lives
    # at the filesystem level, not argv length.
    tmpdir = Path(tempfile.mkdtemp(prefix="rlx-script-"))
    script_path = tmpdir / "script.py"
    script_path.write_text(body, encoding="utf-8")

    started_at = time.monotonic()
    process: Optional[subprocess.Popen[str]] = None

    def kill_group(proc: subprocess.Popen[str]) -> None:
        if proc.poll() is not None:
            return
        try:
            # Negative pid = process group. Together with setsid above
            # this reaps anything the script spawned.
            os.killpg(proc.pid, signal.SIGTERM)
            time.sleep(0.1)
            if proc.poll() is None:
                os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass  # already exited

    # Disable Python's stdout buffering inside the subprocess. Without
    # this, scripts that print just before a long sleep never flush a
    # line to our pipe — the buffer dies with the process on timeout
    # and the UI shows nothing.
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"

    try:
        process = subprocess.Popen(
            [sys.executable, "-u", str(script_path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL,
            bufsize=1,                # line-buffered
            text=True,
            preexec_fn=os.setsid,     # own process group
            cwd=str(tmpdir),
            env=env,
        )

        # Background reader threads for stdout + stderr. Each forwards
        # one line at a time to the bus.
        def pump(stream, name: str) -> None:
            assert stream is not None
            try:
                for line in iter(stream.readline, ""):
                    _publish(topic, {
                        "stream": name,
                        "line": line.rstrip("\n"),
                        "run_id": run_id,
                    })
            finally:
                stream.close()

        out_t = threading.Thread(target=pump, args=(process.stdout, "stdout"), daemon=True)
        err_t = threading.Thread(target=pump, args=(process.stderr, "stderr"), daemon=True)
        out_t.start()
        err_t.start()

        # Wall-clock watch. We deliberately poll rather than relying on
        # Popen's `timeout` so the pump threads can keep streaming until
        # the moment we kill — otherwise output gets buffered.
        deadline = started_at + timeout
        while True:
            if process.poll() is not None:
                break
            if time.monotonic() >= deadline:
                kill_group(process)
                _publish(topic, {
                    "stream": "meta",
                    "event": "timeout",
                    "run_id": run_id,
                    "timeout_seconds": timeout,
                })
                break
            time.sleep(0.05)

        # Drain the pump threads — they exit when their stream EOFs.
        out_t.join(timeout=1.0)
        err_t.join(timeout=1.0)
        exit_code = process.wait(timeout=1.0)

        elapsed = round((time.monotonic() - started_at) * 1000)
        _publish(topic, {
            "stream": "meta",
            "event": "end",
            "run_id": run_id,
            "script_id": script_id,
            "exit_code": exit_code,
            "elapsed_ms": elapsed,
            "timestamp": _now_iso(),
        })

    except Exception as exc:
        logger.exception("script_runner.error script=%s run=%s", script_id, run_id)
        if process is not None:
            kill_group(process)
        _publish(topic, {
            "stream": "meta",
            "event": "error",
            "run_id": run_id,
            "error": str(exc),
        })

    finally:
        # Best-effort cleanup of the temp dir. Leftover files are at most
        # one tiny .py file plus whatever the script wrote into cwd.
        try:
            for child in tmpdir.rglob("*"):
                if child.is_file():
                    child.unlink(missing_ok=True)
            tmpdir.rmdir()
        except OSError:
            pass
