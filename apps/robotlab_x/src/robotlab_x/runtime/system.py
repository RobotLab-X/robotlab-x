# unmanaged
"""Process-level system control: serialize the launch command and restart.

"Simple restart" re-runs the backend with the *exact* command line it was
started with (interpreter + ``-m``/script + any CLI args). We capture that at
startup (``sys.orig_argv``) and persist it to ``<data_dir>/last_start_command
.json`` so the choice is durable and inspectable, then ``os.execv`` it on
restart — replacing the process image with a fresh one. No supervisor
required, so it works on a headless remote box. For supervised prod (systemd
``Restart=always``) the same endpoint can simply exit; the recorded command
stays the source of truth for a manual relaunch.
"""
from __future__ import annotations

import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

from config import get_settings

logger = logging.getLogger(__name__)

_MARKER = "last_start_command.json"
_STARTED_AT = time.time()

# Set while a graceful restart is draining — the lifecycle rejects new
# create/start requests so we don't spawn services into a shutting-down
# runtime.
_DRAINING = False


def is_draining() -> bool:
    return _DRAINING


def set_draining(value: bool) -> None:
    global _DRAINING
    _DRAINING = bool(value)


def _data_dir() -> Path:
    settings = get_settings()
    d = Path(getattr(settings, "data_dir", None) or "data")
    if not d.is_absolute():
        d = Path.cwd() / d
    return d


def _start_argv() -> List[str]:
    """The exact command that launched this process. ``sys.orig_argv``
    (Python 3.10+) includes the interpreter + ``-m``/script + args, so an
    ``os.execv`` of it reproduces the launch faithfully."""
    argv = list(getattr(sys, "orig_argv", []) or [])
    if not argv:
        argv = [sys.executable] + list(sys.argv)
    return argv


def record_start_command() -> None:
    """Serialize the launch command + cwd so restart() (or an operator) can
    reproduce it. Best-effort — never raise into startup."""
    try:
        d = _data_dir()
        d.mkdir(parents=True, exist_ok=True)
        payload = {
            "argv": _start_argv(),
            "cwd": os.getcwd(),
            "executable": sys.executable,
            "pid": os.getpid(),
            "recorded_at": _STARTED_AT,
        }
        (d / _MARKER).write_text(json.dumps(payload, indent=2))
        logger.info("system: recorded start command → %s", payload["argv"])
    except Exception:  # noqa: BLE001
        logger.exception("system: failed to record start command")


def read_start_command() -> Dict[str, Any]:
    """The persisted launch command, or a live fallback if absent."""
    try:
        data = json.loads((_data_dir() / _MARKER).read_text())
        if data.get("argv"):
            return data
    except (OSError, ValueError):
        pass
    return {"argv": _start_argv(), "cwd": os.getcwd(), "executable": sys.executable}


def restart() -> None:
    """Replace this process with a fresh one using the recorded launch
    command. Does not return on success."""
    cmd = read_start_command()
    argv = list(cmd.get("argv") or [])
    cwd = cmd.get("cwd")
    if not argv:
        raise RuntimeError("no start command recorded; cannot restart")

    # os.execv does NOT search PATH — it needs a real executable path. argv[0]
    # is often a bare "python" (PATH-resolved at launch via venv activation),
    # so exec the recorded full interpreter path while passing argv unchanged
    # (argv[0] is just the new process's advertised name). A frozen binary has
    # an absolute argv[0] and we honour that.
    if os.sep in argv[0] and os.path.exists(argv[0]):
        exec_path = argv[0]
    else:
        exec_path = cmd.get("executable") or sys.executable

    # argv[0] must be the real executable path, or Python mis-resolves its
    # prefix ("Could not find platform dependent libraries"). Keep the actual
    # args (argv[1:], e.g. -m robotlab_x.main + any CLI params); replace only
    # the advertised program name with the full exec_path.
    new_argv = [exec_path] + list(argv[1:])

    logger.warning("system: restarting via execv: %s (cwd=%s)", new_argv, cwd)
    try:
        sys.stdout.flush()
        sys.stderr.flush()
    except Exception:  # noqa: BLE001
        pass
    if cwd and os.path.isdir(cwd):
        os.chdir(cwd)
    os.execv(exec_path, new_argv)  # process image is replaced here


def graceful_restart() -> None:
    """Drain, then restart. Enter draining state (reject new services), stop
    every non-singleton managed service so subprocesses are terminated (no
    orphans) and rows aren't left stale-'running', then re-exec. The active
    config set's start_order services come back fresh on boot."""
    set_draining(True)
    logger.warning("system: graceful restart — draining services before re-exec")
    from robotlab_x.runtime import lifecycle  # lazy: avoid import cycle
    # Snapshot BEFORE draining, while status + live runtime state still
    # reflect reality. drain stops the services (and would flip a ticking
    # clock to paused), so capturing desired_state + is_clock_running first
    # is what lets the next boot restore the exact pre-shutdown state.
    try:
        report = lifecycle.save_all_service_config()
        logger.warning(
            "system: snapshotted services before drain — saved=%s",
            report.get("saved"),
        )
    except Exception:  # noqa: BLE001 — never block restart on a save failure
        logger.exception("system: pre-drain snapshot failed; restarting anyway")
    try:
        n = lifecycle.drain_services()
        logger.warning("system: drained %d service(s); re-exec", n)
    except Exception:  # noqa: BLE001 — never get stuck; restart regardless
        logger.exception("system: drain failed; restarting anyway")
    restart()


def shutdown() -> None:
    """Terminate this process without re-exec. Does not return.

    Uses ``os._exit`` to match restart()'s "process ends here" contract
    (execv likewise never returns and skips atexit). Callers should drain
    + snapshot first via graceful_shutdown()."""
    logger.warning("system: shutting down via os._exit(0)")
    try:
        sys.stdout.flush()
        sys.stderr.flush()
    except Exception:  # noqa: BLE001
        pass
    os._exit(0)


def graceful_shutdown() -> None:
    """Snapshot + drain, then exit (no restart). The shutdown twin of
    graceful_restart: same pre-flight so the next manual start restores
    the exact pre-shutdown state — but ends the process instead of
    re-execing it."""
    set_draining(True)
    logger.warning("system: graceful shutdown — snapshot + drain before exit")
    from robotlab_x.runtime import lifecycle  # lazy: avoid import cycle
    try:
        report = lifecycle.save_all_service_config()
        logger.warning(
            "system: snapshotted services before shutdown — saved=%s",
            report.get("saved"),
        )
    except Exception:  # noqa: BLE001 — never block shutdown on a save failure
        logger.exception("system: pre-shutdown snapshot failed; shutting down anyway")
    try:
        n = lifecycle.drain_services()
        logger.warning("system: drained %d service(s); exiting", n)
    except Exception:  # noqa: BLE001 — never get stuck; exit regardless
        logger.exception("system: drain failed; exiting anyway")
    shutdown()


def system_info() -> Dict[str, Any]:
    from robotlab_x.runtime.config_sets import active_set_name  # lazy: avoid cycle

    try:
        active_set = active_set_name()
    except Exception:  # noqa: BLE001
        active_set = None
    cmd = read_start_command()
    return {
        "pid": os.getpid(),
        "started_at": _STARTED_AT,
        "uptime_seconds": round(time.time() - _STARTED_AT, 1),
        "draining": _DRAINING,
        "active_config_set": active_set,
        "start_command": cmd.get("argv"),
        "cwd": cmd.get("cwd"),
    }
