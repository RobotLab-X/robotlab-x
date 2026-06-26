"""speaker_local_service entry point. Control + state live in
rlx_audio.SpeakerServiceBase; this service plays PCM to a host device."""
from __future__ import annotations

import sys

from .service import SpeakerLocalService


def main() -> int:
    return SpeakerLocalService.run()


if __name__ == "__main__":
    sys.exit(main())
