"""Shared servo↔joint calibration — one primitive for every robotlab_x
service that drives or mirrors hardware servos (ik_solver,
robot_kinematics, …).

The IK / kinematics solvers always work in **mathematical joint
coordinates** (the URDF / RobotModel frame, degrees). A real servo has:

  * a different zero — a servo mounted mid-range calls "centred" 90°
    while the math wants 0° there,
  * a possibly flipped direction — a mirror-mounted servo's positive
    rotation is the math's negative,
  * a gear ratio — ``scale`` servo-degrees per math-degree (direct
    drive = 1.0),
  * physical bounds — ``servo_min_deg`` / ``servo_max_deg`` (a hobby
    servo's 0..180).

All of it collapses into ONE affine relation::

    servo° = math° · direction · scale + zero_offset_deg          (forward)
    math°  = (servo° − zero_offset_deg) / (direction · scale)     (inverse)

``direction`` is ±1 (its own multiplicative inverse); ``scale`` > 0.

The hard part operators kept getting wrong is picking sane knobs. A
freshly-linked servo with identity knobs (offset 0, scale 1) maps servo
0°→math 0° and servo 90°→math 90°, which slams straight into most joint
limits — the joint stops moving halfway through the servo's travel.
``auto_calibrate`` fixes that by fitting the joint's math range onto the
servo's usable range, so the servo's centre lands on the joint's centre
and full servo travel spans the full joint range.
"""
from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel


class JointCalibration(BaseModel):
    """math° ↔ servo° mapping for one joint.

    Shared verbatim by every service that binds joints to servos, so
    their on-the-wire + on-disk calibration shape can't diverge. Plain
    ``BaseModel`` (not ServiceConfig) — these are nested inside a
    service config / rig / model, never a top-level config themselves.
    """

    joint: str
    # Binds a live ``servo@1.0.0`` proxy id; None = computed but not driven.
    servo_proxy_id: Optional[str] = None
    # Servo angle (degrees) when the joint is at math 0. ~90 for a hobby
    # servo mounted mid-range at the joint's neutral.
    zero_offset_deg: float = 0.0
    # ±1 sign flip for mirror / upside-down mounts.
    direction: Literal[-1, 1] = 1
    # Gear ratio: servo degrees per math degree. Direct drive = 1.0.
    scale: float = 1.0
    # Physical servo bounds — solutions outside are rejected / clamped by
    # the consumer. Defaults match a standard 0..180° hobby servo.
    servo_min_deg: float = 0.0
    servo_max_deg: float = 180.0


def math_to_servo(cal: JointCalibration, math_angle_deg: float) -> float:
    """Forward map: math degrees → commanded servo degrees."""
    return (math_angle_deg * cal.direction * cal.scale) + cal.zero_offset_deg


def servo_to_math(cal: JointCalibration, servo_angle_deg: float) -> float:
    """Inverse map: a servo's read-back angle → the math angle it
    represents. Used to mirror live hardware into the solver view."""
    denom = cal.direction * cal.scale
    if denom == 0:
        # scale 0 ⇒ no servo motion per math degree; treat as fixed.
        return 0.0
    return (servo_angle_deg - cal.zero_offset_deg) / denom


def auto_calibrate(
    cal: JointCalibration,
    math_lo_deg: float,
    math_hi_deg: float,
    servo_lo_deg: float = 0.0,
    servo_hi_deg: float = 180.0,
    direction: Literal[-1, 1] = 1,
) -> JointCalibration:
    """Fit a sensible affine map: the joint's math range
    ``[math_lo, math_hi]`` onto the servo's usable range
    ``[servo_lo, servo_hi]``.

    With ``direction=+1`` the joint's lower limit maps to ``servo_lo``
    and its upper to ``servo_hi``; ``direction=-1`` flips that. The
    result centres the servo (e.g. 90°) on the joint's mid-range and
    makes full servo travel cover the full joint range — so a head-pan
    joint with math range ±90° and a 0..180° servo gets ``scale=1``,
    ``zero_offset=90`` (servo 90 = head forward).

    Returns a NEW JointCalibration (copy of ``cal``) with
    ``direction`` / ``scale`` / ``zero_offset_deg`` / ``servo_min_deg``
    / ``servo_max_deg`` set; ``joint`` and ``servo_proxy_id`` are
    preserved. Degenerate (zero-width) math ranges fall back to identity
    scale so the call never divides by zero.
    """
    m_lo, m_hi = sorted((float(math_lo_deg), float(math_hi_deg)))
    s_lo, s_hi = sorted((float(servo_lo_deg), float(servo_hi_deg)))
    math_span = m_hi - m_lo
    servo_span = s_hi - s_lo
    scale = abs(servo_span / math_span) if abs(math_span) > 1e-9 else 1.0
    if scale <= 0:
        scale = 1.0
    direction = -1 if int(direction) < 0 else 1
    # Solve zero_offset so the joint's lower limit hits the intended
    # servo end. servo = math·dir·scale + offset.
    if direction >= 0:
        zero_offset = s_lo - (m_lo * scale)       # math_lo → s_lo
    else:
        zero_offset = s_hi + (m_lo * scale)       # math_lo → s_hi
    return cal.model_copy(update={
        "direction": direction,
        "scale": float(scale),
        "zero_offset_deg": float(zero_offset),
        "servo_min_deg": float(s_lo),
        "servo_max_deg": float(s_hi),
    })


def calibration_for(
    calibrations: List[JointCalibration], joint_name: str,
) -> Optional[JointCalibration]:
    """Look up the calibration entry for a joint. ``None`` means no
    calibration configured — the consumer treats that as identity
    (direction 1, offset 0, scale 1)."""
    for cal in calibrations:
        if cal.joint == joint_name:
            return cal
    return None


def calibrate_all(
    calibrations: List[JointCalibration],
    joint_angles_deg: Dict[str, float],
) -> Dict[str, Dict[str, float]]:
    """Enrich a ``{joint: math°}`` map into ``{joint: {math, servo}}``
    for UI display. Joints without a calibration get ``servo == math``
    (identity). Every supplied joint is included so the UI can render
    them all even before calibration is set up."""
    out: Dict[str, Dict[str, float]] = {}
    for joint, math_a in joint_angles_deg.items():
        math_a = float(math_a)
        cal = calibration_for(calibrations, joint)
        servo_a = math_to_servo(cal, math_a) if cal is not None else math_a
        out[joint] = {"math": round(math_a, 3), "servo": round(servo_a, 3)}
    return out


__all__ = [
    "JointCalibration",
    "math_to_servo",
    "servo_to_math",
    "auto_calibrate",
    "calibration_for",
    "calibrate_all",
]
