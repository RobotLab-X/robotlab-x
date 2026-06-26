# unmanaged
"""Real subprocess supervision for service_proxy instances.

Phase 6 swap-in for the mocked pid/host/port that lifecycle.py was
emitting. Each running proxy holds a Popen handle keyed by proxy_id in
``_REGISTRY``; stdout/stderr are pumped line-by-line to
``/service_proxy/{id}/log`` so a dashboard log widget pointed at that
topic fills in real time.

Process model:
    • subprocess.Popen with os.setsid() so the proxy + any children
      share one process group. stop() signals the group, which reaps
      everything the proxy might have spawned (uvicorn workers etc.).
    • PYTHONUNBUFFERED=1 + a line-buffered text mode so prints flush
      promptly into our pumps. Without this, "starting on port X" can
      get stuck in the buffer until graceful shutdown.
    • Crash detection runs in a daemon watcher thread: poll() every
      half second; when the process exits unexpectedly (status was
      still "running"), publish an error event on the proxy's
      lifecycle topic so the UI notices.

Port allocation is OS-assisted: we bind a SO_REUSEADDR socket to
127.0.0.1:0, read the port the kernel handed back, close the socket,
and pass that port into the entry_argv via ${PORT} substitution. There
is a (small) window between close and the subprocess's bind, but it's
acceptable for a single-user dev tool. Multi-process or contention
scenarios would want a held-handle approach.
"""

from __future__ import annotations

import logging
import os
import signal
import socket
import subprocess
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from robotlab_x.runtime.bus import get_bus


logger = logging.getLogger(__name__)

# How long to wait between SIGTERM and SIGKILL on stop().
_GRACEFUL_STOP_SECONDS = 3.0


@dataclass
class _Running:
    proxy_id: str
    process: subprocess.Popen
    port: int
    host: str
    bin_dir: Path
    log_topic: str
    pumps: List[threading.Thread]
    watcher: threading.Thread
    expected_stop: threading.Event


# Module-level registry. Keyed by proxy_id; one Popen per proxy.
_REGISTRY: Dict[str, _Running] = {}
_REGISTRY_LOCK = threading.Lock()


def _log_topic(proxy_id: str) -> str:
    return f"/service_proxy/{proxy_id}/log"


def _lifecycle_topic(proxy_id: str) -> str:
    return f"/service_proxy/{proxy_id}/lifecycle"


def _publish_log(topic: str, stream: str, line: str, proxy_id: str) -> None:
    get_bus().publish_sync(
        topic,
        {"proxy_id": proxy_id, "stream": stream, "line": line, "ts": time.time()},
    )


def _allocate_port() -> int:
    """Ask the OS for a free port. See module docstring re: the race."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]
    finally:
        s.close()


def _substitute(argv: List[str], substitutions: Dict[str, str]) -> List[str]:
    out: List[str] = []
    for token in argv:
        replaced = token
        for key, value in substitutions.items():
            replaced = replaced.replace(f"${{{key}}}", value)
        out.append(replaced)
    return out


def _pump_stream(proxy_id: str, topic: str, stream, name: str) -> None:
    try:
        for line in iter(stream.readline, ""):
            _publish_log(topic, name, line.rstrip("\n"), proxy_id)
    finally:
        try:
            stream.close()
        except Exception:
            pass


def _watch_for_crash(running: _Running) -> None:
    """Detect unexpected exits, mark the proxy as errored, and emit a
    lifecycle event so the UI updates without waiting for a poll.

    Persists to the service_proxy row directly — previous versions only
    published to the bus, which meant a crashed subprocess looked alive
    in the registry and the user couldn't release it. Authority lives
    here because we're the only thread that knows the exit code.
    """
    proc = running.process
    while proc.poll() is None:
        time.sleep(0.5)
    rc = proc.returncode
    if running.expected_stop.is_set():
        return  # stop() drove this — nothing surprising.
    logger.warning("process_manager.crash proxy=%s rc=%s", running.proxy_id, rc)

    error_msg = f"process exited unexpectedly (rc={rc})"
    now_iso = datetime.now(timezone.utc).isoformat()
    # Update the DB row so the registry reflects reality. Best-effort —
    # if the DB isn't reachable, we still publish + clean up our state.
    try:
        from database.factory import get_database_client  # local: keep this module dependency-light
        db = get_database_client()
        if db is not None:
            row = db.get_item("service_proxy", running.proxy_id)
            if row:
                row["status"] = "error"
                row["pid"] = None
                row["port"] = None
                row["stopped_at"] = now_iso
                row["error"] = error_msg
                db.update_item("service_proxy", running.proxy_id, row, include_nulls=True)
    except Exception:  # noqa: BLE001
        logger.exception("process_manager.crash: failed to persist error row for %s", running.proxy_id)

    # Also remove the in-process framework registry entry so subsequent
    # adapter.is_running() / lifecycle.handle() lookups see the truth.
    try:
        from robotlab_x.framework import REGISTRY  # local: same circular-import dodge
        REGISTRY.remove(running.proxy_id)
    except Exception:  # noqa: BLE001
        pass

    get_bus().publish_sync(
        _lifecycle_topic(running.proxy_id),
        {
            "id": running.proxy_id,
            "status": "error",
            "pid": None,
            "error": error_msg,
        },
        retained=True,
    )
    with _REGISTRY_LOCK:
        _REGISTRY.pop(running.proxy_id, None)


def is_running(proxy_id: str) -> bool:
    with _REGISTRY_LOCK:
        rec = _REGISTRY.get(proxy_id)
    if rec is None:
        return False
    return rec.process.poll() is None


def pid_alive(pid: Optional[int]) -> bool:
    """Cheap liveness check for an OS pid. None / 0 / <0 → False.

    Used by lifecycle code to detect proxy rows that claim status=running
    but whose process is gone (crashed without crash-watcher pickup,
    backend restart with orphan never showing up, etc.).
    """
    if pid is None or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        # Process exists but we can't signal it. Still alive from our pov.
        return True
    except OSError:
        return False
    return True


def start(
    proxy_id: str,
    entry_argv: List[str],
    bin_dir: Path,
    *,
    port: Optional[int] = None,
    host: str = "127.0.0.1",
    cwd: Optional[Path] = None,
    service_meta_id: Optional[str] = None,
) -> Dict[str, object]:
    """Spawn the proxy. Returns {pid, host, port}. Idempotent on already-running."""
    if not entry_argv:
        raise ValueError("entry_argv is required")

    with _REGISTRY_LOCK:
        existing = _REGISTRY.get(proxy_id)
        if existing is not None and existing.process.poll() is None:
            return {"pid": existing.process.pid, "host": existing.host, "port": existing.port}

    bound_port = port if port is not None else _allocate_port()
    argv = _substitute(entry_argv, {"PORT": str(bound_port), "HOST": host})

    # Resolve the first argv element against the venv bin dir when it
    # looks like an unqualified executable name (e.g. "python"). This
    # makes catalog entries portable across hosts.
    head = argv[0]
    if "/" not in head and "\\" not in head:
        candidate = bin_dir / head
        if candidate.exists():
            argv[0] = str(candidate)

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    # Make the venv take precedence so child processes (uvicorn → app)
    # find the right interpreter without any PATH gymnastics.
    env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"
    env["VIRTUAL_ENV"] = str(bin_dir.parent)
    env["ROBOTLAB_X_PROXY_ID"] = proxy_id
    env["ROBOTLAB_X_PROXY_PORT"] = str(bound_port)
    env["ROBOTLAB_X_PROXY_HOST"] = host
    if service_meta_id:
        env["ROBOTLAB_X_SERVICE_META_ID"] = service_meta_id
    # Absolute data dir for subprocess services that persist files (e.g. the
    # ik_solver model library). ROBOTLAB_X_DATA_DIR is relative ("data") and
    # the subprocess cwd differs from the backend's, so a relative value can't
    # be resolved downstream — hand over the already-resolved absolute path.
    try:
        from robotlab_x.runtime.lifecycle import _resolve_data_dir
        env["ROBOTLAB_X_DATA_DIR_ABS"] = str(_resolve_data_dir())
    except Exception:  # noqa: BLE001 — data-dir injection is best-effort
        logger.debug("could not resolve absolute data dir for subprocess env")
    # Propagate the runtime's federation id into the subprocess so its
    # meta self-description (/<type>/<id>/meta) can attribute itself to
    # the correct runtime. Falls back to the existing env value if the
    # identity module can't resolve one.
    try:
        from robotlab_x.runtime.identity import get_runtime_id
        rid = get_runtime_id()
        if rid:
            env["ROBOTLAB_X_RUNTIME_ID"] = rid
    except Exception:  # noqa: BLE001
        logger.debug("could not resolve runtime_id for subprocess env propagation")
    # Subprocess services that need bus access pick these up.
    # ROBOTLAB_X_SUBPROCESS_TOKEN authenticates the WS handshake;
    # ROBOTLAB_X_BACKEND_URL points at the parent backend.
    try:
        from robotlab_x.runtime.subprocess_auth import backend_url, get_subprocess_token
        env["ROBOTLAB_X_SUBPROCESS_TOKEN"] = get_subprocess_token()
        env["ROBOTLAB_X_BACKEND_URL"] = backend_url()
    except Exception:  # noqa: BLE001  — bus access is optional for the subprocess
        logger.exception("subprocess_auth setup failed; continuing without bus credentials")

    logger.info("process_manager.start proxy=%s argv=%s port=%d", proxy_id, argv, bound_port)
    process = subprocess.Popen(
        argv,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        stdin=subprocess.DEVNULL,
        bufsize=1,
        text=True,
        preexec_fn=os.setsid,
        cwd=str(cwd) if cwd else str(bin_dir.parent),
        env=env,
    )

    log_topic = _log_topic(proxy_id)
    pumps = [
        threading.Thread(
            target=_pump_stream,
            args=(proxy_id, log_topic, process.stdout, "stdout"),
            name=f"pm_pump_stdout:{proxy_id}",
            daemon=True,
        ),
        threading.Thread(
            target=_pump_stream,
            args=(proxy_id, log_topic, process.stderr, "stderr"),
            name=f"pm_pump_stderr:{proxy_id}",
            daemon=True,
        ),
    ]
    for t in pumps:
        t.start()

    expected_stop = threading.Event()
    running = _Running(
        proxy_id=proxy_id,
        process=process,
        port=bound_port,
        host=host,
        bin_dir=bin_dir,
        log_topic=log_topic,
        pumps=pumps,
        watcher=threading.Thread(),  # placeholder; replaced below
        expected_stop=expected_stop,
    )
    watcher = threading.Thread(
        target=_watch_for_crash,
        args=(running,),
        name=f"pm_watch:{proxy_id}",
        daemon=True,
    )
    running.watcher = watcher

    with _REGISTRY_LOCK:
        _REGISTRY[proxy_id] = running
    watcher.start()

    return {"pid": process.pid, "host": host, "port": bound_port}


def stop(proxy_id: str, *, timeout: float = _GRACEFUL_STOP_SECONDS) -> Dict[str, object]:
    """SIGTERM → wait → SIGKILL. Returns {stopped: bool, rc: Optional[int]}."""
    with _REGISTRY_LOCK:
        running = _REGISTRY.get(proxy_id)
    if running is None:
        return {"stopped": True, "rc": None}

    running.expected_stop.set()
    process = running.process

    if process.poll() is not None:
        rc = process.returncode
        with _REGISTRY_LOCK:
            _REGISTRY.pop(proxy_id, None)
        return {"stopped": True, "rc": rc}

    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            break
        time.sleep(0.1)

    if process.poll() is None:
        logger.warning("process_manager.sigkill proxy=%s (graceful exit timed out)", proxy_id)
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=1.0)

    rc = process.returncode
    # Give the pumps a moment to drain final stdout before we deregister.
    for t in running.pumps:
        t.join(timeout=0.5)
    with _REGISTRY_LOCK:
        _REGISTRY.pop(proxy_id, None)
    return {"stopped": True, "rc": rc}


def stop_all() -> None:
    """Best-effort shutdown of every supervised process. Used on app exit."""
    with _REGISTRY_LOCK:
        proxy_ids = list(_REGISTRY.keys())
    for pid in proxy_ids:
        try:
            stop(pid, timeout=2.0)
        except Exception:
            logger.exception("process_manager.stop_all failed for %s", pid)
