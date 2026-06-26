# unmanaged
"""Path resolution for the PyInstaller --onedir bundle.

Dev runs (uv-managed venv) and frozen runs both call into this module so the
rest of the code doesn't have to special-case sys.frozen. The CI-produced
binary lives at <install>/robotlab_x; this module's __file__ moves into
<install>/_internal/robotlab_x/ once bundled. ``install_dir()`` recovers the
top-level folder regardless.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def install_dir() -> Path:
    """The single folder the install lives in.

    Frozen: the directory containing the executable (sys.executable).
    Dev:    the app root (apps/robotlab_x/) so dev workflows are unchanged.
    """
    if is_frozen():
        return Path(sys.executable).resolve().parent
    # apps/robotlab_x/src/robotlab_x/paths.py -> apps/robotlab_x/
    return Path(__file__).resolve().parents[2]


def bundled_data_dir() -> Path:
    """Where PyInstaller stages read-only data (datas=) at runtime.

    For a --onedir bundle this is <install>/_internal (sys._MEIPASS). In dev
    mode we return install_dir() so callers can use the same accessor and
    dev keeps reading from the source tree.
    """
    if is_frozen():
        return Path(getattr(sys, "_MEIPASS", install_dir() / "_internal"))
    return install_dir()


def var_dir() -> Path:
    """All writable runtime state lives here. Nothing the app writes goes
    outside this directory in a frozen install.
    """
    override = os.environ.get("ROBOTLAB_X_VAR_DIR")
    if override:
        return Path(override).resolve()
    return install_dir() / "var"


def ui_dir() -> Path | None:
    """Where the React dist/ was baked in. Returns None if not present
    (e.g. dev runs that haven't built the UI yet).
    """
    # Frozen:  <install>/_internal/ui  (staged by robotlab_x.spec datas=)
    # Dev:     <install>/build         (existing convention; ignored if the
    #                                   dir doesn't have an index.html)
    if is_frozen():
        candidate = bundled_data_dir() / "ui"
        return candidate if candidate.is_dir() else None
    candidate = install_dir() / "build"
    if candidate.is_dir() and (candidate / "index.html").is_file():
        return candidate
    return None
