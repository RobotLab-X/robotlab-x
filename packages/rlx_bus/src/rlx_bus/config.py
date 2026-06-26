"""Strongly-typed service configuration base class.

Every service (in-process Service or SubprocessService) declares a
config subclass. The framework constructs and validates it on startup
and on every persisted patch, and exposes a JSON schema for tooling.

Usage::

    from rlx_bus import ServiceConfig

    class MyServiceConfig(ServiceConfig):
        interval_ms: int = 1000
        last_port: Optional[str] = None

    class MyService(SubprocessService):
        config_class = MyServiceConfig

        async def on_start(self):
            # self.config is a typed MyServiceConfig instance
            print(self.config.interval_ms)

Services that don't declare a ``config_class`` get a permissive
``ServiceConfig`` base that accepts any fields (extra='allow'). This
keeps in-process Service subclasses that haven't yet migrated working.

``model_config = ConfigDict(extra='forbid')`` is the default for
subclasses — a typo'd config key fails fast instead of silently
landing in an extras bag.
"""
from __future__ import annotations

from typing import Any, Dict

from pydantic import BaseModel, ConfigDict, Field


class ServiceConfig(BaseModel):
    """Base for service configs.

    The base permits extra fields so services that haven't migrated to
    a typed config still work. Subclasses inherit ``extra='forbid'``
    via their own ``model_config`` if they want strict validation —
    Pydantic merges configs through inheritance.

    Universal field every service inherits:

    ``topic_remap`` — ROS-style topic aliasing. Keys + values are
    absolute bus paths starting with ``/``. When the service is about
    to publish to or subscribe from a key topic, the framework
    substitutes the value instead. Empty default ⇒ services behave as
    before until a remap entry is added (via the Inspector UI or a
    config_patch).
    """

    model_config = ConfigDict(extra="allow")

    topic_remap: Dict[str, str] = Field(
        default_factory=dict,
        description=(
            "Absolute-topic remap table. Keys + values are absolute bus "
            "paths starting with '/'. Used by Service.resolve_topic for "
            "both publish and subscribe."
        ),
    )

    def merge_dict(self, updates: Dict[str, Any]) -> "ServiceConfig":
        """Return a new instance with ``updates`` merged in.

        Re-validates against the schema — a bad field type or unknown
        key (for strict subclasses) raises ``pydantic.ValidationError``.
        """
        merged = {**self.model_dump(), **updates}
        return type(self)(**merged)
