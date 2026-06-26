"""raspi_service entry point — delegates to SubprocessService.run()."""
from __future__ import annotations

import sys

from .service import RaspiService


def main() -> int:
    return RaspiService.run()


if __name__ == "__main__":
    sys.exit(main())
