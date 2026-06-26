"""SubprocessService — base class for subprocess services.

Mirrors the shape of ``robotlab_x.framework.Service`` so writing an
in-process service and writing a subprocess service feels the same:

  * subclass and override ``on_start`` / ``on_stop``
  * mark callable actions with ``@service_method``
  * publish/subscribe via ``self.publish`` / ``self.subscribe`` —
    relative paths get prefixed with ``/<type_name>/<proxy_id>/``
  * methods are auto-discoverable via ``self.methods()``

The class handles the boilerplate every subprocess used to do by hand:

  * read ``ROBOTLAB_X_PROXY_ID`` + ``ROBOTLAB_X_SERVICE_META_ID`` from
    env to derive identity + namespace
  * build a BusClient from env (token + backend URL)
  * register a retained hello announcement on
    ``/service_proxy/{proxy_id}/hello`` so the runtime's discovery
    listener picks us up
  * subscribe the control topic and dispatch incoming
    ``{action, ...kwargs}`` payloads to ``@service_method`` handlers
  * optional heartbeat task (set ``heartbeat_interval_s`` on the subclass)
  * graceful SIGTERM / SIGINT shutdown — calls ``on_stop`` then exits

Usage in a subprocess's ``__main__.py``::

    from .service import MyService

    if __name__ == "__main__":
        MyService.run()
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys
import time
from typing import Any, Awaitable, Callable, ClassVar, Dict, List, Optional, Type, Union

from .client import BusClient, from_env
from .config import ServiceConfig
from .methods import MethodInfo, collect_methods
from .streams import Stream, from_env as stream_from_env


logger = logging.getLogger(__name__)


class SubprocessService:
    """Subclass for a subprocess service.

    Override:
      * ``on_start``      — set up resources, spawn tasks
      * ``on_stop``       — release resources
      * any ``@service_method`` you want callable from the bus

    Class attributes you can override:
      * ``type_name``     — namespace for topics. Default: parsed from
                            ``ROBOTLAB_X_SERVICE_META_ID`` (``arduino@1.0.0``
                            → ``arduino``). Falls back to ``proxy_id``.
      * ``heartbeat_interval_s`` — if > 0, base class publishes a
                            ``{ts: float}`` to ``/<type>/<proxy_id>/heartbeat``
                            every that-many seconds while running.
    """

    # ─── subclass-overridable ─────────────────────────────────────────
    type_name: ClassVar[Optional[str]] = None
    heartbeat_interval_s: ClassVar[Optional[float]] = None
    # Class-level always-on publish topics (suffixes like "state",
    # "input", or absolute "/foo" paths) that aren't tied to a specific
    # @service_method. Mirrors the in-process Service ``publishes`` class
    # attr. Surfaced in the retained methods-manifest so the backend's
    # topology view can render them for a subprocess service.
    publishes: ClassVar[List[str]] = []
    # The strongly-typed config class for this service. Defaults to the
    # permissive ServiceConfig base so services without a typed config
    # still work — but every service should declare its own subclass
    # with the fields it actually uses.
    config_class: ClassVar[Type[ServiceConfig]] = ServiceConfig

    # ─── instance ─────────────────────────────────────────────────────
    proxy_id: str
    service_meta_id: Optional[str]
    bus: BusClient
    _stop_event: asyncio.Event

    def __init__(self, proxy_id: str, bus: BusClient) -> None:
        self.proxy_id = proxy_id
        self.bus = bus
        # Typed config instance. Starts as the class default (all fields
        # at their declared defaults); SubprocessService.run() subscribes
        # to /service_proxy/{id}/config_state and rebuilds this with the
        # backend's persisted values BEFORE on_start runs.
        self.config: ServiceConfig = self.config_class()
        self.service_meta_id = os.environ.get("ROBOTLAB_X_SERVICE_META_ID")
        # type_name precedence: subclass override > parsed from meta id
        # > proxy_id (so a malformed env still produces a usable topic).
        cls_name = type(self).type_name
        if cls_name:
            self._type_name: str = cls_name
        elif self.service_meta_id and "@" in self.service_meta_id:
            self._type_name = self.service_meta_id.split("@", 1)[0]
        else:
            self._type_name = proxy_id
        self._stop_event = asyncio.Event()

    # ─── lifecycle hooks (subclasses override) ────────────────────────
    async def on_start(self) -> None:
        """Bring the service up. Spawn tasks, open files, subscribe."""

    async def on_stop(self) -> None:
        """Release resources held by on_start."""

    # ─── messaging sugar ──────────────────────────────────────────────
    def topic(self, suffix: str) -> str:
        """Absolute paths pass through. Relative paths get
        ``/<type_name>/<proxy_id>/`` prefixed.
        """
        if suffix.startswith("/"):
            return suffix
        return f"/{self._type_name}/{self.proxy_id}/{suffix}"

    # The *_topic properties return the EFFECTIVE topic — i.e. after
    # topic_remap is applied. Framework code that subscribes/publishes
    # via these (e.g. the run() classmethod's bus.subscribe on
    # control_topic) automatically honours the user's remap, with no
    # extra plumbing at every call site.
    @property
    def control_topic(self) -> str:
        return self.resolve_topic(self.topic("control"))

    @property
    def state_topic(self) -> str:
        return self.resolve_topic(self.topic("state"))

    @property
    def heartbeat_topic(self) -> str:
        return self.resolve_topic(self.topic("heartbeat"))

    def resolve_topic(self, topic: str) -> str:
        """Apply ``self.config.topic_remap`` to ``topic`` (single hop).

        Mirrors the in-process Service.resolve_topic so subprocess
        services honour the same ROS-style remap entries set on a
        service's config. Returns input unchanged when no remap matches.
        """
        remap = getattr(self.config, "topic_remap", None) if hasattr(self, "config") else None
        if not isinstance(remap, dict) or not remap:
            return topic
        return remap.get(topic, topic)

    async def publish(self, suffix: str, payload: Any, *, retained: bool = False) -> None:
        await self.bus.publish(self.resolve_topic(self.topic(suffix)), payload, retained=retained)

    async def subscribe(
        self, suffix: str, handler: Callable[[Any], Union[None, Awaitable[None]]]
    ) -> None:
        await self.bus.subscribe(self.resolve_topic(self.topic(suffix)), handler)

    # ─── stream registration ──────────────────────────────────────────
    async def register_stream(
        self,
        stream_id: str,
        *,
        kinds: Optional[List[str]] = None,
        format: Optional[str] = None,
        resolution: Optional[tuple] = None,
        fps: Optional[float] = None,
    ) -> Optional[Stream]:
        """Open a stream channel for media uploads + publish a retained
        discovery announcement on the bus.

        Returns the ``Stream`` object the service pushes frames into, or
        ``None`` when no backend is reachable (subprocess running without
        a runtime — useful for unit tests).

        Authoring shape::

            self.cam = await self.register_stream(
                stream_id=f"{self.proxy_id}/cam",
                kinds=["mjpeg"],
                resolution=(1280, 720),
                fps=30,
            )
            ...
            self.cam.push(jpeg_bytes)
        """
        stream = stream_from_env(
            stream_id=stream_id,
            producer_id=self.proxy_id,
            kinds=kinds,
            format=format,
            resolution=resolution,
            fps=fps,
        )
        if stream is None:
            logger.warning("%s: register_stream(%s) — no backend env, skipping",
                           self.proxy_id, stream_id)
            return None
        stream.start()

        # Publish the discovery announcement so consumers can find this
        # stream without having to call /v1/stream. Retained so a late
        # subscriber gets the announcement immediately.
        backend_url = os.environ.get("ROBOTLAB_X_BACKEND_URL") or ""
        # Strip trailing slash + derive the http endpoint URL for each
        # transport. Hostname form survives docker-bridge IP changes.
        http_base = backend_url.rstrip("/")
        endpoints = {
            "mjpeg": f"{http_base}/v1/stream/{stream_id}/mjpeg",
        }
        await self.bus.publish(
            f"/stream/index/{stream_id}",
            {
                "stream_id": stream_id,
                "producer_id": self.proxy_id,
                "kinds": list(kinds or ["mjpeg"]),
                "format": format or "jpeg",
                "resolution": list(resolution) if resolution else None,
                "fps": fps,
                "endpoints": endpoints,
            },
            retained=True,
        )
        return stream

    # ─── state queries ────────────────────────────────────────────────
    def is_stopping(self) -> bool:
        return self._stop_event.is_set()

    # ─── meta self-description ────────────────────────────────────────
    def _build_meta_payload(self) -> Dict[str, Any]:
        """Self-description published to /<type>/<proxy_id>/meta on start.

        Standard shape across every service type so a consumer reading
        the meta topic doesn't have to know about per-type conventions.
        Fields are deliberately flat + JSON-able. ``topics`` lists the
        canonical bus paths this service exposes; subclasses extend this
        by overriding ``meta_topics()`` (NOT this method).
        """
        type_version = "1.0.0"
        if self.service_meta_id and "@" in self.service_meta_id:
            type_version = self.service_meta_id.split("@", 1)[1]
        return {
            "proxy_id": self.proxy_id,
            "type": self._type_name,
            "version": type_version,
            "transport": "subprocess",
            "runtime_id": os.environ.get("ROBOTLAB_X_RUNTIME_ID"),
            "pid": os.getpid(),
            "topics_root": f"/{self._type_name}/{self.proxy_id}",
            "topics": {
                "state": self.state_topic,
                "control": self.control_topic,
                "heartbeat": self.heartbeat_topic,
                "meta": self.resolve_topic(self.topic("meta")),
                **self.meta_topics(),
            },
            "class_publishes": self._class_publishes(),
            "methods": self._methods_payload(),
        }

    def _class_publishes(self) -> List[str]:
        """Class-level ``publishes`` declared on the subclass — strings
        only (anything else ignored, mirroring the in-process adapter)."""
        raw = type(self).publishes
        if not isinstance(raw, (list, tuple)):
            return []
        return [t for t in raw if isinstance(t, str)]

    def _methods_payload(self) -> List[Dict[str, Any]]:
        """The @service_method infos as flat JSON dicts — the shape the
        backend reconstructs into MethodInfo for the topology view."""
        return [
            {"name": m.name, "doc": (m.doc or "").strip() or None,
             "publishes": list(m.publishes or []),
             "publish_return": m.publish_return}
            for m in self.methods()
        ]

    def _build_methods_manifest(self) -> Dict[str, Any]:
        """Retained announcement published on
        ``/service_proxy/{proxy_id}/methods``. Lets the backend (which
        can't import a subprocess's class) introspect the service's wire
        contract — class-level publishes + per-method publishes — exactly
        as it does for in-process services. Topic suffixes stay RAW
        ("state", "return/foo") so the backend resolves them against the
        type namespace the same way for both transports."""
        return {
            "proxy_id": self.proxy_id,
            "type_name": self._type_name,
            "transport": "subprocess",
            "class_publishes": self._class_publishes(),
            "methods": self._methods_payload(),
        }

    def meta_topics(self) -> Dict[str, str]:
        """Subclasses override to advertise service-type-specific topics
        in the meta payload. Returned dict is merged into ``topics``.
        Each value should be the FULLY-RESOLVED bus path (use
        ``self.resolve_topic(self.topic("foo"))``)."""
        return {}

    # ─── capability discovery ─────────────────────────────────────────
    def methods(self) -> List[MethodInfo]:
        """Every @service_method-decorated callable on this instance."""
        return collect_methods(self)

    def invoke_method(self, wire_name: str, /, *args: Any, **kwargs: Any) -> Any:
        """Call a registered @service_method by wire name. Async methods
        are returned as coroutines for the caller to await.

        Wire-name (the decorator argument) and Python attribute name
        can differ — e.g. ``@service_method('connect')`` on
        ``def m_connect``. Match against ``info.name`` (wire), call via
        ``info.attr`` (Python).

        ``wire_name`` is positional-only so a service-method kwarg
        named ``name`` doesn't collide with the dispatcher's parameter.
        """
        for info in self.methods():
            if info.name != wire_name:
                continue
            fn = getattr(self, info.attr or info.name)
            return fn(*args, **kwargs)
        raise KeyError(f"no @service_method named {wire_name!r} on {type(self).__name__}")

    # ─── default control-topic handler ────────────────────────────────
    async def on_control(self, payload: Any) -> None:
        """Default handler for the service's /control topic. Extracts
        ``action`` and routes remaining keys as kwargs to the matching
        @service_method. Subclasses can override for custom dispatch.

        Honours ``reply_to`` in the payload: when present, the method's
        return value is published to that topic after a successful
        call, and an ``{error: <msg>}`` envelope on failure. Mirrors
        the in-process Service.run_control_loop contract so a CLI
        caller using ``call`` gets a reply regardless of which
        transport hosts the target service.
        """
        if not isinstance(payload, dict):
            return
        action = payload.get("action")
        if not isinstance(action, str):
            return
        reply_to = payload.get("reply_to")
        kwargs = {k: v for k, v in payload.items() if k not in ("action", "reply_to")}

        async def _send_reply(value: Any) -> None:
            if not isinstance(reply_to, str) or not reply_to:
                return
            try:
                await self.bus.publish(reply_to, value)
            except Exception:  # noqa: BLE001
                logger.exception("%s: reply_to publish failed (%s)", self.proxy_id, reply_to)

        try:
            result = self.invoke_method(action, **kwargs)
        except KeyError:
            logger.warning("%s: unknown action %r", self.proxy_id, action)
            await _send_reply({"error": f"unknown action: {action}"})
            return
        except TypeError as exc:
            logger.warning("%s: %s args mismatch: %s", self.proxy_id, action, exc)
            await _send_reply({"error": f"args mismatch: {exc}"})
            return
        if asyncio.iscoroutine(result):
            try:
                result = await result
            except Exception as exc:  # noqa: BLE001
                logger.exception("%s: action %r raised", self.proxy_id, action)
                await _send_reply({"error": str(exc)})
                return
        await _send_reply(result)

    # ─── config persistence ───────────────────────────────────────────
    # The subprocess can't touch the backend's DB directly. It publishes
    # a patch on /service_proxy/{id}/config_patch; the backend's
    # discovery listener validates against the meta's config_class,
    # persists, and re-broadcasts /service_proxy/{id}/config_state.
    async def update_config(self, updates: Dict[str, Any]) -> None:
        """Merge ``updates`` into ``self.config`` and ask the backend
        to persist them onto the proxy's service_config row.

        Validates locally against ``config_class`` first — a typo or
        bad type fails fast in this process before round-tripping to
        the backend.
        """
        if not isinstance(updates, dict) or not updates:
            return
        # Local validation + apply.
        try:
            self.config = self.config.merge_dict(updates)
        except Exception:  # noqa: BLE001 — Pydantic ValidationError
            logger.exception("%s: update_config rejected %r", self.proxy_id, updates)
            raise
        await self.bus.publish(
            f"/service_proxy/{self.proxy_id}/config_patch",
            dict(updates),
        )

    def _apply_config_state(self, raw: Any) -> None:
        """Handler for /service_proxy/{id}/config_state. Replaces
        ``self.config`` with a fresh validated instance built from the
        retained payload. Soft fails on validation error — keeps the
        previous config rather than crashing the service."""
        if not isinstance(raw, dict):
            return
        try:
            self.config = self.config_class(**raw)
        except Exception:  # noqa: BLE001
            logger.exception("%s: config_state payload rejected by schema", self.proxy_id)

    # ─── stop signaling ───────────────────────────────────────────────
    def request_stop(self) -> None:
        """Signal the run loop to begin graceful shutdown."""
        self._stop_event.set()

    # ─── orchestration (called by run()) ──────────────────────────────
    async def _heartbeat_loop(self) -> None:
        interval = self.heartbeat_interval_s
        if not interval or interval <= 0:
            return
        while not self._stop_event.is_set():
            try:
                await self.publish("heartbeat", {"ts": time.time()})
            except Exception:  # noqa: BLE001
                logger.exception("%s: heartbeat publish failed", self.proxy_id)
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=interval)
                return
            except asyncio.TimeoutError:
                continue

    @classmethod
    def run(cls: Type["SubprocessService"]) -> int:
        """Entry point for a subprocess service's ``__main__.py``.

        Builds the bus client from env, constructs an instance of
        ``cls``, wires hello/control/heartbeat/signal handlers, then
        blocks on the consume loop until SIGTERM. Returns a process
        exit code.
        """
        try:
            return asyncio.run(cls._async_main())
        except KeyboardInterrupt:
            return 0

    @classmethod
    async def _async_main(cls: Type["SubprocessService"]) -> int:
        proxy_id = os.environ.get("ROBOTLAB_X_PROXY_ID", "?")
        print(f"[{cls.__name__}] starting (proxy={proxy_id}, pid={os.getpid()})")

        bus = from_env()
        if bus is None:
            print(
                f"[{cls.__name__}] no bus credentials in env — cannot publish/subscribe",
                file=sys.stderr,
            )
            return 2

        svc = cls(proxy_id, bus)

        # Hello announcement — published on every (re)connect so the
        # runtime's discovery listener can adopt this subprocess.
        hello_topic = f"/service_proxy/{proxy_id}/hello"
        bus.announce(
            hello_topic,
            lambda: {
                "pid": os.getpid(),
                "ts": time.time(),
                "transport": "subprocess",
                "service_meta_id": svc.service_meta_id,
                "type_name": svc._type_name,
            },
            retained=True,
        )

        # Subscribe to config_state BEFORE on_start so the retained
        # payload (published by the backend just before spawning us)
        # populates self.config before subclass code reads it.
        config_state_topic = f"/service_proxy/{proxy_id}/config_state"
        await bus.subscribe(config_state_topic, svc._apply_config_state)

        # Subscribe the canonical control topic. Subclasses can override
        # on_control if they want non-standard dispatch.
        await bus.subscribe(svc.control_topic, svc.on_control)
        print(f"[{cls.__name__}] hello={hello_topic} control={svc.control_topic}")

        loop = asyncio.get_running_loop()

        def _on_signal(signum: int) -> None:
            print(f"[{cls.__name__}] received signal {signum}, shutting down")
            svc.request_stop()

        for sig in (signal.SIGTERM, signal.SIGINT):
            try:
                loop.add_signal_handler(sig, _on_signal, sig)
            except NotImplementedError:
                # Windows / unusual loops — fall back to default handlers.
                pass

        # Kick off the consume loop FIRST so retained messages
        # (config_state) get a chance to arrive before on_start runs.
        consume_task = asyncio.create_task(bus.consume_forever())

        # Wait for the bus to finish its first connect + subscribe cycle,
        # then a brief grace for the retained config_state message to be
        # dispatched. If we never connect, fall through after a few
        # seconds and run on_start with defaults.
        try:
            await asyncio.wait_for(bus.ready.wait(), timeout=5.0)
            # Retained messages flow right after the subscribe ack — a
            # short sleep is enough for our handler to fire.
            await asyncio.sleep(0.2)
        except asyncio.TimeoutError:
            print(f"[{cls.__name__}] bus not ready after 5s — starting with default config", file=sys.stderr)

        # Subclass-defined startup runs after the bus is wired AND the
        # retained config_state has been applied, so its publishes have
        # somewhere to go and self.config holds the persisted values.
        try:
            await svc.on_start()
        except Exception:  # noqa: BLE001
            logger.exception("%s.on_start raised", cls.__name__)
            return 3

        # Publish the standard meta self-description AFTER on_start so
        # any topics the subclass added in on_start (e.g. extra streams,
        # filter_catalog) are observable on the meta_topics() return
        # path. Retained so a late subscriber picks it up. Cleared on
        # graceful shutdown below.
        meta_topic = svc.resolve_topic(svc.topic("meta"))
        try:
            await bus.publish(meta_topic, svc._build_meta_payload(), retained=True)
        except Exception:  # noqa: BLE001
            logger.exception("%s.meta publish failed", cls.__name__)

        # Methods manifest — a stable, type/remap-independent topic the
        # backend's discovery listener caches so subprocess services show
        # their publishes + methods in the topology view. Retained;
        # cleared on graceful shutdown below.
        methods_topic = f"/service_proxy/{proxy_id}/methods"
        try:
            await bus.publish(methods_topic, svc._build_methods_manifest(), retained=True)
        except Exception:  # noqa: BLE001
            logger.exception("%s.methods-manifest publish failed", cls.__name__)

        heartbeat_task: Optional[asyncio.Task] = None
        if (cls.heartbeat_interval_s or 0) > 0:
            heartbeat_task = asyncio.create_task(svc._heartbeat_loop())

        print(f"[{cls.__name__}] ready — awaiting control")
        await svc._stop_event.wait()

        # Clear the meta retained topic so a fresh subscriber after we
        # exit doesn't see stale advertised methods/topics. Best-effort —
        # the bus may already be on its way down.
        try:
            await bus.publish(meta_topic, None, retained=True)
            await bus.publish(methods_topic, None, retained=True)
        except Exception:  # noqa: BLE001
            logger.debug("meta clear failed during shutdown (bus may be closing)")

        # Graceful shutdown.
        try:
            await svc.on_stop()
        except Exception:  # noqa: BLE001
            logger.exception("%s.on_stop raised", cls.__name__)

        if heartbeat_task is not None:
            heartbeat_task.cancel()
        await bus.close()
        consume_task.cancel()
        await asyncio.gather(
            *(t for t in (heartbeat_task, consume_task) if t is not None),
            return_exceptions=True,
        )
        print(f"[{cls.__name__}] stopped")
        return 0
