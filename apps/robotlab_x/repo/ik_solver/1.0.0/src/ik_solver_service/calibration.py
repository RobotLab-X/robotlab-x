"""Math-angle ↔ servo-angle mapping — model-aware adapters.

The affine map itself (``math_to_servo`` / ``servo_to_math`` /
``auto_calibrate``) lives in the shared ``rlx_servo_cal`` package so the
ik_solver and robot_kinematics services use ONE calibration primitive
that can't drift. This module re-exports those and adds two thin helpers
that know about this service's ``IKSolverConfig`` shape (its
``calibration`` list + ``joints`` list).

    servo_angle = (math_angle * direction * scale) + zero_offset_deg
    math_angle  = (servo_angle - zero_offset_deg) / (direction * scale)
"""
from __future__ import annotations

from typing import Dict, Optional

from rlx_servo_cal import (  # noqa: F401 — re-exported for callers
    JointCalibration,
    auto_calibrate,
    math_to_servo,
    servo_to_math,
)

from .model import IKSolverConfig


def calibration_for(
    model: IKSolverConfig, joint_name: str,
) -> Optional[JointCalibration]:
    """Look up the JointCalibration entry for a joint by name.
    Returns ``None`` when no calibration is configured — the
    service treats that as direction=1, offset=0 (identity)."""
    for cal in model.calibration:
        if cal.joint == joint_name:
            return cal
    return None


def calibrate_all(
    model: IKSolverConfig, joint_angles_deg: Dict[str, float],
) -> Dict[str, Dict[str, float]]:
    """Produce the ``joint_angles`` payload shape consumers expect::

        {
          "base":     {"math": 31.2, "servo": 121.2},
          "shoulder": {"math": 42.7, "servo": 137.3},
          ...
        }

    Joints with no calibration entry get servo == math (identity
    mapping). Always-included so the UI can render every joint
    even before calibration is set up."""
    out: Dict[str, Dict[str, float]] = {}
    for joint in model.joints:
        math_a = float(joint_angles_deg.get(joint.name, 0.0))
        cal = calibration_for(model, joint.name)
        servo_a = math_to_servo(cal, math_a) if cal is not None else math_a
        out[joint.name] = {"math": round(math_a, 3), "servo": round(servo_a, 3)}
    return out
