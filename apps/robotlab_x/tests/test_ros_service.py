# unmanaged
"""ros_service URDF→ik_solver conversion tests.

Exercises the pure functions in ros_service.urdf_export against a small
synthetic URDF — no xacro expansion (so no xacro dep) and no bus. numpy
lives in the ros service's own venv, not this top-level test venv, so the
whole module skips when it's absent (mirrors raspi's gpiozero split).
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

pytest.importorskip("numpy")

_ROS_SRC = Path(__file__).resolve().parents[1] / "repo" / "ros" / "1.0.0" / "src"
if str(_ROS_SRC) not in sys.path:
    sys.path.insert(0, str(_ROS_SRC))

from ros_service.urdf_export import (  # noqa: E402
    chain_to_ik_model,
    extract_chain,
    parse_urdf,
)


# A 3-link arm: world →(fixed pedestal)→ base(rev,Z) →(150mm)→ shoulder(rev,Y)
# →(160mm)→ elbow(rev,Y) → tip. Limits in radians; shoulder stored lower>upper
# on purpose to exercise normalisation.
SYNTH_URDF = """<?xml version="1.0"?>
<robot name="t">
  <link name="world"/>
  <link name="pedestal"/>
  <link name="l0"/><link name="l1"/><link name="l2"/><link name="tip"/>
  <joint name="ped" type="fixed">
    <parent link="world"/><child link="pedestal"/>
    <origin xyz="0 0 0.5" rpy="0 0 0"/>
  </joint>
  <joint name="base" type="revolute">
    <parent link="pedestal"/><child link="l0"/>
    <origin xyz="0 0 0" rpy="0 0 0"/><axis xyz="0 0 1"/>
    <limit lower="-3.14159" upper="3.14159"/>
  </joint>
  <joint name="shoulder" type="revolute">
    <parent link="l0"/><child link="l1"/>
    <origin xyz="0 0 0.15" rpy="0 0 0"/><axis xyz="0 1 0"/>
    <limit lower="2.0944" upper="-0.5236"/>
  </joint>
  <joint name="elbow" type="revolute">
    <parent link="l1"/><child link="l2"/>
    <origin xyz="0 0 0.16" rpy="0 0 0"/><axis xyz="0 1 0"/>
    <limit lower="-2.61799" upper="2.61799"/>
  </joint>
  <joint name="wrist_fixed" type="fixed">
    <parent link="l2"/><child link="tip"/>
    <origin xyz="0 0 0.05" rpy="0 0 0"/>
  </joint>
</robot>
"""


def _model():
    _links, joints = parse_urdf(SYNTH_URDF)
    chain = extract_chain(joints, "world", "tip")
    return chain_to_ik_model(chain, "synth").to_dict()


def test_parse_and_chain_order():
    _links, joints = parse_urdf(SYNTH_URDF)
    chain = extract_chain(joints, "world", "tip")
    assert [j.name for j in chain] == ["ped", "base", "shoulder", "elbow", "wrist_fixed"]


def test_actuated_joints_and_limits_normalised():
    m = _model()
    names = [j["name"] for j in m["ik_model"]["joints"]]
    assert names == ["base", "shoulder", "elbow"]   # fixed joints dropped
    sh = next(j for j in m["ik_model"]["joints"] if j["name"] == "shoulder")
    # stored lower>upper (2.0944 / -0.5236 rad) → normalised min<max in degrees
    assert sh["min_deg"] == pytest.approx(-30.0, abs=0.1)
    assert sh["max_deg"] == pytest.approx(120.0, abs=0.1)


def test_link_lengths_from_home_pose_in_mm():
    m = _model()
    lengths = [l["length_mm"] for l in m["ik_model"]["links"]]
    # base→shoulder = 150mm, shoulder→elbow = 160mm (all along +Z at home).
    assert lengths == pytest.approx([150.0, 160.0], abs=0.1)


def test_planar_and_base_name_warnings():
    m = _model()
    text = " ".join(m["warnings"])
    # base(Z) vs shoulder/elbow(Y) → two distinct axes → planar warning.
    assert "planar approximation" in text
    # first actuated joint IS named 'base' here → no base-rename warning.
    assert "expects the first joint named 'base'" not in text


def test_rich_chain_has_full_fidelity():
    m = _model()
    elbow = next(c for c in m["chain"] if c["name"] == "elbow")
    assert elbow["axis"] == [0.0, 1.0, 0.0]
    assert elbow["origin_xyz_m"] == [0.0, 0.0, 0.16]
    assert elbow["type"] == "revolute"
    # home position composes fixed pedestal (0.5) + 0.15 + 0.16 = 0.81m → 810mm Z
    assert elbow["home_pos_mm"][2] == pytest.approx(810.0, abs=0.1)
