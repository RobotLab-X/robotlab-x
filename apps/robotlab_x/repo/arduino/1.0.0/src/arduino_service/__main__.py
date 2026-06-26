"""arduino_service entry point.

All boilerplate (env loading, bus client, hello announce, control topic
subscription, heartbeat, signal handling, graceful shutdown) lives in
``rlx_bus.SubprocessService.run``. The whole entry shrinks to a
single call against the service class itself.
"""
from __future__ import annotations

import sys

from .service import ArduinoService


def main() -> int:
    return ArduinoService.run()


if __name__ == "__main__":
    sys.exit(main())
