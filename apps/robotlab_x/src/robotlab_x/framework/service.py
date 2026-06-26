# unmanaged
"""Service base class — the high-level shape every service exposes.

Subclasses override the lifecycle hooks (on_start / on_stop / on_release).
The framework wires the bus, registers @service_method handlers, and
maintains the registry entry. Concrete examples live in repo/<name>/
<version>/<name>.py.

This class is for in-process services. Subprocess / docker / remote
services don't subclass Service directly — they run their own way and
the SubprocessAdapter / DockerAdapter speak the same external API.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

from rlx_bus import ServiceConfig
from robotlab_x.runtime.bus import get_bus

from .methods import MethodInfo, collect_methods, service_method


logger = logging.getLogger(__name__)


# Cached per-process SecurityCore — built on first request from the
# standard key file under ``<data_dir>/security/key.bin``. The
# SecurityService running in this process uses the same key file, so
# whether the call goes through the service or this local core yields
# identical ciphertext. We skip the service round-trip entirely
# because the in-process adapter's qualified-name trick makes the
# service hard to look up reliably across module-load boundaries.
_local_security_core: Any = None
_local_security_core_failed: bool = False


def _get_local_security_core() -> Any:
    """Return a process-local SecurityCore, or None when the security
    module can't be located on disk (unit tests without the repo)."""
    global _local_security_core, _local_security_core_failed
    if _local_security_core is not None:
        return _local_security_core
    if _local_security_core_failed:
        return None
    try:
        from pathlib import Path
        from config import get_settings
        settings = get_settings()
        data_dir = Path(getattr(settings, "data_dir", None) or "data")
        if not data_dir.is_absolute():
            data_dir = Path.cwd() / data_dir
        # Find security.py via the configured repo dir + load it as a
        # one-off — don't go through sys.modules since the in-process
        # adapter may have shadowed the name.
        repo_dir = Path(getattr(settings, "repo_dir", None) or "repo")
        if not repo_dir.is_absolute():
            repo_dir = Path.cwd() / repo_dir
        security_py = repo_dir / "security" / "1.0.0" / "security.py"
        if not security_py.is_file():
            _local_security_core_failed = True
            return None
        import importlib.util
        spec = importlib.util.spec_from_file_location("_rlx_local_security", security_py)
        if spec is None or spec.loader is None:
            _local_security_core_failed = True
            return None
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        key_path = (data_dir / "security" / "key.bin").resolve()
        _local_security_core = mod.SecurityCore(key_path=key_path)
        logger.info(
            "framework: local SecurityCore initialised (key_source=%s)",
            _local_security_core.key_source,
        )
        return _local_security_core
    except Exception:  # noqa: BLE001
        logger.exception("framework: failed to bootstrap local SecurityCore")
        _local_security_core_failed = True
        return None


def _safe_args_schema(svc: "Service", attr: str) -> Dict[str, Any]:
    """Return the JSON Schema for ``svc.attr``'s parameters, or {} on
    any failure. Never raises — meta publish runs at startup and a
    broken schema generator must not crash a service."""
    try:
        from robotlab_x.runtime.schema_introspect import method_args_schema
        fn = getattr(svc, attr, None)
        if fn is None:
            return {}
        return method_args_schema(fn)
    except Exception:  # noqa: BLE001
        logger.exception("meta: args_schema failed for %s.%s", type(svc).__name__, attr)
        return {}


@dataclass
class ServiceMetadata:
    """Subset of service_meta + service_proxy a service can introspect at runtime."""

    proxy_id: str
    service_meta_id: str          # e.g. "clock@1.0.0"
    type_name: str                # e.g. "clock"
    type_version: str             # e.g. "1.0.0"
    tags: List[str]               # from manifest
    singleton: bool               # tags include 'singleton'


class Service:
    """Base class for in-process services.

    Override the lifecycle hooks. Use ``self.publish`` / ``self.subscribe``
    for bus IO; the framework prefixes paths with ``/service_proxy/<id>/``
    so a service doesn't have to thread its proxy_id through every call.

    Decorate methods with @service_method to make them discoverable
    through ``methods()`` and (in a follow-up) invokable over the bus.

    Strongly-typed config: subclasses declare ``config_class``
    (a ``ServiceConfig`` subclass) and ``self.config`` is an instance of
    that class. Attribute access works (`self.config.interval_ms`),
    validation runs on construction + on every update.
    """

    # Subclasses override to enforce a schema. Default permits any keys.
    config_class: type[ServiceConfig] = ServiceConfig

    def __init__(self, meta: ServiceMetadata, config: Dict[str, Any]) -> None:
        self.meta = meta
        # Build a typed config instance from the raw dict the adapter
        # passed in. Validation errors here surface during service
        # start, where they're easier to debug.
        try:
            self.config: ServiceConfig = self.config_class(**(config or {}))
        except Exception:  # noqa: BLE001 — Pydantic ValidationError
            logger.exception("%s: config rejected by schema (using defaults)", type(self).__name__)
            self.config = self.config_class()
        # The adapter sets these before invoking lifecycle hooks. They give
        # the service its own loop reference + a sentinel for shutdown.
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._stop_event: Optional[asyncio.Event] = None

    # ─── lifecycle hooks (subclasses override) ──────────────────────────
    async def on_start(self) -> None:
        """Bring the service up. Spawn tasks, open files, subscribe.

        Default is a no-op so trivial services that only react to method
        calls don't have to write boilerplate.
        """

    async def on_stop(self) -> None:
        """Release resources held by on_start. Default no-op.

        on_stop runs *before* the loop tears down — async tasks scheduled
        here will run to completion if they're awaited.
        """

    async def on_release(self) -> None:
        """Optional one-shot cleanup when the service is released from the
        registry (uninstalled). Default is to call on_stop().
        """
        await self.on_stop()

    # ─── state queries ──────────────────────────────────────────────────
    @property
    def proxy_id(self) -> str:
        return self.meta.proxy_id

    @property
    def is_singleton(self) -> bool:
        return self.meta.singleton

    def is_stopping(self) -> bool:
        return self._stop_event is not None and self._stop_event.is_set()

    # ─── meta self-description ──────────────────────────────────────────
    def _build_meta_payload(self) -> Dict[str, Any]:
        """Self-description published to /<type>/<proxy_id>/meta on start.

        Mirrors SubprocessService._build_meta_payload — same shape so a
        consumer reading the meta topic doesn't have to know which
        transport hosts the service. ``topics`` lists the canonical bus
        paths; subclasses extend by overriding ``meta_topics()``.
        """
        import os as _os
        # In-process services share the runtime's process, so we can ask
        # identity directly — that's authoritative even when no env var
        # is set on the runtime process. Subprocess services rely on the
        # env var because they don't have access to identity.py.
        try:
            from robotlab_x.runtime.identity import get_runtime_id
            runtime_id = get_runtime_id() or _os.environ.get("ROBOTLAB_X_RUNTIME_ID")
        except Exception:  # noqa: BLE001
            runtime_id = _os.environ.get("ROBOTLAB_X_RUNTIME_ID")
        type_root = f"/{self.meta.type_name}/{self.proxy_id}"
        return {
            "proxy_id": self.proxy_id,
            "type": self.meta.type_name,
            "version": self.meta.type_version,
            "transport": "in_process",
            "runtime_id": runtime_id,
            "pid": _os.getpid(),
            "topics_root": type_root,
            "topics": {
                "state": self.resolve_topic(self.topic("state")),
                "control": self.resolve_topic(self.topic("control")),
                "meta": self.resolve_topic(self.topic("meta")),
                **self.meta_topics(),
            },
            "methods": [
                {"name": m.name, "doc": (m.doc or "").strip() or None,
                 "publishes": list(m.publishes or []),
                 "publish_return": m.publish_return,
                 # JSON Schema for the method's args. Lets LLM tool
                 # callers (brain workflows) and the catalog UI know
                 # what parameters to pass — without this every tool
                 # advertises as zero-arg, which fools the model into
                 # never calling it (qwen2.5 et al silently skip
                 # zero-arg tools they can't reason about).
                 "args_schema": _safe_args_schema(self, m.attr or m.name)}
                for m in self.methods()
            ],
        }

    def meta_topics(self) -> Dict[str, str]:
        """Subclasses override to advertise extra service-type-specific
        topics in the meta payload. Returned dict is merged into
        ``topics``. Values must be FULLY-RESOLVED bus paths."""
        return {}

    # ─── capability discovery ───────────────────────────────────────────
    def methods(self) -> List[MethodInfo]:
        """List @service_method-decorated callables."""
        return collect_methods(self)

    def invoke_method(self, wire_name: str, /, *args: Any, **kwargs: Any) -> Any:
        """Call a registered @service_method by wire name. Lifecycle.invoke
        ends up here when a request routes a method call. Wire name and
        Python attribute name can differ — match against ``info.name``,
        call via ``info.attr``.

        ``wire_name`` is positional-only (``/``) so a service-method
        kwarg named ``wire_name`` (or formerly ``name``) doesn't
        collide with the dispatcher's own parameter — e.g. cron's
        ``add_job(name='...')`` would otherwise raise
        ``TypeError: multiple values for argument 'name'``.
        """
        for info in self.methods():
            if info.name != wire_name:
                continue
            fn = getattr(self, info.attr or info.name)
            return fn(*args, **kwargs)
        raise KeyError(f"no @service_method named {wire_name!r} on {type(self).__name__}")

    def _find_method(self, name: str) -> Optional[MethodInfo]:
        for info in self.methods():
            if info.name == name:
                return info
        return None

    async def run_control_loop(self) -> None:
        """Standard /control dispatcher (Layer 2).

        Reads ``{"action": <wire-name>, ...}`` frames from
        ``/{type}/{id}/control``, calls the matching @service_method,
        and auto-publishes the result in two cases:

          * If the incoming message carried a ``reply_to`` topic, the
            return value is published there. This is the request-reply
            pattern — caller sends a request, gets the answer routed
            back without writing publish glue in the method body.
          * If the matched method's @service_method declared
            ``publish_return="last"`` or ``"event"``, the return value
            is published to ``/{type}/{id}/return/{name}`` — retained
            for ``"last"`` (most recent value always readable),
            non-retained for ``"event"``.

        Errors caught here include unknown actions (KeyError → warn)
        and method exceptions (logged + swallowed so the control loop
        survives). Sync and async return values are both handled.
        """
        async for msg in self.subscribe_iter("control"):
            payload = msg.payload if isinstance(msg.payload, dict) else {}
            action = payload.get("action")
            if not isinstance(action, str):
                continue
            # ``reply_to`` is part of the wire envelope — pulled here so
            # it doesn't get forwarded to the method as an unexpected
            # kwarg. Callers (e.g. the CLI's ``call`` verb) put it in
            # the payload dict because BusMessage has no first-class
            # field for it; falling back to ``msg.reply_to`` for any
            # future client that does set it on the message object.
            reply_to = payload.get("reply_to") or getattr(msg, "reply_to", None)
            kwargs = {k: v for k, v in payload.items() if k not in ("action", "reply_to")}
            info = self._find_method(action)
            try:
                result = self.invoke_method(action, **kwargs)
                if asyncio.iscoroutine(result):
                    result = await result
            except KeyError:
                logger.warning("%s %s: ignored unknown action %r",
                               self.meta.type_name, self.proxy_id, action)
                if reply_to:
                    self.publish(reply_to, {"error": f"unknown action: {action}"})
                continue
            except Exception as exc:  # noqa: BLE001
                logger.exception("%s %s: action %r raised",
                                 self.meta.type_name, self.proxy_id, action)
                if reply_to:
                    self.publish(reply_to, {"error": str(exc)})
                continue
            # Auto-publish hooks (Layer 2). reply_to is per-message,
            # publish_return is per-method.
            if reply_to:
                self.publish(reply_to, result)
            if info is not None and info.publish_return == "last":
                self.publish(f"return/{info.name}", result, retained=True)
            elif info is not None and info.publish_return == "event":
                self.publish(f"return/{info.name}", result)

    # ─── config persistence (file-based; see docs/TODO_CONFIG_SETS.md) ──
    #
    # Persistence rules (stone 3 of the config-sets spec):
    #   * The active config set on disk is the source of truth.
    #   * SecretStr fields are encrypted via the security singleton on
    #     the way OUT (save) and decrypted on the way IN (loader at boot).
    #   * Auto-mounted bus actions (get_config / set_config / save_config
    #     / reload_config) give every Service a uniform wire-level API
    #     for config without per-service plumbing.
    #   * Subclasses override ``apply_config(diff)`` to react to live
    #     changes; default is a no-op.
    #
    # Until stone 4 lands (lifecycle reads from yml instead of TinyDB),
    # save_config ALSO writes the new config to ``service_proxy.service_config``
    # in the DB so the legacy boot path keeps working. The DB write is
    # marked TODO-stone-4 below — strip when the lifecycle migrates.

    async def apply_config(self, diff: Dict[str, Any]) -> None:
        """Optional hook: react to a live config change without restarting.

        Called after a successful ``set_config`` once the new values are
        already validated + persisted. ``diff`` carries only the fields
        whose values changed (compared field-by-field on the model
        instance, so SecretStr equality follows Pydantic's rules).

        Default implementation is a no-op — services that can't apply
        any field live just don't override. Subclasses can read
        ``self.config`` for the new values (the framework has already
        swapped it in) and react accordingly.
        """
        # Mark `diff` as intentionally unused at the base level.
        del diff

    def serialize_runtime_state(self) -> None:
        """Optional hook: flush live, in-memory runtime state into
        ``self.config`` so it gets persisted by ``save_config`` /
        ``save_all_service_config``.

        Lifecycle status (running vs stopped) is recorded separately by the
        runtime as the yml's ``desired_state``. This hook is for state the
        SERVICE owns that lives outside its declared config — e.g. the clock
        records whether its tick loop is currently running into a
        ``is_clock_running`` config field, so a restored running clock
        resumes ticking (or stays paused) exactly as it was.

        Default is a no-op. Subclasses override to mutate ``self.config``
        (typically via ``self.config.merge_dict({...})``). Called by the
        snapshot path right before the yml is written; must not raise — the
        snapshot logs and continues on failure.
        """

    def _proxy_yml_path(self) -> "Path":
        """Resolve ``<data_dir>/config_sets/<active_set>/<proxy_id>.yml``."""
        from pathlib import Path
        from robotlab_x.runtime.config_sets import active_set_dir
        try:
            from config import get_settings  # local: import cycle guard
            settings = get_settings()
            data_dir = Path(getattr(settings, "data_dir", None) or "data")
        except Exception:  # noqa: BLE001
            data_dir = Path("data")
        if not data_dir.is_absolute():
            data_dir = Path.cwd() / data_dir
        return active_set_dir(data_dir) / f"{self.proxy_id}.yml"

    @staticmethod
    def _existing_desired_state(path: "Path") -> "Optional[str]":
        """Read the ``desired_state`` already recorded in the proxy yml, if
        any, so a per-mutation ``save_config`` rewrite doesn't drop it.
        Returns None when the file is absent/unreadable or carries no
        desired_state (the snapshot path is then the only writer of it)."""
        try:
            if not path.is_file():
                return None
            import yaml
            raw = yaml.safe_load(path.read_text())
            ds = raw.get("desired_state") if isinstance(raw, dict) else None
            return ds if isinstance(ds, str) else None
        except Exception:  # noqa: BLE001 — never block a save on a read hiccup
            return None

    def _security_encrypt(self):
        """Return an encrypt callable backed by the same key the
        security service uses.

        Originally this went through the running SecurityService instance
        — but the in-process adapter's qualified-module-name trick means
        ``importlib.import_module("security")`` can return a different
        module instance than the one ``SecurityService.on_start`` writes
        ``_current`` to, leaving the service "invisible" to callers
        looking up via the simple name.

        Pragmatic fix: bootstrap a SecurityCore inline from the standard
        key file. Same key, same Fernet cipher → identical ciphertext
        to what the service-routed path would produce. Cached per
        Service instance via a module-level lazy core so we don't
        thrash the filesystem on every save_config call.
        """
        core = _get_local_security_core()
        return core.encrypt if core else None

    def _security_decrypt(self):
        """Counterpart to _security_encrypt — used on reload_config."""
        core = _get_local_security_core()
        return core.decrypt if core else None

    @service_method("save_config")
    def save_config(self) -> Dict[str, Any]:
        """Persist ``self.config`` to the active config set's yml file.

        Returns ``{"ok": bool, "path": str, "error": str?}``. Services
        that mutate config at runtime (e.g. via a setter @service_method)
        call this so the change survives restart.

        Refuses to write if the config carries secrets and no security
        service is running — secrets must never reach disk in plaintext.
        """
        from robotlab_x.runtime.config_sets import save_proxy_yml, DecryptError
        path = self._proxy_yml_path()
        type_id = self.meta.service_meta_id
        # Preserve any existing ``desired_state`` (running/stopped) already
        # recorded in the yml. save_proxy_yml rewrites the whole file, so
        # without this a runtime config mutation (e.g. add_channel) would
        # strip the boot intent that "save all" / pre-restart snapshot set,
        # and the service would come back stopped after restart.
        desired_state = self._existing_desired_state(path)
        try:
            written = save_proxy_yml(
                path.parent,
                self.proxy_id,
                type_id,
                self.config,
                encrypt_fn=self._security_encrypt(),
                desired_state=desired_state,
            )
        except DecryptError as exc:
            logger.warning("save_config %s: %s", self.proxy_id, exc)
            return {"ok": False, "error": str(exc)}
        except Exception as exc:  # noqa: BLE001
            logger.exception("save_config %s: write failed", self.proxy_id)
            return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        # TODO stone 4: remove DB write once the lifecycle reads from
        # yml. Until then this keeps the legacy boot path working.
        self._save_config_to_db_legacy()
        return {"ok": True, "path": str(written)}

    def _save_config_to_db_legacy(self) -> None:
        """Legacy: mirror config into ``service_proxy.service_config``.
        Stone 4 deletes this method and its caller above."""
        try:
            from database.factory import get_database_client
        except Exception:  # noqa: BLE001
            return
        db = get_database_client()
        if db is None:
            return
        proxy = db.get_item("service_proxy", self.proxy_id)
        if not proxy:
            return
        proxy["service_config"] = self.config.model_dump()
        db.update_item("service_proxy", self.proxy_id, proxy, include_nulls=True)

    @service_method("get_config")
    def get_config(self) -> Dict[str, Any]:
        """Return the current effective config as a dict. SecretStr
        fields are masked to ``'**********'`` (Pydantic's default).

        Safe to expose over the bus — never echoes plaintext secrets."""
        if self.config_class is None:
            return {"error": "this service has no config_class"}
        # model_dump() with default mode masks SecretStr — that's what
        # we want for over-the-wire reads. The bytecode below mirrors
        # model_dump() but is explicit about the masking guarantee.
        return self.config.model_dump(mode="json")

    @service_method("set_config")
    async def set_config(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        """Apply a partial config update.

        Steps:
          1. Merge ``patch`` onto the current config dict (raw, unmasked).
          2. Validate the merged dict against ``config_class`` — Pydantic
             catches bad values here, never reaches disk.
          3. Persist via ``save_config`` (file write + DB legacy mirror).
          4. Swap ``self.config`` to the new instance.
          5. Call ``apply_config(diff)`` so subclasses can react live.

        ``patch`` may contain ``Encrypt--<plaintext>`` seeds for secret
        fields — the save step encrypts them on the way to disk.
        Returns ``{"ok": bool, "diff": {field: new_value}, "error": str?}``.
        """
        if self.config_class is None:
            return {"ok": False, "error": "this service has no config_class"}
        if not isinstance(patch, dict):
            return {"ok": False, "error": f"patch must be a dict, got {type(patch).__name__}"}
        # Merge: start from current model dump (with SecretStr unmasked),
        # apply patch keys on top. This is shallow — nested dicts get
        # replaced as a unit, matching Pydantic's own semantics.
        current_unmasked: Dict[str, Any] = {}
        for name in type(self.config).model_fields:
            value = getattr(self.config, name)
            # Use SecretStr's get_secret_value to preserve plaintext on merge.
            from pydantic import SecretStr
            if isinstance(value, SecretStr):
                current_unmasked[name] = value.get_secret_value()
            else:
                current_unmasked[name] = value
        merged = {**current_unmasked, **patch}
        # Validate via config_class.
        try:
            new_config = self.config_class(**merged)
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"validation failed: {type(exc).__name__}: {exc}"}
        # Compute diff before we swap in the new config so the hook sees
        # only what actually changed.
        diff = self._diff_configs(self.config, new_config)
        # Persist (save_config reads self.config — swap first, then save).
        old_config = self.config
        self.config = new_config
        save_result = self.save_config()
        if not save_result.get("ok"):
            # Roll back — disk write failed, don't lie about the live state.
            self.config = old_config
            return {"ok": False, "error": f"persist failed: {save_result.get('error')}"}
        # Fire the live-apply hook. Subclass exceptions don't roll back
        # — the config is already persisted; surface and continue.
        try:
            await self.apply_config(diff)
        except Exception as exc:  # noqa: BLE001
            logger.exception("apply_config raised for %s", self.proxy_id)
            return {
                "ok": True,
                "diff": diff,
                "warning": f"apply_config raised: {type(exc).__name__}: {exc}",
                "path": save_result.get("path"),
            }
        return {"ok": True, "diff": diff, "path": save_result.get("path")}

    @service_method("reload_config")
    async def reload_config(self) -> Dict[str, Any]:
        """Re-read this proxy's yml from disk, validate, apply diff.

        Useful when an operator edits the file by hand — call
        reload_config to pick up the change without restarting the
        service. Returns ``{"ok": bool, "diff": {...}, "error": str?}``.
        """
        if self.config_class is None:
            return {"ok": False, "error": "this service has no config_class"}
        from robotlab_x.runtime.config_sets import decrypt_tree
        path = self._proxy_yml_path()
        if not path.is_file():
            return {"ok": False, "error": f"file not found: {path}"}
        try:
            import yaml
            raw = yaml.safe_load(path.read_text())
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"parse failed: {exc}"}
        if not isinstance(raw, dict):
            return {"ok": False, "error": "yml must be a mapping"}
        raw.pop("type", None)  # type stays implicit — we know our own
        raw.pop("desired_state", None)  # runtime metadata, not service config
        raw = decrypt_tree(raw, self._security_decrypt())
        try:
            new_config = self.config_class(**raw)
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"validation failed: {type(exc).__name__}: {exc}"}
        diff = self._diff_configs(self.config, new_config)
        self.config = new_config
        try:
            await self.apply_config(diff)
        except Exception as exc:  # noqa: BLE001
            logger.exception("apply_config raised on reload for %s", self.proxy_id)
            return {
                "ok": True,
                "diff": diff,
                "warning": f"apply_config raised: {type(exc).__name__}: {exc}",
            }
        return {"ok": True, "diff": diff}

    @staticmethod
    def _diff_configs(old: Any, new: Any) -> Dict[str, Any]:
        """Field-level diff between two config instances. Returns a dict
        mapping field name → new value for every field whose value
        changed. SecretStr equality follows Pydantic's semantics (compares
        the underlying plaintext)."""
        diff: Dict[str, Any] = {}
        for name in type(new).model_fields:
            ov = getattr(old, name, None)
            nv = getattr(new, name)
            if ov != nv:
                # Mask SecretStr values in the diff payload — the wire
                # response shouldn't leak them. Operator gets confirmation
                # that the field changed, not the new value.
                from pydantic import SecretStr
                diff[name] = "**********" if isinstance(nv, SecretStr) else nv
        return diff

    # ─── messaging sugar ────────────────────────────────────────────────
    def topic(self, suffix: str) -> str:
        """Compose a bus topic under this service's namespace.

        Most services publish under /<type_name>/<proxy_id>/... — that
        scheme is preserved by passing absolute paths through unchanged
        and prefixing relative ones with /<type_name>/<proxy_id>/.
        """
        if suffix.startswith("/"):
            return suffix
        return f"/{self.meta.type_name}/{self.proxy_id}/{suffix}"

    def resolve_topic(self, topic: str) -> str:
        """Apply ``topic_remap`` from config.

        Single-hop substitution: if ``topic`` is a key in the remap
        table, return the value. Otherwise return the input unchanged.
        Intentionally non-recursive so a user-visible cycle in the
        remap table can't hang the bus path.

        Called by ``publish`` and ``subscribe_iter`` so a service's
        outgoing and incoming wire-shape stay in lockstep with the
        configured aliasing.
        """
        remap = getattr(self.config, "topic_remap", None)
        if not isinstance(remap, dict) or not remap:
            return topic
        return remap.get(topic, topic)

    def publish(self, suffix: str, payload: Any, *, retained: bool = False) -> None:
        get_bus().publish_sync(self.resolve_topic(self.topic(suffix)), payload, retained=retained)

    async def subscribe_iter(
        self, suffix: str, subscriber_id: str | None = None
    ):
        """Async iterator over messages on the given topic.

        subscriber_id defaults to ``<type_name>-<proxy_id>-<suffix>`` so
        independent calls from the same service don't collide. The
        suffix used for the subscriber_id is the ORIGINAL (un-remapped)
        one — the bus introspection identifies subscriptions by the
        service's conceptual topic, even when the wire path was
        rewritten by ``topic_remap``.
        """
        bus_topic = self.resolve_topic(self.topic(suffix))
        sid = subscriber_id or f"{self.meta.type_name}-{self.proxy_id}-{suffix.strip('/')}"
        async for msg in get_bus().subscribe(bus_topic, sid):
            yield msg

    # ─── framework hooks (called by adapters; do not override) ──────────
    def _bind_runtime(
        self, loop: asyncio.AbstractEventLoop, stop_event: asyncio.Event
    ) -> None:
        self._loop = loop
        self._stop_event = stop_event
