"""arduino_telemetrix_service — robotlab_x Telemetrix arduino service.

A modern-Firmata (Telemetrix) board backend. Unlike the pymata4
``arduino`` service, the Telemetrix sketch can drive addressable
NeoPixel/WS2812 strips and matrices, so this service exposes both the
``servo_controller`` and ``pixel_strip`` capability interfaces.
"""
__version__ = "1.0.0"
