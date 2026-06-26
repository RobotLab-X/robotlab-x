# unmanaged
"""robotlab_x service framework.

This package defines the uniform API every service speaks regardless of
where its code actually executes — in this Python process, in a
subprocess, in a container, or on a remote node.

The split is:
  * Service (service.py)         — what a service IS. Subclass this to
                                    implement an in-process service.
  * ServiceAdapter (adapter.py)  — HOW a service runs. One concrete
                                    adapter per transport (in-process,
                                    subprocess, docker, remote).
  * registry.py                  — live ServiceHandle store keyed by
                                    proxy_id.
  * dispatch.py                  — picks the right adapter from a
                                    PackageManifest / service_meta row.

Lifecycle.py talks only to the framework; it no longer branches on the
service language.
"""

from .service import Service, ServiceMetadata
from .methods import service_method, MethodInfo
from .adapter import ServiceAdapter, ServiceHandle
from .registry import REGISTRY
from .dispatch import pick_adapter

__all__ = [
    "Service",
    "ServiceMetadata",
    "service_method",
    "MethodInfo",
    "ServiceAdapter",
    "ServiceHandle",
    "REGISTRY",
    "pick_adapter",
]
