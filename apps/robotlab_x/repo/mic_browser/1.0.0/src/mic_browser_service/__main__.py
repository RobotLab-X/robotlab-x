"""mic_browser_service entry point. Control + publish shape live in
rlx_audio.MicrophoneServiceBase; this service relays control to the
browser and folds browser reports into the canonical state."""
from __future__ import annotations

import sys

from .service import MicBrowserService


def main() -> int:
    return MicBrowserService.run()


if __name__ == "__main__":
    sys.exit(main())
