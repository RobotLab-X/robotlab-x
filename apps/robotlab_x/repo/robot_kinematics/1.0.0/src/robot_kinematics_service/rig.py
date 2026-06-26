"""Rig schema — names the end-effectors + servo map over one URDF.

A *rig* binds a flat URDF to robotlab_x: which links are end-effectors
(and how each is driven — reach a point, a full pose, or look-at), plus a
per-joint servo calibration for fan-out. Bundled rigs ship in
``examples/`` beside this package; user rigs live under the shared data
dir (same two-root pattern as the ik_solver Model Library).
"""
from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field

# Servo↔joint calibration is the shared primitive both kinematics
# services use (see packages/rlx_servo_cal). Re-exported here so existing
# ``from .rig import JointCalibration`` imports keep working.
from rlx_servo_cal import JointCalibration

SCHEMA_VERSION = 1

# Solve goal per end-effector:
#   position — reach a 3-D point (right for <6-DOF arms like InMoov's)
#   pose     — reach a full 6-DOF pose (needs ≥6 DOF to hit exactly)
#   look_at  — aim the link's forward axis at the point (head/eyes tracking)
EEMode = Literal["position", "pose", "look_at"]


class EndEffector(BaseModel):
    name: str                                   # operator-facing, e.g. "right_hand"
    link: str                                   # URDF link/frame name, e.g. "r_hand_link"
    mode: EEMode = "position"
    position_cost: float = 1.0
    orientation_cost: float = 0.0
    # Local forward axis aimed at the target in look_at mode (link frame).
    forward_axis: List[float] = Field(default_factory=lambda: [0.0, 0.0, 1.0])
    enabled: bool = True


class Target(BaseModel):
    """A pendant — the world-frame point (mm) an end-effector chases."""
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0


class Prop(BaseModel):
    """A static (or graspable) object in the scene — table, cup, box, etc.
    Pose is world-frame mm (Z-up), matching the robot. ``dims`` is type-
    specific (e.g. cup: d/height; bar_table: top_d/height/pole_d). A
    ``graspable`` prop can be reached + attached to ``grasp_link``."""
    id: str
    type: str = "box"                            # bar_table | cup | box | cylinder
    pose: Dict[str, float] = Field(default_factory=lambda: {"x": 0.0, "y": 0.0, "z": 0.0})
    dims: Dict[str, float] = Field(default_factory=dict)
    color: str = "#888888"
    graspable: bool = False
    grasp_link: str = ""                          # link the prop attaches to when grasped


class RigSpec(BaseModel):
    """Portable whole-body rig. ``urdf`` is a filename resolved beside the
    rig file (bundled) or an absolute path (user)."""
    model_config = {"protected_namespaces": ()}

    schema_version: int = SCHEMA_VERSION
    rig_id: str
    title: str = ""
    source: str = ""
    urdf: str = ""                              # filename (bundled) or abs path
    # Optional baked visual GLB for the 3-D "skinned" viewer, as a bundle-
    # relative path served via /repo/<name>/<version>/file/<visual>.
    visual: str = ""
    base_link: str = "world"
    end_effectors: List[EndEffector] = Field(default_factory=list)
    posture_cost: float = 1e-2
    calibration: List[JointCalibration] = Field(default_factory=list)
    props: List[Prop] = Field(default_factory=list)   # scene objects (table, cup, …)
