"""speech_local_service entry point. The say/stop/mute/cache/streaming
interface lives in rlx_audio.SpeechServiceBase; this service implements the
Piper synthesis backend."""
from __future__ import annotations

import sys

from .service import SpeechLocalService


def main() -> int:
    return SpeechLocalService.run()


if __name__ == "__main__":
    sys.exit(main())
