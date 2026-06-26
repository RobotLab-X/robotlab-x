# unmanaged
"""Live ServiceHandle registry keyed by proxy_id.

A process-singleton. Replaces the parallel registries that used to live
in runtime/builtins/_runner.py and runtime/process_manager.py.
"""
from __future__ import annotations

from threading import Lock
from typing import Dict, Iterator, Optional

from .adapter import ServiceAdapter, ServiceHandle


class HandleRegistry:
    def __init__(self) -> None:
        self._lock = Lock()
        self._handles: Dict[str, ServiceHandle] = {}
        self._adapters: Dict[str, ServiceAdapter] = {}

    def put(self, handle: ServiceHandle, adapter: ServiceAdapter) -> None:
        with self._lock:
            self._handles[handle.proxy_id] = handle
            self._adapters[handle.proxy_id] = adapter

    def get(self, proxy_id: str) -> Optional[ServiceHandle]:
        with self._lock:
            return self._handles.get(proxy_id)

    def adapter_for(self, proxy_id: str) -> Optional[ServiceAdapter]:
        with self._lock:
            return self._adapters.get(proxy_id)

    def remove(self, proxy_id: str) -> Optional[ServiceHandle]:
        with self._lock:
            self._adapters.pop(proxy_id, None)
            return self._handles.pop(proxy_id, None)

    def items(self) -> Iterator[tuple[str, ServiceHandle, ServiceAdapter]]:
        with self._lock:
            snapshot = list(self._handles.items())
            adapters = dict(self._adapters)
        for proxy_id, handle in snapshot:
            yield proxy_id, handle, adapters[proxy_id]

    def class_publishes_for(self, proxy_id: str) -> list[str]:
        """Class-level declared publishes for the running service.
        Empty if not running or transport can't introspect."""
        handle = self.get(proxy_id)
        adapter = self.adapter_for(proxy_id)
        if handle is None or adapter is None:
            return []
        return list(adapter.class_publishes(handle))

    def type_name_for(self, proxy_id: str) -> Optional[str]:
        """Type-name of the running service ('servo', 'arduino', etc.)
        for topic resolution. None if not running."""
        handle = self.get(proxy_id)
        adapter = self.adapter_for(proxy_id)
        if handle is None or adapter is None:
            return None
        return adapter.type_name(handle)


REGISTRY = HandleRegistry()
