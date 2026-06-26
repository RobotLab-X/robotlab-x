# unmanaged
"""Periodic state reconciliation.

State lives in several places that can drift:
  * service_proxy DB table  (authoritative)
  * framework REGISTRY / process_manager  (in-memory)
  * actual OS processes
  * workspace stored references

Every action handler tries to keep these in sync, but real bugs (network
drops, mid-operation crashes, two tabs racing) still leave the system
inconsistent. This module runs a periodic sweep that detects and fixes
drift unconditionally — the *converge* answer to drift, instead of the
*never drop an event* answer.

Sweep cadence is 15s by default. Each pass:
  1. Pid-alive check on every running/starting proxy row. If the PID is
     gone, flip status=error.
  2. Orphan-subprocess scan: any arduino/echo_http subprocess alive but
     not referenced by a service_proxy row gets SIGTERM'd, with a grace
     window so freshly spawned ones get a chance to announce hello.
  3. Workspace ref tidy: any proxy_id in workspace.service_proxy_ids /
     node_positions / node_view_types / edges that has no DB row gets
     stripped.
  4. Publish /system/reconcile/report with stats so Traffic + Logs show
     the convergence happening (and the user can confirm health).

Started from event_handlers.on_startup. Runs on its own daemon thread +
asyncio loop so it doesn't piggy-back on the FastAPI request loop.
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal
import threading
import time
from typing import Any, Dict, List, Optional, Set

from database.factory import get_database_client
from database.interface import DatabaseAdapter
from robotlab_x.runtime import process_manager
from robotlab_x.runtime.bus import get_bus


logger = logging.getLogger(__name__)

DEFAULT_INTERVAL_S = 15.0
ORPHAN_GRACE_S = 30.0       # don't kill a subprocess younger than this
SIGKILL_GRACE_S = 5.0       # SIGTERM → SIGKILL escalation window per orphan

# Per-pid SIGTERM timestamps so we can escalate to SIGKILL on the next
# reconciler tick if the process refused to die. Indexed by the
# orphan's pid; entries cleared when the pid is no longer alive.
# Module-level (not stored in the DB) — orphan kills are a transient
# concern that doesn't need to survive a runtime restart.
_orphan_sigterm_at: Dict[int, float] = {}
REPORT_TOPIC = "/system/reconcile/report"

_thread: Optional[threading.Thread] = None
_started = threading.Event()
_stop = threading.Event()


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def _process_age_seconds(pid: int) -> float:
    """Rough age of a process by reading /proc/<pid>/stat — clock-tick start."""
    try:
        with open(f"/proc/{pid}/stat") as f:
            parts = f.read().split()
        # Field 22 (index 21) is starttime in clock ticks since boot.
        starttime_ticks = int(parts[21])
        clk_tck = os.sysconf("SC_CLK_TCK") or 100
        with open("/proc/uptime") as f:
            uptime_s = float(f.read().split()[0])
        return uptime_s - (starttime_ticks / clk_tck)
    except Exception:  # noqa: BLE001
        return 0.0


def _read_cmdline(pid: int) -> Optional[str]:
    """Return ``/proc/{pid}/cmdline`` joined, or None if unreadable."""
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            data = f.read()
    except (OSError, PermissionError):
        return None
    if not data:
        return None
    return data.decode("utf-8", "replace").replace("\x00", " ")


def _read_ppid(pid: int) -> Optional[int]:
    """Return the parent pid recorded in ``/proc/{pid}/stat``."""
    try:
        with open(f"/proc/{pid}/stat") as f:
            # The comm field can contain spaces + parens; rsplit on
            # ") " skips past it. ppid is then field 1 of the tail.
            stat_fields = f.read().rsplit(") ", 1)[-1].split()
        return int(stat_fields[1])
    except (OSError, ValueError, IndexError):
        return None


def _scan_service_subprocesses() -> List[Dict[str, Any]]:
    """Return /proc entries that look like service subprocesses **either
    spawned by THIS runtime, OR orphaned by a dead one**.

    The ownership rule:
      * ``ppid == my_pid``     → mine; manage as before.
      * parent is a live ``robotlab_x.main`` (another runtime) → skip;
        their reconciler will handle it.
      * anything else (parent is init, systemd-user, the shell that
        spawned a since-dead runtime, …) → ORPHAN; include for cleanup.

    Why this matters: process_manager spawns subprocesses with setsid()
    and disowns them. When a runtime dies (crash, kill -9, or just the
    user restarting), Linux reparents its subprocesses to init / the
    user's subreaper. They keep running indefinitely. Without orphan
    cleanup, two stacked subprocesses both subscribe to the same
    /<service>/<id>/control topic and fight over hardware (the user
    just hit this — two arduino_service processes wrestling over
    /dev/ttyACM0). The prior PPID filter ("only my children") fixed
    cross-runtime fratricide but in doing so silently grandfathered
    these orphans.
    """
    out: List[Dict[str, Any]] = []
    proc_dir = "/proc"
    my_pid = os.getpid()
    try:
        entries = os.listdir(proc_dir)
    except OSError:
        return out
    for entry in entries:
        if not entry.isdigit():
            continue
        pid = int(entry)
        joined = _read_cmdline(pid)
        if not joined:
            continue
        if "robotlab_x.main" in joined:
            continue  # backend itself (this or another runtime)
        # Match any subprocess service. Robotlab_x convention:
        # every subprocess service is launched as ``python -m
        # <name>_service`` (arduino_service, serial_service,
        # video_service, raspi_service, …). A previous version of
        # this hardcoded ``("arduino_service", "echo_http")`` and
        # silently grandfathered every NEW service-type's zombies
        # — exactly how a stale serial_service kept holding
        # /dev/ttyACM0 across runtime restarts. ``echo_http`` is
        # the one non-conforming legacy name; keep it explicitly.
        is_service = (
            "_service" in joined  # generic suffix — catches every conventional name
            or "echo_http" in joined  # legacy
        )
        if not is_service:
            continue
        ppid = _read_ppid(pid)
        if ppid is None:
            continue  # /proc raced; try again next tick
        # Mine — easy case.
        if ppid == my_pid:
            out.append({"pid": pid, "cmdline": joined, "ppid": ppid, "owner": "mine"})
            continue
        # Parent might be another live runtime. Read its cmdline; if it
        # IS a robotlab_x.main, skip — their reconciler owns this pid.
        parent_cmd = _read_cmdline(ppid)
        if parent_cmd and "robotlab_x.main" in parent_cmd:
            continue
        # Parent is init / a shell / a dead-runtime's adopter / process_manager
        # spawned via setsid (PPID never gets re-claimed). The original
        # owner is gone — this subprocess is an orphan that nobody is
        # managing. Include for cleanup.
        out.append({"pid": pid, "cmdline": joined, "ppid": ppid, "owner": "orphan"})
    return out


def _signal(pid: int, sig: int) -> bool:
    """Best-effort signal delivery — process group first (catches every
    descendant the subprocess may have spawned), falling back to a
    plain ``kill`` if the pgid send fails. Returns False only when the
    target is already gone or we genuinely can't signal it."""
    try:
        os.killpg(pid, sig)
        return True
    except ProcessLookupError:
        return False
    except (PermissionError, OSError):
        try:
            os.kill(pid, sig)
            return True
        except ProcessLookupError:
            return False
        except Exception:  # noqa: BLE001
            return False


def _kill(pid: int) -> bool:
    """SIGTERM the process (group). Thin wrapper over _signal."""
    return _signal(pid, signal.SIGTERM)


def _force_kill(pid: int) -> bool:
    """SIGKILL the process (group). Used to escalate when a prior
    SIGTERM was ignored — e.g. a subprocess wedged in a blocking
    syscall (serial I/O, websocket reconnect loop) that masks the
    Python-level signal handler."""
    return _signal(pid, signal.SIGKILL)


def _reconcile_once(db: DatabaseAdapter) -> Dict[str, Any]:
    """One pass. Returns a stats dict for /system/reconcile/report."""
    # Lazy import to dodge circular imports at module load.
    from robotlab_x.runtime.lifecycle import _publish_lifecycle, _tidy_workspace_refs

    stats = {
        "ts": time.time(),
        "stale_rows_marked_error": 0,
        "orphan_processes_killed": 0,
        "orphan_processes_force_killed": 0,
        "orphan_refs_tidied": 0,
    }

    proxies = db.get_all_items("service_proxy") or []
    proxy_ids: Set[str] = {p.get("id") for p in proxies if p.get("id")}
    proxy_pids: Set[int] = {
        p.get("pid") for p in proxies
        if isinstance(p.get("pid"), int) and p.get("status") in {"running", "starting"}
    }

    # 1. Stale running rows
    for p in proxies:
        pid = p.get("pid")
        status = p.get("status")
        if status not in {"running", "starting"}:
            continue
        if pid and process_manager.pid_alive(pid):
            continue
        # Singletons are always in-process — their pid is os.getpid().
        # The runtime row may have a pid from a previous backend session;
        # auto-correct here instead of marking it error.
        meta = db.get_item("service_meta", p.get("service_meta_id")) if p.get("service_meta_id") else None
        if meta and "singleton" in (meta.get("tags") or []):
            if pid != os.getpid():
                p["pid"] = os.getpid()
                db.update_item("service_proxy", p["id"], p, include_nulls=True)
                logger.info("reconciler: refreshed singleton %s pid → %s", p["id"], os.getpid())
            continue
        # Non-singleton: row claims running but process is gone. Mark error.
        p["status"] = "error"
        p["pid"] = None
        p["error"] = p.get("error") or "reconciler detected dead pid"
        p["stopped_at"] = _now_iso()
        db.update_item("service_proxy", p["id"], p, include_nulls=True)
        _publish_lifecycle(p)
        stats["stale_rows_marked_error"] += 1
        logger.info("reconciler: %s status=error (pid was %s)", p["id"], pid)

    # 2. Orphan subprocesses
    #
    # Two-phase kill: SIGTERM on first sighting, then SIGKILL after
    # ``SIGKILL_GRACE_S`` if the orphan is still alive on a later tick.
    # The escalation matters in practice — we've seen subprocesses
    # blocked in serial I/O or stuck in a websocket reconnect loop
    # ignore SIGTERM and continue publishing stale retained state over
    # the bus, clobbering the legitimate live instance's state on a
    # last-write-wins basis.
    seen_orphans: Set[int] = set()
    for proc in _scan_service_subprocesses():
        pid = proc["pid"]
        if pid in proxy_pids:
            continue
        # Newly-spawned subprocesses haven't published their hello yet —
        # give them a grace window so we don't kill a healthy fresh start.
        if _process_age_seconds(pid) < ORPHAN_GRACE_S:
            continue
        seen_orphans.add(pid)
        first_at = _orphan_sigterm_at.get(pid)
        if first_at is None:
            logger.warning(
                "reconciler: SIGTERM %s pid=%s ppid=%s cmd=%s",
                proc.get("owner", "?"), pid, proc.get("ppid"), proc["cmdline"][:80],
            )
            if _kill(pid):
                stats["orphan_processes_killed"] += 1
                _orphan_sigterm_at[pid] = time.monotonic()
        elif time.monotonic() - first_at >= SIGKILL_GRACE_S:
            # Survived SIGTERM past the grace window — escalate.
            logger.warning(
                "reconciler: SIGKILL (escalated) %s pid=%s ppid=%s cmd=%s — SIGTERM was ignored for %.1fs",
                proc.get("owner", "?"), pid, proc.get("ppid"), proc["cmdline"][:80],
                time.monotonic() - first_at,
            )
            if _force_kill(pid):
                stats["orphan_processes_force_killed"] += 1
            # Drop the timestamp regardless; if SIGKILL also fails
            # (kernel-stuck process) we'll re-discover it next tick
            # and start fresh.
            _orphan_sigterm_at.pop(pid, None)

    # GC stale entries — any pid we tracked but no longer see (either
    # the process died OR it's no longer an orphan because its proxy
    # row caught up). Without this the dict would slowly leak entries
    # across long-lived runtimes.
    for stale_pid in list(_orphan_sigterm_at.keys()):
        if stale_pid not in seen_orphans:
            _orphan_sigterm_at.pop(stale_pid, None)

    # 3. Workspace ref tidy
    workspaces = db.get_all_items("workspace") or []
    for ws in workspaces:
        # Build the union of ids referenced anywhere in this workspace.
        ws_refs: Set[str] = set()
        if isinstance(ws.get("service_proxy_ids"), list):
            ws_refs |= set(ws["service_proxy_ids"])
        if isinstance(ws.get("node_positions"), dict):
            ws_refs |= set(ws["node_positions"].keys())
        if isinstance(ws.get("node_view_types"), dict):
            ws_refs |= set(ws["node_view_types"].keys())
        if isinstance(ws.get("edges"), list):
            for e in ws["edges"]:
                if isinstance(e, dict):
                    if e.get("source"): ws_refs.add(e["source"])
                    if e.get("target"): ws_refs.add(e["target"])
        for orphan_id in (ws_refs - proxy_ids):
            _tidy_workspace_refs(db, orphan_id)
            stats["orphan_refs_tidied"] += 1
            logger.info("reconciler: tidied orphan ref %s from %s", orphan_id, ws.get("id"))

    get_bus().publish_sync(REPORT_TOPIC, stats, retained=True)
    return stats


async def _consume_loop(interval_s: float) -> None:
    db = get_database_client()
    if db is None:
        logger.error("reconciler: no database client — exiting")
        return
    # Brief delay so the rest of on_startup finishes before our first pass.
    await asyncio.sleep(2.0)
    while not _stop.is_set():
        try:
            stats = _reconcile_once(db)
            if any(stats.get(k, 0) for k in (
                "stale_rows_marked_error",
                "orphan_processes_killed",
                "orphan_refs_tidied",
            )):
                logger.info("reconciler: %s", {k: v for k, v in stats.items() if k != "ts"})
        except Exception:  # noqa: BLE001
            logger.exception("reconciler: pass raised; continuing")
        try:
            await asyncio.wait_for(
                asyncio.get_running_loop().run_in_executor(None, _stop.wait, interval_s),
                timeout=interval_s + 1,
            )
        except asyncio.TimeoutError:
            continue


def _thread_main(interval_s: float) -> None:
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    _started.set()
    try:
        loop.run_until_complete(_consume_loop(interval_s))
    except Exception:  # noqa: BLE001
        logger.exception("reconciler: loop crashed")
    finally:
        try:
            loop.run_until_complete(loop.shutdown_asyncgens())
        except Exception:  # noqa: BLE001
            pass
        loop.close()


def start(interval_s: float = DEFAULT_INTERVAL_S) -> None:
    """Spin up the reconciler. Idempotent."""
    global _thread
    if _thread is not None and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(
        target=_thread_main,
        args=(interval_s,),
        name="rlx-reconciler",
        daemon=True,
    )
    _thread.start()
    _started.wait(timeout=2.0)
    logger.info("reconciler: started, interval=%ss", interval_s)


def stop() -> None:
    _stop.set()
