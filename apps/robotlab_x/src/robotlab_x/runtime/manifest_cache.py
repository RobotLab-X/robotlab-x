# unmanaged
"""Subprocess service-manifest cache.

A subprocess service can't be Python-introspected from the backend — its
class lives in a child process. To make its wire contract (class-level
``publishes`` + ``@service_method`` infos) visible to the topology API,
each subprocess publishes a retained manifest on
``/service_proxy/{proxy_id}/methods`` at startup. The discovery listener
caches it here, and ``SubprocessAdapter`` reads it back so subprocess
services introspect the same as in-process ones.

Process-singleton, thread-safe — discovery writes from its daemon
thread; the adapter reads from request handlers.
"""
from __future__ import annotations

from threading import Lock
from typing import Any, Dict, List, Optional, TypedDict


class Manifest(TypedDict, total=False):
    type_name: Optional[str]
    transport: str
    class_publishes: List[str]
    methods: List[Dict[str, Any]]   # {name, doc, publishes, publish_return}


_lock = Lock()
_manifests: Dict[str, Manifest] = {}


def put(proxy_id: str, manifest: Manifest) -> None:
    with _lock:
        _manifests[proxy_id] = manifest


def get(proxy_id: str) -> Optional[Manifest]:
    with _lock:
        return _manifests.get(proxy_id)


def remove(proxy_id: str) -> None:
    with _lock:
        _manifests.pop(proxy_id, None)
