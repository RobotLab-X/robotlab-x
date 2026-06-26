# unmanaged
"""CliService — presence marker for the browser-side terminal.

The CLI itself is implemented in the browser (apps/robotlab_x_ui/src/
serviceViews/Cli.tsx + apps/robotlab_x_ui/src/cli/). The browser
already has a bus client + REST client; everything ``ls``/``cat``/
``tail``/``call`` does maps onto those existing primitives, so there's
no work for the backend to do on each keystroke.

What this service IS for:

  * Showing up in the canvas as a normal service-type so a user can
    "add a cli" the same way they add a clock or video. Multiple CLIs
    can coexist with independent ``cd`` contexts.
  * Carrying per-instance config (history buffer size, prompt). The
    browser reads ``config_state`` on connect.
  * Auto-registering with the type catalog (``/runtime/runtime/types/
    cli``) so the discovery story is complete — the CLI ITSELF is
    discoverable + introspectable through the same channels every
    other service uses.

There are no methods that affect the bus from the server side. The
``echo`` method exists as a smoke-test path so a user can run
``call echo "hello"`` from the terminal and confirm round-trip wiring.
"""
from __future__ import annotations

import logging
from typing import Any, Dict

from pydantic import BaseModel, Field
from rlx_bus import ServiceConfig
from robotlab_x.framework import Service, service_method


logger = logging.getLogger(__name__)


class CliConfig(ServiceConfig):
    """Per-instance CLI preferences. The browser reads these on connect
    and seeds the terminal accordingly."""
    history_size: int = Field(
        500, ge=10, le=10000,
        description="Number of previous commands kept in localStorage for ↑/↓ recall.",
    )
    prompt: str = Field(
        "> ",
        description=(
            "Suffix that follows the runtime id in the prompt — full format "
            "is ``{path} {runtime_id}{prompt}``. Default is a bare ``> `` "
            "(with trailing space) so the line reads ``/clock/clock-1 "
            "witty-gizmo> ``."
        ),
    )


class CliState(BaseModel):
    """Lightweight retained state — mostly so the type catalog has a
    state_schema to advertise. The browser publishes its own view-side
    state (current cwd, peer) via separate retained topics if needed;
    here we only carry framework-level liveness."""
    ready: bool = Field(description="True once the in-process service has booted; flips to false on stop.")


class CliService(Service):
    config_class = CliConfig
    state_schema = CliState
    publishes = ["state"]

    async def on_start(self) -> None:
        self._publish_state(True)

    async def on_stop(self) -> None:
        self._publish_state(False)

    def _publish_state(self, ready: bool) -> None:
        self.publish("state", {"ready": ready}, retained=True)

    @service_method("echo")
    def m_echo(self, message: str = "") -> Dict[str, Any]:
        """Echo back ``message``. Smoke-test path for the CLI's call
        verb — a successful ``call echo "hello"`` confirms the entire
        round trip (terminal → control → service_method → reply_to)."""
        return {"echo": str(message)}
