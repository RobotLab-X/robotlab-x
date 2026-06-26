"""mic_local_service entry point.

Boilerplate (env, bus client, hello announce, control subscription,
graceful shutdown) lives in ``rlx_bus.SubprocessService.run``; the
microphone control interface lives in ``rlx_audio.MicrophoneServiceBase``.
"""
from __future__ import annotations

import sys

from .service import MicLocalService


def main() -> int:
    return MicLocalService.run()


if __name__ == "__main__":
    sys.exit(main())
