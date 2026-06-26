"""ik_solver_service entry point — same shape as arduino / serial."""
from __future__ import annotations

import sys

from .service import IKSolverService


def main() -> int:
    return IKSolverService.run()


if __name__ == "__main__":
    sys.exit(main())
