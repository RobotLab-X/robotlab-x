"""speaker_browser_service entry point. Control + state live in
rlx_audio.SpeakerServiceBase; the browser does playback."""
from __future__ import annotations

import sys

from .service import SpeakerBrowserService


def main() -> int:
    return SpeakerBrowserService.run()


if __name__ == "__main__":
    sys.exit(main())
