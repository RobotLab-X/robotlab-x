# unmanaged
"""ServiceAdapter — the transport-specific interface lifecycle.py talks to.

One concrete adapter per transport:
    * InProcessAdapter      framework/adapters/in_process.py
    * SubprocessAdapter     framework/adapters/subprocess.py
    * DockerAdapter         (stub)
    * RemoteAdapter         (stub)

Adapters do NOT subclass Service. They manage running instances of
services and expose a uniform start / stop / invoke interface to the
runtime. Lifecycle.py picks an adapter via dispatch.pick_adapter() and
calls it; the rest of the runtime doesn't know which transport is in use.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .methods import MethodInfo


@dataclass
class ServiceHandle:
    """Opaque per-instance handle held by the registry.

    What the inside looks like depends on the transport — an in-process
    handle holds a thread + asyncio loop + Service instance, a subprocess
    handle holds a Popen. The framework keeps it opaque; lifecycle calls
    the adapter, the adapter looks inside.
    """

    proxy_id: str
    transport: str                                  # 'in-process' | 'subprocess' | ...
    pid: Optional[int] = None
    host: str = "in-process"
    port: Optional[int] = None
    # Adapter-private state. Don't access from outside the owning adapter.
    payload: Dict[str, Any] = field(default_factory=dict)


class ServiceAdapter(ABC):
    """Transport-specific lifecycle. One singleton instance per transport."""

    @abstractmethod
    def transport_name(self) -> str:
        """Identifier used in dispatch and in handle.transport."""

    @abstractmethod
    def start(
        self,
        proxy: Dict[str, Any],
        meta: Dict[str, Any],
        config: Dict[str, Any],
    ) -> ServiceHandle:
        """Start the service. Returns a handle the registry will store."""

    @abstractmethod
    def stop(self, handle: ServiceHandle) -> None:
        """Gracefully stop the service. Idempotent — already-stopped is a
        no-op, not an error."""

    def release(self, handle: ServiceHandle) -> None:
        """Permanent teardown when the service is released (uninstalled).
        Default is the same as stop(). Override for transport-specific
        cleanup (e.g. removing a docker image, deleting a venv)."""
        self.stop(handle)

    def is_running(self, handle: ServiceHandle) -> bool:
        """Whether the handle's underlying transport is still alive.
        Defaults to True — subclasses with cheap liveness checks override."""
        return True

    def methods(self, handle: ServiceHandle) -> List[MethodInfo]:
        """Discovered methods on this running instance. In-process can
        introspect the Service object directly; subprocess listens for
        a retained methods announcement on the bus."""
        return []

    def class_publishes(self, handle: ServiceHandle) -> List[str]:
        """Class-level declared publish topics (the ``publishes`` class
        attribute on the Service subclass). Always-on topics like
        ``state`` and ``heartbeat`` that aren't tied to a specific
        @service_method. Default empty — adapters that can introspect
        the class override.
        """
        return []

    def type_name(self, handle: ServiceHandle) -> Optional[str]:
        """Type-name of the running instance ('arduino', 'servo', etc.).
        Used to resolve relative topic suffixes into absolute paths.
        Default reads from handle; subclasses with richer info override."""
        return None

    def invoke(
        self,
        handle: ServiceHandle,
        method: str,
        *args: Any,
        **kwargs: Any,
    ) -> Any:
        """Call a @service_method on the running instance. Default
        raises — adapters that support direct method calls override."""
        raise NotImplementedError(
            f"{self.transport_name()} adapter does not support direct method "
            f"invocation (use the bus control topic instead)"
        )
