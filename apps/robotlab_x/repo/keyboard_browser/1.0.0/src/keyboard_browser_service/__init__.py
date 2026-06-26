"""keyboard_browser_service — robotlab_x browser-keyboard subprocess service.

The browser-captured half of the ``keyboard`` capability (Level C — DOM
keydown/keyup, zero OS permissions). A lightweight relay: the browser does
the capture + publishes canonical key events; this backend owns the control
interface, the keymap (key→bus-action) layer, and the published state.
"""
__version__ = "1.0.0"
