"""webxr_service entry point — delegates to SubprocessService.run()."""
from __future__ import annotations

import sys

from .service import WebXRService


def main() -> int:
    return WebXRService.run()


if __name__ == "__main__":
    sys.exit(main())
