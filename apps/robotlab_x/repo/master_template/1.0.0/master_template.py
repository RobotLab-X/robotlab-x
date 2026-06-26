# unmanaged
"""master_template — reference service implementation.

This is the in-process variant (matches package.yml's
``install.kind: builtin`` + ``entry.in_process``). For the subprocess
variant, see ``repo/echo_http/1.0.0/src/echo_http/__main__.py`` —
the contract is the same (subscribe + publish over the bus) but the
service runs in a child process and uses ``rlx_bus`` directly instead
of inheriting from ``framework.Service``.

Bus topics
----------
  /master_template/{proxy_id}/state    -> retained snapshot of internal state
  /master_template/{proxy_id}/control  <- ``{"action": "do_thing"}`` etc.

The framework gives you for free, just from subclassing Service:
  * config persistence to service_proxy.service_config
  * /state retained publishing via ``self.publish_state()``
  * a control-loop that dispatches /control messages to @service_method
    handlers, with reply_to + auto-publish hooks (see framework/service.py)
  * a 1Hz heartbeat on /master_template/{id}/heartbeat
  * graceful start/stop hooks
"""
from __future__ import annotations

import logging
from typing import Any, Dict

from pydantic import Field
from rlx_bus import ServiceConfig
from robotlab_x.framework import Service, service_method


logger = logging.getLogger(__name__)


class MasterTemplateConfig(ServiceConfig):
    """Strongly-typed config — fields here correspond to the
    wizard_config entries in package.yml. The runtime hydrates this
    from service_proxy.service_config on every start, so the wizard's
    values flow through verbatim.
    """
    example_message: str = Field(
        "hello from master_template",
        description="Free-text example",
    )
    tick_count: int = Field(5, description="How many demo ticks to count")
    enabled: bool = Field(True, description="Toggle the demo loop")


class MasterTemplateService(Service):
    """Service base class — see ``framework/service.py`` for the full
    surface. The interesting hooks are:

      * ``on_start``        — called once after config is hydrated
      * ``on_stop``         — called on graceful shutdown
      * @service_method     — decorate methods to expose them on /control
      * ``self.publish``    — publish to ``/<type>/<id>/<suffix>``
      * ``self.publish_state`` — convenience wrapper for retained /state
      * ``self.config``     — the typed config instance
      * ``self.update_config(patch)`` — persist a partial update
    """

    type_name = "master_template"
    config_class = MasterTemplateConfig
    heartbeat_interval_s = 1.0   # framework publishes /heartbeat at this rate

    async def on_start(self) -> None:
        """First thing called after the proxy goes ``running``. Set up
        any resources here. The bus + config are already wired by the
        time this runs."""
        logger.info(
            "master_template %s starting — message=%r tick_count=%d enabled=%s",
            self.proxy_id,
            self.config.example_message,
            self.config.tick_count,
            self.config.enabled,
        )
        await self.publish_state()

    async def on_stop(self) -> None:
        """Release anything ``on_start`` allocated. Best-effort; the
        framework will SIGTERM if you hang here for too long."""
        logger.info("master_template %s stopping", self.proxy_id)

    # ─── @service_method actions ────────────────────────────────────
    # Decorate any handler with @service_method("<name>") to make it
    # available on /control. The framework's control loop dispatches by
    # the message's ``action`` field, handles reply_to round-trips, and
    # logs unknown actions.

    @service_method("do_thing")
    async def m_do_thing(self, count: int = 1) -> Dict[str, Any]:
        """Example action. Take a kwarg ``count`` (validated by the
        framework's signature inspection) and return a result dict the
        caller's reply_to gets routed."""
        logger.info("master_template %s: do_thing count=%d", self.proxy_id, count)
        return {"did_thing": True, "count": count, "message": self.config.example_message}

    @service_method("set_message")
    async def m_set_message(self, message: str) -> Dict[str, Any]:
        """Mutate config + persist. ``update_config`` writes back to
        service_proxy.service_config so the new value survives restart."""
        await self.update_config({"example_message": str(message)})
        await self.publish_state()
        return {"example_message": self.config.example_message}

    # ─── state snapshot ─────────────────────────────────────────────
    def _snapshot(self) -> Dict[str, Any]:
        """Override if you want extra fields in /state beyond the config
        defaults. The base class composes this with framework metadata."""
        return {
            "enabled": self.config.enabled,
            "tick_count": self.config.tick_count,
            "message": self.config.example_message,
        }
