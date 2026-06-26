"""@service_method — mark a method as callable through the service interface.

Decorated methods are discoverable via ``methods()`` and routable through
the bus / future RPC layer. The decorator is a lightweight tag: it
stores metadata on the method object without changing behaviour, so
direct Python calls still work the same.

This module is the canonical home of the decorator. The backend's
``robotlab_x.framework.methods`` re-exports it so in-process services
(``framework.Service`` subclasses) and subprocess services
(``rlx_bus.SubprocessService`` subclasses) share one definition.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, List, Optional


_SERVICE_METHOD_ATTR = "_rlx_service_method"


@dataclass
class MethodInfo:
    """Per-method metadata.

    Returned by ``methods()`` on either a framework Service or a
    SubprocessService, and surfaced through the
    ``GET /v1/service-proxy/{id}/methods`` endpoint when the service is
    in-process.

    ``name`` is the wire-level identifier — what the bus / UI sends
    as ``{"action": name}`` on the control topic. ``attr`` is the
    Python attribute the framework calls via ``getattr(instance, attr)``.
    They can differ — common pattern: ``@service_method("connect")``
    on ``def m_connect``. ``attr`` defaults to the wire name for
    decorator-time use; ``collect_methods`` rewrites it with the
    actual bound attribute name when walking ``dir(instance)``.

    Layer 1 fields:

    ``publishes`` — topic suffixes (or absolute paths) this method MAY
    publish to. Discovered statically from the decorator at registration
    time so the catalog can show "what does this method emit?" without
    running an instance. Values are templates: ``state`` resolves to
    ``/{type}/{id}/state``; absolute paths starting with ``/`` pass
    through.

    ``publish_return`` — opt-in auto-publish of the method's return
    value after a successful invocation. ``None`` (default) →
    no auto-publish; ``"last"`` → publish to
    ``/{type}/{id}/return/{name}`` with ``retained=True``; ``"event"``
    → publish to the same topic non-retained.
    """

    name: str
    doc: Optional[str] = None
    attr: Optional[str] = None
    publishes: List[str] = field(default_factory=list)
    publish_return: Optional[str] = None


def service_method(
    name: Optional[str] = None,
    *,
    publishes: Optional[List[str]] = None,
    publish_return: Optional[str] = None,
) -> Callable[[Callable[..., object]], Callable[..., object]]:
    """Mark a Service method as callable through the service interface.

    Usage::

        from rlx_bus import service_method, SubprocessService

        class MyService(SubprocessService):
            @service_method("do_thing", publishes=["state"])
            def do_thing(self, arg: int) -> dict:
                ...

    The wire-level ``name`` defaults to the Python method name; pass an
    explicit string to decouple them (useful for renames without
    breaking callers).

    ``publishes`` declares which topics the method body MAY emit on
    (static documentation enforced by proximity to the code; the body
    still calls ``self.publish(...)`` itself).

    ``publish_return`` — when set, the framework auto-publishes the
    method's return value AFTER successful invocation to
    ``/{type}/{id}/return/{name}``. Values: ``"last"`` (retained) or
    ``"event"`` (non-retained).
    """
    if publish_return not in (None, "last", "event"):
        raise ValueError(
            f"publish_return must be None | 'last' | 'event', got {publish_return!r}"
        )
    def _decorate(fn: Callable[..., object]) -> Callable[..., object]:
        info = MethodInfo(
            name=name or fn.__name__,
            doc=(fn.__doc__ or "").strip() or None,
            publishes=list(publishes or []),
            publish_return=publish_return,
        )
        setattr(fn, _SERVICE_METHOD_ATTR, info)
        return fn
    return _decorate


def collect_methods(instance: object) -> List[MethodInfo]:
    """Walk an instance and collect every @service_method-tagged method.

    Inherited methods are included via dir() — Python's MRO does the
    heavy lifting; we just filter for the tag. Each returned ``MethodInfo``
    carries the wire ``name`` AND the actual Python ``attr`` so the
    framework can both match against incoming actions AND look up the
    callable via ``getattr`` even when wire and attr names differ
    (e.g. ``@service_method('connect')`` on ``def m_connect``).
    """
    found: List[MethodInfo] = []
    seen: set[str] = set()
    for attr in dir(instance):
        if attr.startswith("_"):
            continue
        try:
            value = getattr(instance, attr)
        except Exception:  # noqa: BLE001  — some descriptors raise during access
            continue
        info: Optional[MethodInfo] = getattr(value, _SERVICE_METHOD_ATTR, None)
        if info is None or info.name in seen:
            continue
        seen.add(info.name)
        # The tag on the function is shared across instances and doesn't
        # know its bound name — record it here at collection time. Carry
        # forward the declarative-publish fields so callers can introspect
        # a service's full wire contract from one MethodInfo list.
        found.append(MethodInfo(
            name=info.name,
            doc=info.doc,
            attr=attr,
            publishes=list(info.publishes),
            publish_return=info.publish_return,
        ))
    found.sort(key=lambda m: m.name)
    return found
