"""ros_service entry point — delegates to SubprocessService.run()."""
from __future__ import annotations

import sys

from .service import RosService


def main() -> int:
    return RosService.run()


if __name__ == "__main__":
    sys.exit(main())
