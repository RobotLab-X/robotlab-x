"""Unit tests for the structured install engine (installer.install_pip).

The real subprocess (uv/pip) is mocked so these run fast and offline; we
assert the milestone event sequence, the success marker, and structured
failure — not that pip actually works.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from robotlab_x.runtime import installer


def _bin(cwd) -> Path:
    return Path(cwd) / ".venv" / ("Scripts" if os.name == "nt" else "bin")


@pytest.fixture
def no_rlx_bus(monkeypatch):
    # Two-step plan (create_venv → install_deps) keeps assertions simple.
    # Neutralize ALL pre-installed local packages (rlx_bus + rlx_audio +
    # rlx_input + rlx_servo_cal) so the plan is just create_venv → install_deps.
    monkeypatch.setattr(installer, "_rlx_bus_local_path", lambda: None)
    monkeypatch.setattr(installer, "_rlx_audio_local_path", lambda: None)
    monkeypatch.setattr(installer, "_rlx_input_local_path", lambda: None)
    monkeypatch.setattr(installer, "_rlx_servo_cal_local_path", lambda: None)


def _fake_stream_ok(argv, cwd, on_progress, timeout):
    # Pretend venv creation populated the bin dir, emit one output line.
    _bin(cwd).mkdir(parents=True, exist_ok=True)
    if on_progress:
        on_progress("stdout", "Successfully installed")
    return 0


def _milestones(events):
    # Milestone events have no `stream` (those are raw output lines).
    return [(e["step_id"], e["status"]) for e in events if "stream" not in e]


def test_install_emits_step_sequence_and_marker(tmp_path, monkeypatch, no_rlx_bus):
    monkeypatch.setattr(installer, "_stream_subprocess", _fake_stream_ok)
    events = []
    bin_dir = installer.install_pip("-e /pkg", "foo/1.0.0", tmp_path, on_event=events.append)

    assert str(bin_dir).endswith(os.path.join("foo", "1.0.0", ".venv", _bin(".").name))
    assert _milestones(events) == [
        ("create_venv", "running"),
        ("create_venv", "completed"),
        ("install_deps", "running"),
        ("install_deps", "completed"),
    ]
    # every milestone carries index/total
    assert all(e["total"] == 2 for e in events if "stream" not in e)

    marker = installer.read_install_marker(tmp_path / "foo" / "1.0.0" / ".venv")
    assert marker is not None
    assert marker["spec"] == "-e /pkg"
    assert marker["steps"] == ["create_venv", "install_deps"]


def test_existing_venv_skips_create(tmp_path, monkeypatch, no_rlx_bus):
    # Pre-create the venv bin so create_venv short-circuits to "completed".
    _bin(tmp_path / "foo" / "1.0.0").mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(installer, "_stream_subprocess", _fake_stream_ok)
    events = []
    installer.install_pip("pkg", "foo/1.0.0", tmp_path, on_event=events.append)

    create = [e for e in events if e["step_id"] == "create_venv"]
    assert len(create) == 1
    assert create[0]["status"] == "completed"
    assert create[0].get("detail") == "already present"


def test_failed_step_raises_structured(tmp_path, monkeypatch, no_rlx_bus):
    def fail_on_deps(argv, cwd, on_progress, timeout):
        _bin(cwd).mkdir(parents=True, exist_ok=True)
        # venv (first call) ok; deps (pip install) fails
        return 0 if "venv" in argv else 1

    monkeypatch.setattr(installer, "_stream_subprocess", fail_on_deps)
    events = []
    with pytest.raises(installer.InstallError) as ei:
        installer.install_pip("-e /pkg", "foo/1.0.0", tmp_path, on_event=events.append)

    assert ei.value.step_id == "install_deps"
    assert ei.value.error_code == "nonzero_exit"
    assert ei.value.returncode == 1
    assert ("install_deps", "failed") in _milestones(events)
    # no marker on failure
    assert installer.read_install_marker(tmp_path / "foo" / "1.0.0" / ".venv") is None


def test_install_dispatch_pip(tmp_path, monkeypatch, no_rlx_bus):
    monkeypatch.setattr(installer, "_stream_subprocess", _fake_stream_ok)
    bin_dir = installer.install("pip", "-e /pkg", "foo/1.0.0", tmp_path)
    assert str(bin_dir).endswith(os.path.join(".venv", _bin(".").name))


def test_install_dispatch_unsupported_manager(tmp_path):
    events = []
    with pytest.raises(installer.InstallError) as ei:
        installer.install("npm", "left-pad", "foo/1.0.0", tmp_path, on_event=events.append)
    assert ei.value.error_code == "unsupported_manager"
    assert any(e.get("status") == "failed" and e.get("error_code") == "unsupported_manager" for e in events)


def test_uninstall_type_removes_venv(tmp_path):
    venv = tmp_path / "foo" / "1.0.0" / ".venv"
    (venv / "bin").mkdir(parents=True)
    assert venv.exists()
    installer.uninstall_type("foo/1.0.0", tmp_path)
    assert not venv.exists()
    # idempotent: a second call on the absent venv is a no-op
    installer.uninstall_type("foo/1.0.0", tmp_path)
