# unmanaged
"""robot_kinematics tests.

Two layers:
  * rig_lib + rig schema — pydantic only, run in the top-level test venv
    (the package __init__ is trivial, so importing the submodule doesn't
    pull pinocchio).
  * solver/whole-body solve — guarded by importorskip("pinocchio"); runs
    only where the service's own venv deps are present (skips in CI).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

_SRC = (
    Path(__file__).resolve().parents[1]
    / "repo" / "robot_kinematics" / "1.0.0" / "src"
)
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))


# ─── rig_lib (pinocchio-free) ─────────────────────────────────────────

def test_shipped_inmoov_rig_is_valid():
    from robot_kinematics_service import rig_lib
    rows = {r["rig_id"]: r for r in rig_lib.list_rigs()}
    assert "inmoov_wholebody" in rows
    row = rows["inmoov_wholebody"]
    assert row["root"] == "bundled"
    assert set(row["end_effectors"]) == {"right_hand", "left_hand", "head"}
    rig, urdf_abs = rig_lib.load("inmoov_wholebody")
    assert os.path.isfile(urdf_abs), f"rig URDF not resolved: {urdf_abs}"
    assert rig.base_link == "world"
    modes = {e.name: e.mode for e in rig.end_effectors}
    assert modes["head"] == "look_at"
    assert modes["right_hand"] == "position"
    assert len(rig.calibration) > 0


def test_rig_lib_user_shadows_bundled(tmp_path, monkeypatch):
    from robot_kinematics_service import rig_lib
    from robot_kinematics_service.rig import RigSpec
    monkeypatch.setenv("ROBOTLAB_X_DATA_DIR_ABS", str(tmp_path))
    # Save a user rig that shadows the bundled id.
    rig_lib.save(RigSpec(rig_id="inmoov_wholebody", title="My InMoov", urdf="/abs/inmoov.urdf"))
    rows = {r["rig_id"]: r for r in rig_lib.list_rigs()}
    assert rows["inmoov_wholebody"]["root"] == "user"
    assert rows["inmoov_wholebody"]["title"] == "My InMoov"
    rig, urdf_abs = rig_lib.load("inmoov_wholebody")
    assert urdf_abs == "/abs/inmoov.urdf"  # absolute path passed through
    assert rig_lib.delete("inmoov_wholebody") is True


def test_rig_lib_invalid_id():
    from robot_kinematics_service import rig_lib
    with pytest.raises(ValueError):
        rig_lib.load("../etc")


# ─── solver / whole-body solve (needs pinocchio+pink) ─────────────────

def test_wholebody_solve_inmoov():
    pytest.importorskip("pinocchio")
    pytest.importorskip("pink")
    from robot_kinematics_service import rig_lib
    from robot_kinematics_service.rig import EndEffector
    from robot_kinematics_service.solver import WholeBodySolver

    _rig, urdf = rig_lib.load("inmoov_wholebody")
    s = WholeBodySolver(urdf)
    # Reversed-limit normalisation actually fired on the InMoov model.
    assert s.n_limit_fixes > 0
    missing = s.set_end_effectors([
        EndEffector(name="right_hand", link="r_hand_link", position_cost=1.0, orientation_cost=0.0),
        EndEffector(name="head", link="head_link", mode="look_at", orientation_cost=0.5),
    ], posture_cost=1e-2)
    assert missing == []
    assert len(s.joint_angles_deg()) == 53           # full InMoov DOF

    # FK->IK round-trip: perturb the right arm, record the (reachable-by-
    # construction) hand pose, reset, then ask IK to reach it back.
    s.set_joint_angles_deg({"r_shoulder_lift_joint": -30.0, "r_elbow_flex_joint": -45.0})
    target = s.ee_world_pos("right_hand")
    s.reset()
    s.set_target("right_hand", tuple(target))
    s.solve(iters=400)
    assert s.reach_error_mm("right_hand") < 20.0     # reaches a reachable pose
    assert s.limit_violations() == []                # never leaves joint limits

    s.set_target("head", (500, 0, 1200))             # look-at must not raise
    s.solve(iters=100)
    assert s.limit_violations() == []
