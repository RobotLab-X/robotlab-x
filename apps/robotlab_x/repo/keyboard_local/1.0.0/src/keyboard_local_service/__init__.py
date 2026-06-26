"""keyboard_local_service — robotlab_x host-keyboard subprocess service.

The OS-captured half of the ``keyboard`` capability (Levels A/B). Captures
the host keyboard via evdev (Linux/RasPi — works under Wayland + headless,
exclusive grab) or pynput (Windows / macOS / X11), auto-selected, and
publishes the same canonical events + runs the same keymap as the browser
half.
"""
__version__ = "1.0.0"
