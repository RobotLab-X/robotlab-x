"""rlx_bus — WebSocket bus client + subprocess-service helpers for robotlab_x.

Public surface:

    BusClient            Construct manually with backend_url + token.
    from_env             Build a BusClient from process_manager-injected env vars.
    SubprocessService    Base class for subprocess services. Mirrors
                         robotlab_x.framework.Service so writing a service
                         feels the same regardless of transport.
    service_method       Decorator marking a callable as bus-routable + discoverable.
    MethodInfo           Per-method metadata returned by ``methods()``.
"""
from .bus_serial import BusBackedSerial
from .client import BusClient, from_env
from .config import ServiceConfig
from .methods import MethodInfo, collect_methods, service_method
from .serial_ports import list_ports as list_serial_ports, scan_port_holders
from .service import SubprocessService
from .streams import Stream

__all__ = [
    "BusClient",
    "BusBackedSerial",
    "from_env",
    "MethodInfo",
    "collect_methods",
    "service_method",
    "ServiceConfig",
    "Stream",
    "SubprocessService",
    # Serial port enumeration — shared so every service that opens
    # /dev/tty* gets the same dropdown + ownership story without
    # duplicating the logic per service.
    "list_serial_ports",
    "scan_port_holders",
]
__version__ = "0.3.0"
