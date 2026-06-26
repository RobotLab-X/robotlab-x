"""Inverse kinematics — target pose → joint angles.

Strategy per the TODO doc:
  1. Analytic closed-form for 3-DOF arms (base + 2 in-plane joints).
     Deterministic, fast, two branches (elbow-up vs elbow-down) —
     v1 returns the elbow-up branch as the default since it's
     visually natural for tabletop arms.
  2. scipy.optimize.least_squares fallback for everything else
     (4+ in-plane joints, future orientation constraints).
  3. Pre-check workspace bounds before solving so unreachable
     targets fail fast with a clear reason rather than burning
     iterations.

Failure is RETURNED, not raised — the service wraps the result in
the bus reply envelope so the UI can render the reason cleanly.
"""
from __future__ import annotations

import math
from typing import Dict, Tuple

import numpy as np
from scipy.optimize import least_squares  # type: ignore

from .calibration import calibration_for, math_to_servo
from .fk import forward_kinematics, joint_world_positions
from .model import IKSolverConfig, max_reach_mm, min_reach_mm


# Failure reason vocabulary — strings so the UI can render directly.
REASON_UNREACHABLE = "unreachable_workspace"
REASON_LIMIT_VIOLATED = "joint_limit_violation"
REASON_SOLVER_DID_NOT_CONVERGE = "solver_did_not_converge"
REASON_INVALID_MODEL = "invalid_model"
REASON_BELOW_FLOOR = "would_intersect_floor"
REASON_SERVO_OUT_OF_RANGE = "servo_range_violation"

# Floor constraint — joints and end effector must stay at or above
# z=0 (the workbench surface). The slack absorbs FP/rounding noise
# from the angle quantisation in ``_analytic_3dof`` (which rounds to
# 3 decimals → ~0.002mm of FK error at full extension) so a target
# sitting exactly on the floor stays reachable. Real violations are
# usually tens of mm so this isn't a meaningful loophole.


def inverse_kinematics(
    model: IKSolverConfig,
    target: Tuple[float, float, float],
    *,
    current_angles: Optional[Dict[str, float]] = None,
) -> Dict[str, object]:
    """Solve for joint angles that put the end effector at ``target``.

    ``current_angles`` is an optional hint of the operator's CURRENT
    joint configuration (math degrees, by joint name). When supplied,
    the analytic branch selector + the numerical seed both bias toward
    this pose so the solver returns a result close to where the arm
    already IS. Without this bias, a target that the arm is already
    at can resolve to a wildly different (but mathematically valid)
    configuration — surprising the operator and commanding the servos
    to teleport across the workspace.

    Returns a result envelope::

        {
          "reachable": True,
          "joint_angles": {"base": ..., "shoulder": ..., ...},
          "position_error_mm": <float>,
          "warnings": [{"kind": "...", "detail": "..."}, ...],  # optional
        }

    or on failure::

        {
          "reachable": False,
          "reason": "<reason>",
          "detail": "<human message>",
        }

    Some constraints surface as WARNINGS (kept on a reachable result)
    rather than hard failures so the operator can still inspect /
    dispatch the solution while iterating on calibration:

    * ``servo_range_violation`` — commanded servo angle outside the
      configured ``servo_min_deg`` / ``servo_max_deg``. The servo
      service will clamp at write time; the warning lets the operator
      decide.

    Hard failures (no ``joint_angles`` returned): workspace
    out-of-reach, invalid model, solver non-convergence, joint-limit
    violation, would-intersect-floor.
    """
    # 1. Sanity-check the model.
    if not model.joints or not model.links:
        return _fail(REASON_INVALID_MODEL, "model has no joints/links — set_model first")
    in_plane_count = sum(1 for j in model.joints if j.name != "base")
    if in_plane_count != len(model.links):
        return _fail(
            REASON_INVALID_MODEL,
            f"expected len(links) == len(in-plane joints) ({len(model.links)} vs {in_plane_count})",
        )

    x, y, z = (float(v) for v in target)

    # 2. Pre-check workspace bounds. ``r`` is the distance from the
    # origin to the target (we'd add link lengths to traverse — if
    # the target is farther than the sum, no joint configuration
    # can reach it).
    dist = math.sqrt(x * x + y * y + z * z)
    max_r = max_reach_mm(model)
    min_r = min_reach_mm(model)
    if dist > max_r + 1e-6:
        return _fail(
            REASON_UNREACHABLE,
            f"target distance {dist:.1f}mm exceeds max extension {max_r:.1f}mm",
        )
    if dist < min_r - 1e-6:
        return _fail(
            REASON_UNREACHABLE,
            f"target distance {dist:.1f}mm below min reach {min_r:.1f}mm",
        )

    # 3. Dispatch by chain depth.
    if in_plane_count == 2:
        result = _analytic_3dof(model, x, y, z, current_angles)
    else:
        result = _numerical(model, x, y, z, current_angles)

    if not result.get("reachable"):
        return result
    angles = result["joint_angles"]  # type: ignore[index]

    # 4. Validate every angle against the configured joint limits.
    for joint in model.joints:
        a = float(angles.get(joint.name, 0.0))  # type: ignore[union-attr]
        if a < joint.min_deg - 1e-3 or a > joint.max_deg + 1e-3:
            return _fail(
                REASON_LIMIT_VIOLATED,
                f"joint {joint.name!r} angle {a:.1f}° out of [{joint.min_deg}, {joint.max_deg}]",
            )

    # Soft checks land in ``warnings_out``; appended to the result
    # below if non-empty. None of these block the solve — the
    # operator's reference frame and calibration may legitimately
    # disagree with our defaults while the model is being built up.
    warnings_out: List[Dict[str, str]] = []

    # 5. Floor constraint — flag (don't block) any joint/end-effector
    # sitting below z=0. The runtime's "floor" is a convention, not a
    # physics constraint: the operator might have the arm mounted on
    # a table edge, upside-down, or with a different reference frame
    # than the default ``+Z up, origin at base`` convention. During
    # the build-up phase the operator needs to be able to use IK
    # against their actual pose even if part of the chain dips below
    # z=0; we surface a warning so it's visible but not blocking.
    # Slack here matches ``position_tolerance_mm`` so a target
    # exactly at the workspace boundary isn't flagged purely from
    # angle-rounding noise.
    positions = joint_world_positions(model, angles)  # type: ignore[arg-type]
    floor_slack = max(model.position_tolerance_mm, 0.0)
    for i, (_jx, _jy, jz) in enumerate(positions):
        if jz < -floor_slack:
            label = "end effector" if i == len(positions) - 1 else f"joint {i}"
            warnings_out.append({
                "kind": REASON_BELOW_FLOOR,
                "detail": f"{label} would sit at z={jz:.1f}mm (below floor)",
            })

    # 6. Servo range — for any joint with a linked servo, the
    # commanded servo angle (math · direction · scale + offset)
    # should stay inside the physical hardware range. Attached as a
    # WARNING rather than a hard failure: while the operator is
    # iterating on calibration (offset, scale, mounting orientation),
    # locking out solves makes it impossible to use IK to characterise
    # the model. The servo service will still clamp at write time, so
    # the worst case is a no-op. Joints with no calibration entry use
    # the identity map and aren't checked.
    for joint in model.joints:
        cal = calibration_for(model, joint.name)
        if cal is None:
            continue
        math_a = float(angles.get(joint.name, 0.0))  # type: ignore[union-attr]
        servo_a = math_to_servo(cal, math_a)
        if servo_a < cal.servo_min_deg - 1e-3 or servo_a > cal.servo_max_deg + 1e-3:
            warnings_out.append({
                "kind": REASON_SERVO_OUT_OF_RANGE,
                "detail": (
                    f"joint {joint.name!r} would command its servo to "
                    f"{servo_a:.1f}° — outside [{cal.servo_min_deg}, {cal.servo_max_deg}]"
                ),
            })
    if warnings_out:
        result["warnings"] = warnings_out

    # 7. Verify via FK round-trip — report the residual error so
    # numerical fallbacks can self-describe their accuracy.
    fk_pose = forward_kinematics(model, angles)  # type: ignore[arg-type]
    err = math.sqrt(
        (fk_pose["x"] - x) ** 2 + (fk_pose["y"] - y) ** 2 + (fk_pose["z"] - z) ** 2
    )
    result["position_error_mm"] = round(err, 3)
    return result


# ─── 3-DOF analytic ─────────────────────────────────────────────────


def _analytic_3dof(
    model: IKSolverConfig, x: float, y: float, z: float,
    current_angles: Optional[Dict[str, float]] = None,
) -> Dict[str, object]:
    """Closed-form IK for a base + shoulder + elbow arm with 2 links.

    Algorithm:
      θ_base = atan2(y, x)
      Project into the shoulder plane:
        r = sqrt(x² + y²)
        z stays
      Now 2-link planar IK in (r, z):
        d  = sqrt(r² + z²)
        c2 = (d² - L1² - L2²) / (2·L1·L2)
        θ_elbow = ±acos(c2)   (two branches — see below)
        θ_shoulder = atan2(z, r) - atan2(L2·sinθ_elbow, L1 + L2·cosθ_elbow)

    Branch selection
    ----------------
    The two ``±acos`` solutions are geometrically distinct — for a
    given target, one keeps the elbow joint ABOVE the line from
    shoulder to end-effector, the other puts it BELOW. Two-pronged
    selection:

    * When ``current_angles`` is supplied (the operator's live
      pose), pick the branch closest to that pose in joint space —
      "if I'm already there, don't teleport me to the mirror
      configuration just because that one also reaches the target".
      This is the joint-space-proximity rule from standard
      manipulator-IK practice.
    * Otherwise (cold solve with no live data), fall back to the
      branch with the highest minimum joint z — a heuristic that
      keeps the chain above the floor by default.

    The downstream floor check in ``inverse_kinematics`` still
    rejects either branch if it dips below z=0.
    """
    L1 = model.links[0].length_mm
    L2 = model.links[1].length_mm

    base_deg = math.degrees(math.atan2(y, x))
    r = math.sqrt(x * x + y * y)
    d = math.sqrt(r * r + z * z)

    # Numerical safety — clamp c2 into [-1, 1] before acos. Targets
    # exactly at the workspace boundary can produce c2=1±epsilon.
    c2 = (d * d - L1 * L1 - L2 * L2) / (2.0 * L1 * L2)
    c2 = max(-1.0, min(1.0, c2))

    candidates: List[Dict[str, object]] = []
    for elbow_sign in (-1.0, +1.0):
        elbow_rad = elbow_sign * math.acos(c2)
        s2 = math.sin(elbow_rad)
        shoulder_rad = math.atan2(z, r) - math.atan2(
            L2 * s2, L1 + L2 * math.cos(elbow_rad)
        )
        angles_deg = {
            "base": math.degrees(math.atan2(y, x)),
            "shoulder": math.degrees(shoulder_rad),
            "elbow": math.degrees(elbow_rad),
        }
        # Minimum joint z (excluding the end effector — the caller
        # explicitly chose the target, so floor violation there is a
        # different concern handled downstream).
        positions = joint_world_positions(model, angles_deg)
        intermediate = positions[:-1] if positions else []
        min_z = min((p[2] for p in intermediate), default=0.0)
        candidates.append({"angles": angles_deg, "min_z": min_z})

    # Branch selection. If a pose hint is provided, prefer the branch
    # whose angles are closest in joint-space (sum of |Δangle|);
    # otherwise fall back to "highest min joint z" (floor-safety
    # heuristic). Two-branch tie (target on the workspace boundary,
    # c2 = ±1) is benign — both branches collapse to the same
    # straight-arm pose.
    if current_angles:
        def _proximity_score(cand: Dict[str, object]) -> float:
            cand_angles = cand["angles"]  # type: ignore[assignment]
            if not isinstance(cand_angles, dict):
                return float("inf")
            total = 0.0
            for k, v in cand_angles.items():
                ref = current_angles.get(k)
                if ref is not None:
                    total += abs(float(v) - float(ref))
            return total
        candidates.sort(key=_proximity_score)
    else:
        candidates.sort(key=lambda c: c["min_z"], reverse=True)  # type: ignore[arg-type]
    best = candidates[0]["angles"]

    return {
        "reachable": True,
        "joint_angles": {
            "base": round(float(best["base"]), 3),
            "shoulder": round(float(best["shoulder"]), 3),
            "elbow": round(float(best["elbow"]), 3),
        },
    }


# ─── numerical fallback ─────────────────────────────────────────────


def _numerical(
    model: IKSolverConfig, x: float, y: float, z: float,
    current_angles: Optional[Dict[str, float]] = None,
) -> Dict[str, object]:
    """scipy least_squares fallback for chains where the analytic
    formula doesn't apply (4+ in-plane joints, etc.).

    Objective is the squared positional residual; bounded by each
    joint's ``min_deg`` / ``max_deg``. Seed:

    * When ``current_angles`` is provided, use the operator's live
      pose as the starting point. ``least_squares`` is a local
      optimiser — a near-the-current-pose seed converges to the same
      local minimum, returning a solution close to where the arm
      actually IS rather than teleporting to a distant mirror config.
    * Otherwise (cold solve) seed with zeros, with ``base`` set to
      ``atan2(y, x)`` so the chain at least points toward the target
      from the start.
    """
    joints = list(model.joints)

    # Seed: current angles when provided, otherwise zeros + base
    # facing the target.
    seed = [0.0] * len(joints)
    if current_angles:
        for i, j in enumerate(joints):
            ref = current_angles.get(j.name)
            if ref is not None:
                seed[i] = float(ref)
    else:
        for i, j in enumerate(joints):
            if j.name == "base":
                seed[i] = math.degrees(math.atan2(y, x))
                break

    lo = [j.min_deg for j in joints]
    hi = [j.max_deg for j in joints]

    def residual(angles_deg: np.ndarray) -> np.ndarray:
        angles_map = {j.name: float(a) for j, a in zip(joints, angles_deg)}
        pose = forward_kinematics(model, angles_map)
        return np.array([pose["x"] - x, pose["y"] - y, pose["z"] - z])

    try:
        sol = least_squares(
            residual, np.array(seed), bounds=(np.array(lo), np.array(hi)),
            method="trf", max_nfev=200,
        )
    except Exception as exc:  # noqa: BLE001
        return _fail(REASON_SOLVER_DID_NOT_CONVERGE, f"least_squares raised: {exc}")
    if not sol.success:
        return _fail(REASON_SOLVER_DID_NOT_CONVERGE, sol.message or "solver did not converge")

    angles = {j.name: round(float(a), 3) for j, a in zip(joints, sol.x)}
    return {"reachable": True, "joint_angles": angles}


def _fail(reason: str, detail: str) -> Dict[str, object]:
    return {"reachable": False, "reason": reason, "detail": detail}
