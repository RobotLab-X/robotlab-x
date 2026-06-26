# unmanaged
"""Publish proposed tool calls to the bus + await the reply.

Wraps the usual ``publish + reply_to`` pattern with a clean interface:

    result = await tool_executor.call(topic="/video/video-1/control",
                                      action="capture_frame",
                                      args={"camera": 0})

The executor is the only place that touches the bus directly — every
other module deals in Pydantic structures. That makes unit testing
trivial: swap in a stub executor whose ``call()`` returns scripted
``ToolResult`` objects and the rest of the brain runs unmodified.
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import Any, Dict, Optional

from brain.schemas import ToolResult


logger = logging.getLogger(__name__)


class ToolExecutor:
    """Bus-publish + reply_to roundtrip wrapper.

    Constructed with a ``publish`` callable (``bus.publish_sync``-shaped)
    and a ``subscribe`` callable (returns an async iterator of frames
    for the reply topic). The in-process Service base class provides
    matching helpers; tests can inject anything callable.
    """

    def __init__(
        self,
        *,
        publish,
        subscribe_reply,
        reply_root: str = "/brain/_replies",
    ):
        self._publish = publish
        self._subscribe_reply = subscribe_reply
        self._reply_root = reply_root.rstrip("/")

    async def call(
        self,
        *,
        topic: str,
        action: str,
        args: Dict[str, Any],
        timeout: float = 30.0,
    ) -> ToolResult:
        """Publish ``{action, **args, reply_to}`` to ``topic``, await the
        reply, return it as a ToolResult. ``error`` and ``timeout`` are
        reported via the result's ``status`` field — this function
        does not raise on remote failures, only on bus plumbing errors.
        """
        reply_to = f"{self._reply_root}/{uuid.uuid4().hex[:16]}"
        payload = {"action": action, **args, "reply_to": reply_to}

        # Subscribe BEFORE publishing so we don't miss the reply if the
        # remote responds synchronously.
        future: asyncio.Future[Any] = asyncio.get_event_loop().create_future()

        async def _consume():
            try:
                async for msg in self._subscribe_reply(reply_to):
                    if not future.done():
                        future.set_result(msg)
                    return
            except Exception as exc:  # noqa: BLE001
                if not future.done():
                    future.set_exception(exc)

        consume_task = asyncio.create_task(_consume())
        try:
            self._publish(topic, payload)
            t0 = time.monotonic()
            try:
                msg = await asyncio.wait_for(future, timeout=timeout)
            except asyncio.TimeoutError:
                return ToolResult(
                    status="timeout",
                    error=f"no reply on {reply_to} within {timeout}s",
                    duration_ms=int((time.monotonic() - t0) * 1000),
                )
            duration_ms = int((time.monotonic() - t0) * 1000)
            # Normalise: {"error": "..."} → status=error
            if isinstance(msg, dict) and "error" in msg and msg.get("error"):
                return ToolResult(status="error", error=str(msg["error"]), duration_ms=duration_ms)
            return ToolResult(status="ok", value=msg, duration_ms=duration_ms)
        finally:
            consume_task.cancel()
            try:
                await consume_task
            except (asyncio.CancelledError, Exception):
                pass
