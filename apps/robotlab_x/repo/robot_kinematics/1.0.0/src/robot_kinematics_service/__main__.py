"""robot_kinematics_service entry point — delegates to SubprocessService.run()."""
from __future__ import annotations

import sys

from .service import RobotKinematicsService


def main() -> int:
    return RobotKinematicsService.run()


if __name__ == "__main__":
    sys.exit(main())
