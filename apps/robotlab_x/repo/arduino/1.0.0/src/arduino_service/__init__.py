"""arduino_service — robotlab_x arduino subprocess service.

The package is intentionally tiny in v1: ``__main__`` autodetects serial
devices that look like arduinos and idles. Real pymata4 wiring (pin
read/write, service_method exposure over the bus) is the next step.
"""
__version__ = "1.0.0"
