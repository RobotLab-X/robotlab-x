"""Coordinate-frame conversion: WebXR → robotlab_x.

WebXR poses are **Y-up, metres, right-handed** in the session's
reference space. robotlab_x is **Z-up, millimetres, right-handed**
(matching the URDF / robot_kinematics convention). The mapping is a
fixed +90° rotation about X (so Y-up becomes Z-up) plus a metres→mm
scale:

    x_rob =  x_xr
    y_rob = -z_xr
    z_rob =  y_xr        (then × 1000 for mm)

Orientation is the same basis change applied as a quaternion
pre-multiply. Recentering is a translation offset captured at
"set origin" time (full yaw-alignment is a later refinement).

Pure-Python (quaternions as ``[x, y, z, w]``) so the service needs no
numpy — the math is tiny and runs per input frame at ~60 Hz.
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional, Sequence

# +90° about X: maps Y-up → Z-up. [x, y, z, w].
_HALF = math.sqrt(0.5)
Q_XR_TO_ROBOT = (_HALF, 0.0, 0.0, _HALF)


def quat_mul(a: Sequence[float], b: Sequence[float]) -> List[float]:
    """Hamilton product a·b, quaternions as [x, y, z, w]."""
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ]


def quat_rotate(q: Sequence[float], v: Sequence[float]) -> List[float]:
    """Rotate vector ``v`` by quaternion ``q`` ([x,y,z,w])."""
    qx, qy, qz, qw = q
    vx, vy, vz = v
    # t = 2 * cross(q.xyz, v)
    tx = 2.0 * (qy * vz - qz * vy)
    ty = 2.0 * (qz * vx - qx * vz)
    tz = 2.0 * (qx * vy - qy * vx)
    # v' = v + qw * t + cross(q.xyz, t)
    return [
        vx + qw * tx + (qy * tz - qz * ty),
        vy + qw * ty + (qz * tx - qx * tz),
        vz + qw * tz + (qx * ty - qy * tx),
    ]


def point_to_robot_mm(p_xr_m: Sequence[float]) -> List[float]:
    """XR position (metres, Y-up) → robot position (mm, Z-up)."""
    r = quat_rotate(Q_XR_TO_ROBOT, p_xr_m)
    return [r[0] * 1000.0, r[1] * 1000.0, r[2] * 1000.0]


def quat_to_robot(q_xr: Sequence[float]) -> List[float]:
    """XR orientation → robot orientation (same basis change)."""
    return quat_mul(Q_XR_TO_ROBOT, q_xr)


def transform_pose(
    pose: Dict[str, Sequence[float]],
    origin_mm: Optional[Sequence[float]] = None,
) -> Dict[str, List[float]]:
    """Convert one ``{position:[x,y,z]_m, orientation:[x,y,z,w]}`` XR pose
    into robot frame ``{pos:[x,y,z]_mm, quat:[x,y,z,w]}``. Subtracts
    ``origin_mm`` (a recenter offset already in robot mm) from the
    position when provided."""
    pos = point_to_robot_mm(pose.get("position", (0.0, 0.0, 0.0)))
    if origin_mm is not None:
        pos = [pos[i] - origin_mm[i] for i in range(3)]
    quat = quat_to_robot(pose.get("orientation", (0.0, 0.0, 0.0, 1.0)))
    return {"pos": [round(c, 2) for c in pos], "quat": [round(c, 5) for c in quat]}
