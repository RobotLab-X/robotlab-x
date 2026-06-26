"""Robot model — joints, links, calibration.

The model is the IK service's ``ServiceConfig``; operators edit it
through the standard config wizard or the per-instance Composer
view. No dimensions are hardcoded anywhere else in the service.

Coordinate convention: right-handed, +Z up, origin at the robot's
mounting point. Base joint rotates around Z; subsequent joints
rotate in the resulting "shoulder plane" — the plane containing Z
and the line from origin to the projected target (X, Y, 0).
"""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import ConfigDict, Field
from rlx_bus import ServiceConfig

# Servo↔joint calibration is the shared primitive both kinematics
# services use (see packages/rlx_servo_cal) — one model + one affine map,
# so ik_solver and robot_kinematics can't drift. Re-exported here so
# existing ``from .model import JointCalibration`` imports keep working.
from rlx_servo_cal import JointCalibration

from .models_lib import Pose


class JointSpec(ServiceConfig):
    """One joint in the kinematic chain.

    ``min_deg`` / ``max_deg`` are MATHEMATICAL limits — what the IK
    solver considers reachable. Servo proxies clamp again with their
    own per-instance ``min_angle`` / ``max_angle`` so hardware never
    runs past its physical envelope even if the math says it can.
    """
    name: str = Field(..., description="Joint identifier, e.g. 'base', 'shoulder', 'elbow', 'wrist'.")
    type: Literal["revolute"] = Field(
        "revolute",
        description="Joint kinematics. v1 only supports revolute; prismatic + others land in v2.",
    )
    min_deg: float = Field(-180.0, description="Lower limit in degrees. Solutions outside this fail with joint_limit_violation.")
    max_deg: float = Field(180.0, description="Upper limit in degrees.")


class LinkSpec(ServiceConfig):
    """One link in the kinematic chain. Connects joint i to joint i+1.

    For an N-joint arm with base + (N-1) successive joints, expect
    (N-1) link entries. The last link's "next joint" is the
    end-effector itself.
    """
    length_mm: float = Field(..., gt=0, description="Distance from this link's origin joint to the next joint.")


class IKSolverConfig(ServiceConfig):
    """Persisted IK-solver config — the robot model, the calibration,
    the workspace tolerances. Survives restarts. Edited via the
    standard config wizard OR via the ``set_model`` /
    ``set_calibration`` actions.

    The defaults describe a generic 3-DOF arm (base + shoulder +
    elbow + 2 links of 180mm/160mm), matching the example in the
    PRD. Replace this with your actual arm's geometry on first
    install via the Composer's IK panel.

    Beyond the live geometry/calibration, the config also carries the
    Model Library working state: which library model is loaded
    (``model_id``/``model_title``/``model_source``), the rich kinematic
    ``chain`` (carried verbatim for the future 3-D solver), and the
    named ``poses``. ``save_model`` snapshots these to a library file;
    ``load_model`` hydrates them from one.
    """
    # model_* field names collide with pydantic's protected namespace;
    # opt out so the Model Library naming stays readable.
    model_config = ConfigDict(extra="allow", protected_namespaces=())

    model_id: Optional[str] = Field(None, description="Id of the loaded library model (None = ad-hoc, unsaved).")
    model_title: Optional[str] = Field(None, description="Human title of the loaded library model.")
    model_source: Optional[str] = Field(None, description="Provenance of the loaded model (e.g. 'inmoov_ros (URDF) -> ros.convert').")
    chain: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Rich per-joint kinematics (origin xyz/rpy + axis + limits) carried for the future general 3-D solver. Not used by the current planar solver.",
    )
    poses: List[Pose] = Field(
        default_factory=list,
        description="Named joint configurations; one flagged is_initial is applied on load.",
    )
    joints: List[JointSpec] = Field(
        default_factory=lambda: [
            JointSpec(name="base", min_deg=-180.0, max_deg=180.0),
            JointSpec(name="shoulder", min_deg=-30.0, max_deg=120.0),
            # Elbow allowed on EITHER side of zero so the IK can pick
            # the branch that keeps the chain above the floor. Most
            # tabletop targets are solved by the negative branch
            # (elbow joint above the line from shoulder to end-
            # effector); the positive branch typically dives below.
            JointSpec(name="elbow", min_deg=-150.0, max_deg=150.0),
        ],
        description="Joint chain. Order matters — base first, end-effector last.",
    )
    links: List[LinkSpec] = Field(
        default_factory=lambda: [
            LinkSpec(length_mm=180.0),
            LinkSpec(length_mm=160.0),
        ],
        description="Links between successive joints. Expect len(joints) - 1 entries for a chain rooted at base.",
    )
    calibration: List[JointCalibration] = Field(
        default_factory=lambda: [
            JointCalibration(joint="base"),
            JointCalibration(joint="shoulder"),
            JointCalibration(joint="elbow"),
        ],
        description="Per-joint servo calibration. One entry per joint.",
    )
    position_tolerance_mm: float = Field(
        2.0,
        description="FK(IK(t)) round-trip tolerance for the test suite. Solutions worse than this are still returned but flagged via position_error_mm in the reply.",
    )
    coordinate_frame: Literal["right_handed_z_up"] = Field(
        "right_handed_z_up",
        description="Documented + non-negotiable so the UI's axis labels match reality.",
    )


def max_reach_mm(model: IKSolverConfig) -> float:
    """Sum of link lengths — the absolute outer limit of the
    end-effector's workspace, ignoring joint limits. The actual
    reachable workspace is smaller (shaped by limits) but this is
    the fast pre-check before solving."""
    return sum(link.length_mm for link in model.links)


def min_reach_mm(model: IKSolverConfig) -> float:
    """Effective minimum reach — the dead zone near the base where
    no joint configuration can place the end effector. For a 2-link
    arm where elbow can fold fully, min reach is ``|L1 - L2|``;
    longer chains have a deeper dead zone depending on joint
    limits. Conservative estimate that doesn't claim more than the
    geometry allows."""
    if not model.links:
        return 0.0
    if len(model.links) == 1:
        return model.links[0].length_mm
    # 2-link or more — fold back to its own size.
    return abs(model.links[0].length_mm - sum(link.length_mm for link in model.links[1:]))
