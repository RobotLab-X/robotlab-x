# unmanaged
"""Per-type-version package installer.

Currently pip-only. The shape is built for plug-in installers:
``install_pip(spec, slot, repo_dir, on_progress)`` returns the bin
directory containing the installed entry-point's interpreter
(``<venv>/bin``) so process_manager can resolve ``python`` to the
venv'd Python without modifying PATH globally.

The venv is created at ``<repo_dir>/<slot>/.venv`` where ``slot`` is
typically ``"<name>/<version>"``. Every instance of that type-version
shares the same venv — install once per type, run many instances.

Output (pip's stdout/stderr) streams to ``/service_request/{id}/progress``
via the caller-supplied ``on_progress`` callback; failures raise.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Dict, List, Optional


logger = logging.getLogger(__name__)


class InstallError(RuntimeError):
    """A structured install failure: which step failed and how.

    Carries enough context for the UI to show a per-step error (failing
    step + a machine-readable code) instead of a raw exception string.
    """

    def __init__(self, message: str, *, step_id: str, error_code: str, returncode: Optional[int] = None) -> None:
        super().__init__(message)
        self.step_id = step_id
        self.error_code = error_code
        self.returncode = returncode


# Per-step timeouts. Splitting them matters: venv creation can download a
# whole python-build-standalone interpreter on first use (slow link / Pi),
# and a heavy dep tree (opencv, torch via ultralytics) dwarfs that again —
# a single shared budget would starve one to feed the other.
_VENV_TIMEOUT_SECONDS = 180
_RLX_BUS_TIMEOUT_SECONDS = 120
_DEPS_TIMEOUT_SECONDS = 600

# Event callback: receives one structured dict per milestone / output line.
# Shape: {step_id, label, index, total, status, detail?, stream?, error_code?}
#   status ∈ {"running", "completed", "failed"}
# Output lines arrive as status="running" with a `detail` (and `stream`).
InstallEventCallback = Callable[[Dict[str, object]], None]


def _venv_argv(venv_dir: Path) -> list[str]:
    """argv to create a fresh venv at ``venv_dir``.

    Frozen bundles ship a ``uv`` binary next to the rlx executable —
    the PyInstaller bootloader can't be invoked as ``python -m venv``
    (it ignores ``-m`` args and runs the fixed entry point), so a
    self-contained python manager is the only way to make subprocess
    service installs work in a distribution build. Dev mode uses
    ``sys.executable -m venv`` exactly as before.

    Returns the argv list — caller streams it via _stream_subprocess.
    """
    uv = _bundled_uv_path()
    if uv is not None:
        # ``uv venv <dir>`` creates a fully-functional venv with a real
        # python (python-build-standalone, downloaded on first use and
        # cached under ~/.local/share/uv/). The venv has no pip, but
        # we install via ``uv pip install`` (see _pip_install_argv)
        # instead of the venv's own pip — no ensurepip dance needed.
        return [str(uv), "venv", str(venv_dir)]
    return [sys.executable, "-m", "venv", str(venv_dir)]


def _bundled_uv_path() -> Optional[Path]:
    """Locate the bundled ``uv`` next to the rlx executable, if any.

    Returns the path when running frozen + the file exists; None
    otherwise. Used by both venv creation and pip install.
    """
    if not getattr(sys, "frozen", False):
        return None
    install_dir = Path(sys.executable).resolve().parent
    candidate = install_dir / ("uv.exe" if os.name == "nt" else "uv")
    if candidate.is_file():
        return candidate
    logger.warning(
        "installer: frozen build but no bundled uv at %s — falling back "
        "to in-venv pip (will fail for uv-created venvs)", candidate,
    )
    return None


def _pip_install_argv(
    bin_dir: Path,
    spec: list[str],
    *,
    on_progress: Optional["ProgressCallback"] = None,
) -> list[str]:
    """argv to ``pip install <spec>`` against the venv at ``bin_dir``.

    Frozen bundles use ``uv pip install --python <venv>/bin/python``,
    which doesn't require pip to exist inside the venv — uv venvs are
    pip-less by default and we want to keep them that way. Dev mode
    uses the venv's own pip exactly as before.
    """
    uv = _bundled_uv_path()
    if uv is not None:
        python_in_venv = bin_dir / ("python.exe" if os.name == "nt" else "python")
        return [str(uv), "pip", "install", "--python", str(python_in_venv)] + list(spec)
    pip = bin_dir / ("pip.exe" if os.name == "nt" else "pip")
    return [str(pip), "install"] + list(spec)


# How long pip is allowed to run. Network-bound; generous because cold
# uvicorn+fastapi installs can take ~30s on a slow link.
_PIP_TIMEOUT_SECONDS = 120


ProgressCallback = Callable[[str, str], None]
# (stream, line) — stream is "stdout" or "stderr".


def _stream_subprocess(
    argv: list[str],
    cwd: Path,
    on_progress: Optional[ProgressCallback],
    timeout: float,
) -> int:
    """Run argv, streaming stdout/stderr line-by-line to on_progress.

    Returns the exit code. Raises TimeoutError if the wall clock
    exceeds ``timeout``.
    """
    logger.info("installer.run cwd=%s argv=%s", cwd, argv)
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    proc = subprocess.Popen(
        argv,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        stdin=subprocess.DEVNULL,
        bufsize=1,
        text=True,
        cwd=str(cwd),
        env=env,
    )

    import threading
    import time

    def pump(stream, name: str) -> None:
        try:
            for line in iter(stream.readline, ""):
                stripped = line.rstrip("\n")
                if on_progress:
                    try:
                        on_progress(name, stripped)
                    except Exception:  # noqa: BLE001 — never let a hook kill the pump
                        logger.exception("on_progress callback raised")
        finally:
            stream.close()

    threads = [
        threading.Thread(target=pump, args=(proc.stdout, "stdout"), daemon=True),
        threading.Thread(target=pump, args=(proc.stderr, "stderr"), daemon=True),
    ]
    for t in threads:
        t.start()

    deadline = time.monotonic() + timeout
    while proc.poll() is None:
        if time.monotonic() >= deadline:
            proc.kill()
            for t in threads:
                t.join(timeout=1.0)
            raise TimeoutError(f"installer step exceeded {timeout}s")
        time.sleep(0.1)

    for t in threads:
        t.join(timeout=1.0)
    return proc.wait(timeout=1.0)


def install_pip(
    package_spec: str,
    slot: str,
    repo_dir: Path,
    *,
    on_event: Optional[InstallEventCallback] = None,
    deps_timeout: float = _DEPS_TIMEOUT_SECONDS,
) -> Path:
    """Create (or reuse) a venv at ``<repo_dir>/<slot>/.venv`` and pip-install.

    ``slot`` is the path component under repo_dir where the venv lives.
    For the per-type-version layout, callers pass ``"<name>/<version>"``;
    that puts the venv next to the package.yml on disk and shares it
    across every instance of that type.

    Runs as an ordered list of named steps — create_venv → install_rlx_bus
    → install_deps — each emitting structured milestone events through
    ``on_event`` (start/output/completed/failed) so the UI can render a
    step list + collapsible raw log instead of a wall of pip output. A
    failing step raises ``InstallError`` carrying the step id + error code.

    Returns the path to the venv's bin directory so process_manager can
    resolve ``python`` to the right interpreter without mutating PATH.

    Idempotent: an existing venv skips create_venv; pip steps re-run
    (upgrades resolve cleanly). On full success a ``.install-state.json``
    marker is written next to the venv.
    """
    type_dir = (repo_dir / slot).resolve()
    venv_dir = type_dir / ".venv"
    bin_dir = venv_dir / ("Scripts" if os.name == "nt" else "bin")
    type_dir.mkdir(parents=True, exist_ok=True)

    rlx_bus_path = _rlx_bus_local_path()
    rlx_audio_path = _rlx_audio_local_path()
    rlx_input_path = _rlx_input_local_path()
    rlx_servo_cal_path = _rlx_servo_cal_local_path()

    # Build the step plan up front so every event knows its index/total.
    plan: List[Dict[str, object]] = [{"id": "create_venv", "label": "Create virtual environment"}]
    if rlx_bus_path is not None:
        plan.append({"id": "install_rlx_bus", "label": "Install bus client"})
    if rlx_audio_path is not None:
        plan.append({"id": "install_rlx_audio", "label": "Install audio capability"})
    if rlx_input_path is not None:
        plan.append({"id": "install_rlx_input", "label": "Install input capability"})
    if rlx_servo_cal_path is not None:
        plan.append({"id": "install_rlx_servo_cal", "label": "Install servo calibration"})
    plan.append({"id": "install_deps", "label": "Install dependencies"})
    total = len(plan)

    def emit(**fields: object) -> None:
        if on_event is None:
            return
        try:
            on_event(fields)
        except Exception:  # noqa: BLE001 — a UI hook must never break the install
            logger.exception("install on_event callback raised")

    def run_step(index: int, step: Dict[str, object], argv: List[str], timeout: float) -> None:
        sid, label = step["id"], step["label"]
        emit(step_id=sid, label=label, index=index, total=total, status="running")

        def on_line(stream: str, line: str) -> None:
            emit(step_id=sid, label=label, index=index, total=total,
                 status="running", stream=stream, detail=line)

        try:
            rc = _stream_subprocess(argv, cwd=type_dir, on_progress=on_line, timeout=timeout)
        except TimeoutError as exc:
            emit(step_id=sid, label=label, index=index, total=total,
                 status="failed", error_code="timeout", detail=str(exc))
            raise InstallError(str(exc), step_id=str(sid), error_code="timeout") from exc
        if rc != 0:
            msg = f"{label} failed (exit {rc})"
            emit(step_id=sid, label=label, index=index, total=total,
                 status="failed", error_code="nonzero_exit", detail=msg)
            raise InstallError(msg, step_id=str(sid), error_code="nonzero_exit", returncode=rc)
        emit(step_id=sid, label=label, index=index, total=total, status="completed")

    idx = 0

    # 1. venv — skip (mark complete) when it already exists.
    idx += 1
    if bin_dir.exists():
        emit(step_id="create_venv", label="Create virtual environment", index=idx,
             total=total, status="completed", detail="already present")
    else:
        run_step(idx, plan[0], _venv_argv(venv_dir), _VENV_TIMEOUT_SECONDS)

    # 2. rlx_bus — pre-installed into every venv so subprocess services can
    #    ``from rlx_bus import BusClient`` without listing it in their own
    #    pyproject. Skipped entirely when the source can't be located.
    if rlx_bus_path is not None:
        idx += 1
        run_step(
            idx,
            {"id": "install_rlx_bus", "label": "Install bus client"},
            _pip_install_argv(bin_dir, ["-e", str(rlx_bus_path)]),
            _RLX_BUS_TIMEOUT_SECONDS,
        )

    # 2b. rlx_audio — the shared microphone capability (MicrophoneServiceBase
    #     + audio-frame schema). Installed AFTER rlx_bus (depends on it being
    #     present) so the two microphone service types share one contract.
    #     Tiny + pure-Python; harmless in venvs that never import it.
    if rlx_audio_path is not None:
        idx += 1
        run_step(
            idx,
            {"id": "install_rlx_audio", "label": "Install audio capability"},
            _pip_install_argv(bin_dir, ["-e", str(rlx_audio_path)]),
            _RLX_BUS_TIMEOUT_SECONDS,
        )

    # 2b-ii. rlx_input — the shared keyboard capability (KeyboardServiceBase
    #     + key-event schema + keymap layer). Installed AFTER rlx_bus (depends
    #     on it). Tiny + pure-Python; harmless in venvs that never import it.
    if rlx_input_path is not None:
        idx += 1
        run_step(
            idx,
            {"id": "install_rlx_input", "label": "Install input capability"},
            _pip_install_argv(bin_dir, ["-e", str(rlx_input_path)]),
            _RLX_BUS_TIMEOUT_SECONDS,
        )

    # 2c. rlx_servo_cal — the shared servo↔joint calibration primitive
    #     (JointCalibration model + math↔servo map + auto_calibrate). Used
    #     by ik_solver + robot_kinematics so their calibration can't drift.
    #     Pure-Python, depends only on pydantic (already present); harmless
    #     in venvs that never import it.
    if rlx_servo_cal_path is not None:
        idx += 1
        run_step(
            idx,
            {"id": "install_rlx_servo_cal", "label": "Install servo calibration"},
            _pip_install_argv(bin_dir, ["-e", str(rlx_servo_cal_path)]),
            _RLX_BUS_TIMEOUT_SECONDS,
        )

    # 3. deps — split the spec on whitespace so multi-package specs work
    #    ("uvicorn fastapi") AND -e flags ("-e ./repo/echo_http").
    idx += 1
    run_step(
        idx,
        {"id": "install_deps", "label": "Install dependencies"},
        _pip_install_argv(bin_dir, package_spec.split()),
        deps_timeout,
    )

    _write_install_marker(venv_dir, package_spec, [str(s["id"]) for s in plan])
    return bin_dir


# ─── install-state marker ────────────────────────────────────────────
# A small JSON file written next to the venv on successful install. Two
# jobs: (1) idempotency — a future installer can compare the recorded
# spec hash to decide whether a reinstall is needed; (2) forensics — a
# half-built venv has no marker, so "marker present" == "last install
# completed cleanly", which a rollback/repair path can rely on.
_INSTALL_MARKER = ".install-state.json"


def _write_install_marker(venv_dir: Path, package_spec: str, steps: List[str]) -> None:
    marker = venv_dir / _INSTALL_MARKER
    payload = {
        "spec": package_spec,
        "spec_sha256": hashlib.sha256(package_spec.encode()).hexdigest(),
        "steps": steps,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        marker.write_text(json.dumps(payload, indent=2))
    except OSError:
        logger.exception("could not write install marker at %s", marker)


def read_install_marker(venv_dir: Path) -> Optional[Dict[str, object]]:
    """Return the parsed install marker, or None if absent/unreadable."""
    marker = venv_dir / _INSTALL_MARKER
    try:
        return json.loads(marker.read_text())
    except (OSError, ValueError):
        return None


# ─── manager dispatch ────────────────────────────────────────────────
# The install engine is keyed on a dependency-manager name so new
# ecosystems (npm, mvn, docker, …) can be added as additional managers
# without the lifecycle/registry callers branching on type. Only "pip" is
# implemented today; everything else fails with a structured, UI-friendly
# error rather than a generic exception. To add a manager: implement an
# install_<mgr>() with the same (spec, slot, repo_dir, on_event) shape and
# register it here.
SUPPORTED_MANAGERS = {"pip"}


def install(
    dependency_manager: Optional[str],
    package_spec: str,
    slot: str,
    repo_dir: Path,
    *,
    on_event: Optional[InstallEventCallback] = None,
    deps_timeout: float = _DEPS_TIMEOUT_SECONDS,
) -> Path:
    """Install a type's deps using the named manager.

    Dispatches to the per-manager implementation. Unsupported managers
    raise ``InstallError(error_code="unsupported_manager")`` and emit a
    failed milestone so the install-progress UI shows which manager is
    missing rather than a raw traceback.
    """
    mgr = (dependency_manager or "").lower()
    if mgr == "pip":
        return install_pip(package_spec, slot, repo_dir, on_event=on_event, deps_timeout=deps_timeout)

    msg = (
        f"dependency manager {dependency_manager!r} is not supported yet "
        f"(supported: {', '.join(sorted(SUPPORTED_MANAGERS))})"
    )
    if on_event is not None:
        try:
            on_event({
                "step_id": "select_manager", "label": "Select installer",
                "index": 1, "total": 1, "status": "failed",
                "error_code": "unsupported_manager", "detail": msg,
            })
        except Exception:  # noqa: BLE001
            logger.exception("install on_event callback raised")
    raise InstallError(msg, step_id="select_manager", error_code="unsupported_manager")


def uninstall_type(slot: str, repo_dir: Path) -> None:
    """Remove a type's venv (and its marker) so the next install starts
    clean. Used for rollback after a failed/partial install, or an explicit
    reinstall. No-op when the venv is absent.
    """
    import shutil

    venv_dir = (repo_dir / slot).resolve() / ".venv"
    if venv_dir.exists():
        shutil.rmtree(venv_dir, ignore_errors=True)
        logger.info("uninstall_type: removed %s", venv_dir)


def _rlx_bus_local_path() -> Optional[Path]:
    """Resolve the on-disk location of the rlx_bus package source.

    Subprocess venvs depend on rlx_bus for bus access. We install it
    editable from a known on-disk location so iterating on bus_client
    code doesn't require a publish cycle.

    Two layouts supported:
      * Dev (monorepo checkout)   — <root>/packages/rlx_bus/
      * Frozen bundle             — <install>/_internal/packages/rlx_bus/
        (packaging/build.sh copies it there post-pyinstaller)

    Returns None when the package isn't found at either — callers
    continue without rlx_bus and the subprocess will fail with a clear
    ModuleNotFoundError on first ``import rlx_bus``.
    """
    # Frozen build first — running rlx is a bundled binary, packages/
    # lives next to it under _internal/.
    if getattr(sys, "frozen", False):
        install_dir = Path(sys.executable).resolve().parent
        candidate = install_dir / "_internal" / "packages" / "rlx_bus"
        if (candidate / "pyproject.toml").is_file():
            return candidate
        return None
    # Dev / monorepo. Path relative to this file:
    #   <root>/apps/robotlab_x/src/robotlab_x/runtime/installer.py
    # parents: [0]=runtime [1]=robotlab_x [2]=src [3]=robotlab_x (app)
    #          [4]=apps [5]=<root>
    here = Path(__file__).resolve()
    candidate = here.parents[5] / "packages" / "rlx_bus"
    if (candidate / "pyproject.toml").is_file():
        return candidate
    return None


def _rlx_audio_local_path() -> Optional[Path]:
    """Resolve the on-disk location of the rlx_audio package source — the
    shared microphone capability. Same two layouts as rlx_bus (dev monorepo
    vs frozen bundle). Returns None when absent."""
    if getattr(sys, "frozen", False):
        install_dir = Path(sys.executable).resolve().parent
        candidate = install_dir / "_internal" / "packages" / "rlx_audio"
        return candidate if (candidate / "pyproject.toml").is_file() else None
    here = Path(__file__).resolve()
    candidate = here.parents[5] / "packages" / "rlx_audio"
    if (candidate / "pyproject.toml").is_file():
        return candidate
    return None


def _rlx_input_local_path() -> Optional[Path]:
    """Resolve the on-disk location of the rlx_input package source — the
    shared keyboard capability (KeyboardServiceBase + key-event schema).
    Same two layouts as rlx_bus (dev monorepo vs frozen bundle). Returns
    None when absent."""
    if getattr(sys, "frozen", False):
        install_dir = Path(sys.executable).resolve().parent
        candidate = install_dir / "_internal" / "packages" / "rlx_input"
        return candidate if (candidate / "pyproject.toml").is_file() else None
    here = Path(__file__).resolve()
    candidate = here.parents[5] / "packages" / "rlx_input"
    if (candidate / "pyproject.toml").is_file():
        return candidate
    return None


def _rlx_servo_cal_local_path() -> Optional[Path]:
    """Resolve the on-disk location of the rlx_servo_cal package source —
    the shared servo↔joint calibration primitive. Same two layouts as
    rlx_bus (dev monorepo vs frozen bundle). Returns None when absent."""
    if getattr(sys, "frozen", False):
        install_dir = Path(sys.executable).resolve().parent
        candidate = install_dir / "_internal" / "packages" / "rlx_servo_cal"
        return candidate if (candidate / "pyproject.toml").is_file() else None
    here = Path(__file__).resolve()
    candidate = here.parents[5] / "packages" / "rlx_servo_cal"
    if (candidate / "pyproject.toml").is_file():
        return candidate
    return None
