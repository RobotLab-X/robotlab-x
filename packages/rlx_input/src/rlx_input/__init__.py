"""rlx_input — shared input-device capabilities for robotlab_x services.

    KeyboardServiceBase   common control interface (capture/scope/suppress +
                          keymap→bus-action bindings + canonical event shape).
    KeyboardConfig        persisted config.
    make_event / normalize_event / event_matches / normalize_combo / …
                          the canonical key-event wire schema + keymap matching.

Parallel to rlx_audio: one shared base so a browser-captured and a
host-captured keyboard publish the IDENTICAL bus shape and can't drift.
"""
from .base import KeyboardConfig, KeyboardServiceBase
from .events import (
    MODIFIERS,
    binding_matches,
    event_matches,
    event_token,
    make_event,
    normalize_combo,
    normalize_event,
)

__all__ = [
    "KeyboardServiceBase",
    "KeyboardConfig",
    "MODIFIERS",
    "make_event",
    "normalize_event",
    "event_token",
    "normalize_combo",
    "event_matches",
    "binding_matches",
]
__version__ = "0.1.0"
