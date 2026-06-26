"""stt_local_service entry point. The listen/start/stop/select_input/mute
interface + recognizer loop + utterance queue live in
rlx_audio.SttServiceBase; this service implements the sherpa-onnx backend."""
from __future__ import annotations

import sys

from .service import SttLocalService


def main() -> int:
    return SttLocalService.run()


if __name__ == "__main__":
    sys.exit(main())
