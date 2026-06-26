# unmanaged
"""SubprocessAdapter — thin wrapper around runtime/process_manager.py.

Subprocess services already have a working implementation; this adapter
adapts that to the ServiceAdapter interface so lifecycle.py can treat
them uniformly with in-process services. No new process logic lives
here — process_manager owns the Popen, port allocation, log pumps,
crash watcher, etc.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List

from robotlab_x.runtime import manifest_cache, process_manager

from ..adapter import ServiceAdapter, ServiceHandle
from ..methods import MethodInfo


logger = logging.getLogger(__name__)


def _resolve_repo_dir() -> Path:
    from config import get_settings  # local import to dodge boot-time cycles
    from robotlab_x.runtime.repo import writable_repo_dir

    return writable_repo_dir(get_settings())


def _type_dir(meta: Dict[str, Any]) -> Path:
    meta_id = meta.get("id") or ""
    if "@" not in meta_id:
        raise ValueError(f"invalid service_meta_id {meta_id!r}")
    name, version = meta_id.split("@", 1)
    # Search all repo roots — a subprocess type usually lands in the
    # writable root after install, but may live in a read-only
    # repo_paths root (e.g. a dev checkout that already has its venv).
    from config import get_settings  # local import to dodge boot-time cycles
    from robotlab_x.runtime.repo import find_type_dir

    found = find_type_dir(get_settings(), name, version)
    return found if found is not None else _resolve_repo_dir() / name / version


class SubprocessAdapter(ServiceAdapter):
    """Runs the service via subprocess.Popen, supervised by process_manager."""

    def transport_name(self) -> str:
        return "subprocess"

    def start(
        self,
        proxy: Dict[str, Any],
        meta: Dict[str, Any],
        config: Dict[str, Any],
    ) -> ServiceHandle:
        proxy_id = proxy["id"]
        entry_argv = list(meta.get("entry_argv") or [])
        if not entry_argv:
            raise ValueError(f"service_meta {meta.get('id')} has no entry_argv")
        type_dir = _type_dir(meta)
        venv_bin = type_dir / ".venv" / "bin"
        result = process_manager.start(
            proxy_id,
            entry_argv,
            venv_bin,
            cwd=type_dir,
            service_meta_id=meta.get("id"),
        )
        return ServiceHandle(
            proxy_id=proxy_id,
            transport=self.transport_name(),
            pid=int(result.get("pid") or 0) or None,
            host=str(result.get("host") or "127.0.0.1"),
            port=int(result.get("port")) if result.get("port") is not None else None,
            payload={"meta_id": meta.get("id")},
        )

    def stop(self, handle: ServiceHandle) -> None:
        process_manager.stop(handle.proxy_id)
        manifest_cache.remove(handle.proxy_id)

    def is_running(self, handle: ServiceHandle) -> bool:
        return process_manager.is_running(handle.proxy_id)

    def methods(self, handle: ServiceHandle) -> List[MethodInfo]:
        # A subprocess's class can't be Python-introspected from here;
        # instead it publishes a retained /service_proxy/{id}/methods
        # manifest that the discovery listener caches. Reconstruct the
        # MethodInfo list from that cache (empty until the manifest
        # arrives, e.g. in the first moment after start).
        manifest = manifest_cache.get(handle.proxy_id)
        if not manifest:
            return []
        out: List[MethodInfo] = []
        for m in manifest.get("methods") or []:
            if not isinstance(m, dict) or not m.get("name"):
                continue
            out.append(MethodInfo(
                name=m["name"],
                doc=m.get("doc"),
                publishes=list(m.get("publishes") or []),
                publish_return=m.get("publish_return"),
            ))
        return out

    def class_publishes(self, handle: ServiceHandle) -> List[str]:
        manifest = manifest_cache.get(handle.proxy_id)
        if not manifest:
            return []
        return [t for t in (manifest.get("class_publishes") or []) if isinstance(t, str)]

    def type_name(self, handle: ServiceHandle) -> str | None:
        # Prefer the manifest's type_name; fall back to parsing the
        # service_meta_id ("joystick@1.0.0" → "joystick") so topic
        # resolution still works before the manifest lands.
        manifest = manifest_cache.get(handle.proxy_id)
        if manifest and manifest.get("type_name"):
            return manifest["type_name"]
        meta_id = (handle.payload or {}).get("meta_id") or ""
        if "@" in meta_id:
            return meta_id.split("@", 1)[0]
        return None
