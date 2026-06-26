# unmanaged
"""UIService — browser canvas state as a real service.

Currently the canvas state (node positions, edges, viewport) lives in
the workspace table under ``node_positions`` / ``node_view_types`` /
``edges``. Stone 6 of the config-sets spec promotes that state into a
proper Service so it round-trips the same way every other service
config does — load from yml, decrypt secrets, validate, persist, apply.

Operators create one ``ui`` instance per workspace they care about
(typical: ``ui-1`` for the runtime workspace). The browser publishes
canvas mutations to /ui/{id}/control via ``set_config`` (auto-mounted
by the framework). The service mirrors state to /ui/{id}/state retained
so subscribers (the canvas) get the live snapshot.

No subprocess, no heartbeat work, no other state — this is one of the
smallest "real" services in the runtime.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

from pydantic import Field
from rlx_bus import ServiceConfig
from robotlab_x.framework import Service, service_method


logger = logging.getLogger(__name__)


class UIConfig(ServiceConfig):
    """Per-instance canvas state. Mirrors the fields currently on
    workspace rows so a future migration is a straight field-rename."""

    # Per-node viewport position. Keys are proxy_ids; values carry
    # x, y, and optionally width/height for sized nodes (Cli, Brain).
    node_positions: Dict[str, Dict[str, float]] = Field(default_factory=dict)

    # Per-node view choice. Keys are proxy_ids; values are 'view_min',
    # 'view_name_and_type', 'view_full'. Unset nodes default to the
    # type's preferred view.
    node_view_types: Dict[str, str] = Field(default_factory=dict)

    # Free-form edges between nodes. Each entry: {id, source, target,
    # source_handle?, target_handle?, label?}. The shape matches
    # React Flow's edge model.
    edges: List[Dict[str, Any]] = Field(default_factory=list)

    # React Flow viewport — x/y/zoom.
    viewport: Dict[str, float] = Field(default_factory=lambda: {"x": 0.0, "y": 0.0, "zoom": 1.0})

    # Workspace id this UI belongs to. Used by the browser to filter
    # which canvas state belongs to the active workspace.
    workspace_id: Optional[str] = Field(
        None,
        description="The workspace this canvas state is bound to. "
                    "Browser uses this to filter live state; the service "
                    "itself doesn't enforce anything based on it.",
    )


class UIService(Service):
    """In-process service that holds canvas layout state.

    State publishing strategy: every ``apply_config`` republishes the
    full state retained. Late subscribers always see the current truth.
    The framework already mounted ``set_config``/``get_config``/
    ``save_config``/``reload_config``; we just override
    ``apply_config`` to re-emit the retained snapshot.
    """

    type_name = "ui"
    config_class = UIConfig
    publishes = ["state"]
    _control_task: Optional[asyncio.Task] = None

    async def on_start(self) -> None:
        self._publish_state()
        self._control_task = asyncio.create_task(self.run_control_loop())

    async def on_stop(self) -> None:
        task = self._control_task
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass

    async def apply_config(self, diff: Dict[str, Any]) -> None:
        """Every config change → re-emit the retained state snapshot.

        ``diff`` carries the patched fields; we don't bother with
        partial updates because the canvas state is small and the
        browser always wants the full picture anyway."""
        del diff
        self._publish_state()

    def _publish_state(self) -> None:
        """Emit the full canvas state retained so the next subscriber
        (a freshly-loaded browser tab, a remote peer) gets it
        immediately without a request round-trip."""
        cfg = self.config
        self.publish(
            "state",
            {
                "workspace_id": cfg.workspace_id,
                "node_positions": cfg.node_positions,
                "node_view_types": cfg.node_view_types,
                "edges": cfg.edges,
                "viewport": cfg.viewport,
            },
            retained=True,
        )

    # ─── @service_method bespoke helpers (operator convenience) ──────

    @service_method("move_node")
    async def m_move_node(
        self,
        node_id: str,
        x: float,
        y: float,
        width: Optional[float] = None,
        height: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Drag-end helper. The browser CAN call set_config directly with
        the full node_positions dict patched; this is a smaller wire
        shape for the common single-node move case."""
        positions = dict(self.config.node_positions)
        entry: Dict[str, float] = {"x": float(x), "y": float(y)}
        existing = positions.get(node_id) or {}
        if width is not None:
            entry["width"] = float(width)
        elif "width" in existing:
            entry["width"] = float(existing["width"])
        if height is not None:
            entry["height"] = float(height)
        elif "height" in existing:
            entry["height"] = float(existing["height"])
        positions[node_id] = entry
        return await self.set_config({"node_positions": positions})

    @service_method("set_viewport")
    async def m_set_viewport(self, x: float, y: float, zoom: float) -> Dict[str, Any]:
        """Viewport pan/zoom helper."""
        return await self.set_config({
            "viewport": {"x": float(x), "y": float(y), "zoom": float(zoom)},
        })

    @service_method("set_node_view")
    async def m_set_node_view(self, node_id: str, view_type: str) -> Dict[str, Any]:
        """Update one node's view choice."""
        if view_type not in {"view_min", "view_name_and_type", "view_full"}:
            return {"ok": False, "error": f"unknown view_type: {view_type!r}"}
        views = dict(self.config.node_view_types)
        views[node_id] = view_type
        return await self.set_config({"node_view_types": views})
