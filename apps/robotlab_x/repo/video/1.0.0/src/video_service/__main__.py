"""video_service entry point.

All boilerplate (env loading, bus client, hello announce, control topic
subscription, signal handling, graceful shutdown) lives in
``rlx_bus.SubprocessService.run``. The whole entry shrinks to a
single call against the service class itself.
"""
from __future__ import annotations

import sys

from .service import VideoService


def main() -> int:
    return VideoService.run()


if __name__ == "__main__":
    sys.exit(main())
