"""Forward kinematics — joint angles → end-effector pose.

The model: base rotates around Z; subsequent joints rotate in the
shoulder plane (the plane containing Z and the projected radius
``r = sqrt(x² + y²)``). Each link extends along the local "forward"
direction after the joint's rotation.

Used by:
  * IK validation — FK(IK(target)) should reproduce target within
    ``position_tolerance_mm``.
  * UI rendering — the side-view + top-view projections need every
    joint's world position, not just the end effector.
  * The scipy numerical fallback's objective function.

Returns are kept in millimetres + degrees at the API surface; the
math itself uses radians internally for cleaner trig.
"""
from __future__ import annotations

import math
from typing import Dict, List, Tuple

from .model import IKSolverConfig


def forward_kinematics(
    model: IKSolverConfig, joint_angles_deg: Dict[str, float],
) -> Dict[str, float]:
    """Compute the end-effector pose given joint angles.

    Returns ``{x, y, z, roll, pitch, yaw}`` in mm + degrees.
    ``roll`` is always 0 for the v1 model (no twist joints);
    ``pitch`` is the sum of all in-plane joint angles (the
    end-effector's tilt relative to horizontal); ``yaw`` mirrors
    the base joint.

    Missing joint entries default to 0 — callers that forget the
    wrist still get the end-effector position for the joints they
    did specify.
    """
    positions = joint_world_positions(model, joint_angles_deg)
    end = positions[-1] if positions else (0.0, 0.0, 0.0)

    base_deg = float(joint_angles_deg.get("base", 0.0))
    # Pitch = sum of in-plane joint angles (shoulder + elbow + ...).
    # The "in-plane" joints are everything except base.
    in_plane = sum(
        float(joint_angles_deg.get(j.name, 0.0))
        for j in model.joints
        if j.name != "base"
    )
    return {
        "x": end[0],
        "y": end[1],
        "z": end[2],
        "roll": 0.0,
        "pitch": in_plane,
        "yaw": base_deg,
    }


def joint_world_positions(
    model: IKSolverConfig, joint_angles_deg: Dict[str, float],
) -> List[Tuple[float, float, float]]:
    """Return the (x, y, z) world position of each joint in order,
    PLUS the end-effector position as the final entry.

    For an N-joint arm with (N-1) links, the returned list has
    length N + 1: ``[joint_0_pos, joint_1_pos, ..., joint_(N-1)_pos, end_effector_pos]``.

    Each joint i is at the START of link i (except the base which
    is at the origin). The end effector is at the END of the last
    link.

    Used by the UI to render the arm — each pair of consecutive
    positions defines a line segment.
    """
    base_rad = math.radians(float(joint_angles_deg.get("base", 0.0)))
    # ``in_plane`` joints (shoulder, elbow, ...) rotate inside the
    # plane defined by Z and the base direction. They share a 2D
    # local frame (r, z) where r is the projected radius.
    in_plane_angles_rad = [
        math.radians(float(joint_angles_deg.get(j.name, 0.0)))
        for j in model.joints
        if j.name != "base"
    ]

    # All joints sit at the origin until the first link kicks the
    # chain out. Base + shoulder share (0,0,0); after L1 we move to
    # the elbow position; after L2 we reach the end effector.
    positions: List[Tuple[float, float, float]] = []
    positions.append((0.0, 0.0, 0.0))   # base
    if len(model.joints) > 1:
        positions.append((0.0, 0.0, 0.0))   # shoulder co-located with base in this simple model

    # Walk the chain link-by-link in the local (r, z) plane.
    r = 0.0
    z = 0.0
    cumulative_angle = 0.0
    for i, link in enumerate(model.links):
        if i < len(in_plane_angles_rad):
            cumulative_angle += in_plane_angles_rad[i]
        # Each link extends ``length`` units along the cumulative
        # rotation. Shoulder angle 0 = horizontal forward; positive
        # = upward.
        r += link.length_mm * math.cos(cumulative_angle)
        z += link.length_mm * math.sin(cumulative_angle)
        # Rotate (r, 0, z) by base around Z to get world (x, y, z).
        x = r * math.cos(base_rad)
        y = r * math.sin(base_rad)
        positions.append((x, y, z))
    return positions
