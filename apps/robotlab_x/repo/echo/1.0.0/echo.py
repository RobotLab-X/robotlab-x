# unmanaged
"""EchoService — republishes everything from inbox topic to outbox topic.

Defaults:
    inbox  = /echo/{proxy_id}/inbox
    outbox = /echo/{proxy_id}/outbox

Override either via service_config.{inbox,outbox}. The instance proxy_id
is substituted for ${name} in the configured value.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

from rlx_bus import ServiceConfig
from robotlab_x.framework import Service, service_method
from robotlab_x.runtime.bus import get_bus


logger = logging.getLogger(__name__)


def _resolve(template: str, instance: str) -> str:
    return template.replace("${name}", instance)


class EchoConfig(ServiceConfig):
    """Strongly-typed config for EchoService."""
    inbox: str = "/echo/${name}/inbox"
    outbox: str = "/echo/${name}/outbox"


class EchoService(Service):
    config_class = EchoConfig
    inbox: str
    outbox: str
    _count: int
    _task: Optional[asyncio.Task]

    async def on_start(self) -> None:
        self.inbox = _resolve(self.config.inbox, self.proxy_id)
        self.outbox = _resolve(self.config.outbox, self.proxy_id)
        self._count = 0
        self._task = asyncio.create_task(self._echo_loop())

    async def on_stop(self) -> None:
        # Wake the subscribe iterator and signal the loop to exit.
        try:
            await get_bus().unsubscribe_all(f"echo:{self.proxy_id}")
        except Exception:
            pass
        if self._task is not None and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass

    @service_method("stats")
    def stats(self) -> dict:
        """Return the forward count + topic mapping."""
        return {"count": self._count, "inbox": self.inbox, "outbox": self.outbox}

    async def _echo_loop(self) -> None:
        bus = get_bus()
        sub_id = f"echo:{self.proxy_id}"
        async for msg in bus.subscribe(self.inbox, subscriber_id=sub_id):
            if msg.topic == "__terminate__" or self.is_stopping():
                break
            bus.publish_sync(self.outbox, msg.payload, sender_id=sub_id)
            self._count += 1
