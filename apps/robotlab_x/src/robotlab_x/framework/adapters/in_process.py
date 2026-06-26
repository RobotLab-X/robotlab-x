# unmanaged
"""InProcessAdapter — run a Service subclass in this Python process.

One asyncio loop per running service, hosted on a dedicated daemon
thread. The thread is independent of the FastAPI / uvicorn event loop
so a long-lived service doesn't block request handling.

Each service module is loaded from
    <repo>/<type_name>/<version>/<module>.py
via importlib so that stock services (clock, echo) and user-installed
services live by the same rules — no special path on sys.path.
"""
from __future__ import annotations

import asyncio
import importlib
import importlib.util
import logging
import os
import sys
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Type

from robotlab_x.runtime.bus import get_bus

from ..adapter import ServiceAdapter, ServiceHandle
from ..methods import MethodInfo
from ..service import Service, ServiceMetadata


logger = logging.getLogger(__name__)


def _log_topic(proxy_id: str) -> str:
    return f"/service_proxy/{proxy_id}/log"


def emit_log(proxy_id: str, line: str, stream: str = "stdout") -> None:
    """Publish a log line to the service's per-proxy log topic.

    Kept as a free function (not a method) so service code can import it
    without holding a reference to the adapter.
    """
    get_bus().publish_sync(
        _log_topic(proxy_id),
        {"stream": stream, "line": line, "ts": time.time()},
    )


def _load_service_class(
    repo_dir: Path, type_name: str, type_version: str, module_name: str, class_name: str
) -> Type[Service]:
    """Import ``<repo>/<type>/<version>/<module>.py`` (single-file form) OR
    ``<repo>/<type>/<version>/<module>/__init__.py`` (package form) and
    return the named class.

    Single-file is the common case (clock, echo). The package form is
    what services like ``brain`` use when they're split across multiple
    files — we need to put the version dir on ``sys.path`` AND register
    the package name in ``sys.modules`` before exec'ing the package's
    ``__init__`` so its own intra-package imports (``from brain.service
    import ...``) resolve.
    """
    pkg_dir = repo_dir / type_name / type_version
    single_file = pkg_dir / f"{module_name}.py"
    package_init = pkg_dir / module_name / "__init__.py"

    if single_file.is_file():
        file_path = single_file
        submodule_search: Optional[List[str]] = None
    elif package_init.is_file():
        file_path = package_init
        submodule_search = [str(pkg_dir / module_name)]
        # The package's own internal imports (``from <module>.x import y``)
        # only resolve if the version dir is on sys.path. Done once per
        # (type_name, type_version) — harmless to re-add.
        if str(pkg_dir) not in sys.path:
            sys.path.insert(0, str(pkg_dir))
    else:
        raise FileNotFoundError(
            f"service module not found: neither {single_file} nor {package_init}"
        )

    # Name uniquely so multiple versions of the same type can coexist.
    # For packages we register under ``module_name`` (so internal
    # ``from <module_name>.x import y`` works) AND under the qualified
    # alias for our own bookkeeping.
    qualified = f"rlx_repo_{type_name}_{type_version.replace('.', '_')}_{module_name}"
    spec = importlib.util.spec_from_file_location(
        module_name if submodule_search else qualified,
        str(file_path),
        submodule_search_locations=submodule_search,
    )
    if spec is None or spec.loader is None:
        raise ImportError(f"could not build spec for {file_path}")
    mod = importlib.util.module_from_spec(spec)
    # Register in sys.modules BEFORE exec so the module is self-aware
    # during class creation. This matters for Pydantic v2: when a config
    # class uses ``from __future__ import annotations``, Pydantic
    # resolves stringified type hints via ``typing.get_type_hints()``,
    # which looks the module up in sys.modules by the class's __module__
    # attribute. If the module isn't registered, hints like
    # ``Optional[str]`` raise PydanticUserError("class not fully defined").
    sys.modules[qualified] = mod
    # Also register under the plain module name. Two reasons:
    #
    #   * Package form needs it so that internal
    #     ``from <module_name>.submodule import X`` resolves to THIS
    #     file's submodule_search_locations rather than failing.
    #   * Single-file form needs it so OTHER in-process services can
    #     do ``importlib.import_module("security")`` to reach the
    #     SecurityCore singleton (Service.save_config uses this to
    #     find the live encrypt callable for SecretStr fields). Last
    #     load wins on name collision — fine for the framework
    #     singletons (security, runtime) where there's only ever one.
    sys.modules[module_name] = mod
    spec.loader.exec_module(mod)
    try:
        cls = getattr(mod, class_name)
    except AttributeError as exc:
        raise ImportError(
            f"{file_path} does not export class {class_name!r}"
        ) from exc
    if not isinstance(cls, type) or not issubclass(cls, Service):
        raise TypeError(
            f"{class_name} in {file_path} must be a Service subclass"
        )
    return cls


def _resolve_repo_dir() -> Path:
    """The writable repo root (config.repo_dir). Fallback when a type
    isn't found in any configured root."""
    from config import get_settings  # local import to dodge boot-time cycles
    from robotlab_x.runtime.repo import writable_repo_dir

    return writable_repo_dir(get_settings())


def _resolve_type_root(type_name: str, type_version: str) -> Path:
    """Return the repo ROOT holding ``<type>/<version>/`` — searched
    across the writable root + read-only config.repo_paths in precedence
    order. Falls back to the writable root when the type isn't found
    anywhere (the caller's load then raises a clear error)."""
    from config import get_settings  # local import to dodge boot-time cycles
    from robotlab_x.runtime.repo import find_type_dir, writable_repo_dir

    settings = get_settings()
    type_dir = find_type_dir(settings, type_name, type_version)
    if type_dir is not None:
        return type_dir.parent.parent
    return writable_repo_dir(settings)


class InProcessAdapter(ServiceAdapter):
    """Runs a Service subclass on a per-instance asyncio loop."""

    def transport_name(self) -> str:
        return "in-process"

    def start(
        self,
        proxy: Dict[str, Any],
        meta: Dict[str, Any],
        config: Dict[str, Any],
    ) -> ServiceHandle:
        proxy_id = proxy["id"]
        meta_id: str = meta.get("id") or proxy.get("service_meta_id") or ""
        type_name = meta_id.split("@", 1)[0] if meta_id else proxy.get("service_meta_id", "")
        type_version = meta_id.split("@", 1)[1] if "@" in meta_id else "1.0.0"

        entry = meta.get("entry_in_process") or {}
        module_name = entry.get("module") or type_name
        class_name = entry.get("class") or _guess_class_name(type_name)

        repo_dir = _resolve_type_root(type_name, type_version)
        try:
            cls = _load_service_class(repo_dir, type_name, type_version, module_name, class_name)
        except Exception as exc:
            emit_log(proxy_id, f"[framework] failed to load {type_name}: {exc}", "stderr")
            raise

        svc_meta = ServiceMetadata(
            proxy_id=proxy_id,
            service_meta_id=meta_id,
            type_name=type_name,
            type_version=type_version,
            tags=list(meta.get("tags") or []),
            singleton="singleton" in (meta.get("tags") or []),
        )
        service = cls(svc_meta, dict(config))

        # Thread + loop + stop_event lifetime mirrors the old _runner.py
        # exactly — known-good pattern.
        loop_holder: Dict[str, asyncio.AbstractEventLoop] = {}
        stop_holder: Dict[str, asyncio.Event] = {}
        ready = threading.Event()
        expected_stop = threading.Event()

        def _thread_main() -> None:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            stop_event = asyncio.Event()
            loop_holder["loop"] = loop
            stop_holder["stop"] = stop_event
            service._bind_runtime(loop, stop_event)
            ready.set()

            async def _drive() -> None:
                meta_topic = f"/{type_name}/{proxy_id}/meta"
                try:
                    await service.on_start()
                    # Standard meta self-description — published AFTER
                    # on_start so any topics the subclass added (extra
                    # streams, filter_catalog, etc.) show up under
                    # meta_topics(). Retained so late subscribers see it
                    # immediately; cleared on stop below.
                    try:
                        get_bus().publish_sync(
                            meta_topic, service._build_meta_payload(), retained=True
                        )
                    except Exception:  # noqa: BLE001
                        logger.exception("meta publish failed for %s", proxy_id)
                    await stop_event.wait()
                finally:
                    # Clear the meta retained topic so a fresh subscriber
                    # after we exit doesn't see stale advertised
                    # methods/topics.
                    try:
                        get_bus().publish_sync(meta_topic, None, retained=True)
                    except Exception:  # noqa: BLE001
                        logger.debug("meta clear failed during shutdown for %s", proxy_id)
                    try:
                        await service.on_stop()
                    except Exception:  # noqa: BLE001
                        logger.exception("on_stop raised for %s", proxy_id)

            try:
                loop.run_until_complete(_drive())
            except Exception:  # noqa: BLE001
                logger.exception("in-process service %s crashed", proxy_id)
                if not expected_stop.is_set():
                    emit_log(proxy_id, f"[{type_name}] crashed — see backend log", "stderr")
            finally:
                try:
                    loop.run_until_complete(loop.shutdown_asyncgens())
                except Exception:  # noqa: BLE001
                    pass
                loop.close()

        thread = threading.Thread(
            target=_thread_main,
            name=f"rlx-svc-{proxy_id}",
            daemon=True,
        )
        thread.start()

        # Wait briefly for the thread to bind its loop + stop_event so the
        # adapter's stop() can signal it cleanly.
        ready.wait(timeout=2.0)
        emit_log(proxy_id, f"[{type_name}] started", "stdout")

        handle = ServiceHandle(
            proxy_id=proxy_id,
            transport=self.transport_name(),
            pid=os.getpid(),
            host="in-process",
            port=None,
            payload={
                "thread": thread,
                "loop": loop_holder.get("loop"),
                "stop_event": stop_holder.get("stop"),
                "expected_stop": expected_stop,
                "service": service,
                "type_name": type_name,
            },
        )
        return handle

    def stop(self, handle: ServiceHandle, timeout: float = 3.0) -> None:
        thread: Optional[threading.Thread] = handle.payload.get("thread")
        loop: Optional[asyncio.AbstractEventLoop] = handle.payload.get("loop")
        stop_event: Optional[asyncio.Event] = handle.payload.get("stop_event")
        expected: Optional[threading.Event] = handle.payload.get("expected_stop")
        type_name: str = handle.payload.get("type_name") or "service"

        if expected is not None:
            expected.set()
        if loop is not None and stop_event is not None and not loop.is_closed():
            loop.call_soon_threadsafe(stop_event.set)
        if thread is not None and thread.is_alive():
            thread.join(timeout=timeout)
            if thread.is_alive():
                logger.warning("in-process service %s did not stop within %ss", handle.proxy_id, timeout)
        emit_log(handle.proxy_id, f"[{type_name}] stopped", "stdout")

    def is_running(self, handle: ServiceHandle) -> bool:
        thread: Optional[threading.Thread] = handle.payload.get("thread")
        return bool(thread and thread.is_alive())

    def methods(self, handle: ServiceHandle) -> List[MethodInfo]:
        svc: Optional[Service] = handle.payload.get("service")
        return svc.methods() if svc else []

    def class_publishes(self, handle: ServiceHandle) -> List[str]:
        """Read the ``publishes`` class attribute. Strings only — anything
        else is ignored to keep the contract simple."""
        svc: Optional[Service] = handle.payload.get("service")
        if svc is None:
            return []
        raw = getattr(type(svc), "publishes", None)
        if not isinstance(raw, (list, tuple)):
            return []
        return [str(t) for t in raw if isinstance(t, str)]

    def type_name(self, handle: ServiceHandle) -> Optional[str]:
        svc: Optional[Service] = handle.payload.get("service")
        if svc is None:
            return None
        return svc.meta.type_name

    def invoke(self, handle: ServiceHandle, method: str, *args: Any, **kwargs: Any) -> Any:
        svc: Optional[Service] = handle.payload.get("service")
        if svc is None:
            raise RuntimeError("service object missing on handle")
        return svc.invoke_method(method, *args, **kwargs)


def _guess_class_name(type_name: str) -> str:
    """Default class name when package.yml doesn't declare entry.in_process.class.

    'clock' -> 'ClockService', 'echo_http' -> 'EchoHttpService'.
    """
    parts = type_name.replace("-", "_").split("_")
    return "".join(p.capitalize() for p in parts if p) + "Service"
