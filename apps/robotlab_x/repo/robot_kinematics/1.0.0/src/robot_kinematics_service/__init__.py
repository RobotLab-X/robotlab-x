"""robot_kinematics — whole-body multi-chain IK for robotlab_x.

Pinocchio + Pink task-based differential IK over a full URDF: multiple
end-effectors (arms reach, head look-at) solved together so shared joints
coordinate and limits hold. See service.py for the wire contract.

NOTE: this __init__ intentionally does NOT import service.py — that pulls
the heavy solver deps (pinocchio/pink). The entry point (__main__) imports
the service directly, and rig.py / rig_lib.py stay importable (pydantic
only) for tooling + tests without the solver venv.
"""
