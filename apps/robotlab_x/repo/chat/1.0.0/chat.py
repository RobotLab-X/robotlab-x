# unmanaged
"""ChatService — text bridge for the brain's conversation workflows.

The brain's bundled ``conversation_session`` workflow was designed
against a speech service exposing ``listen`` + ``speak``. This is the
text-only equivalent — same method names + return shapes, but messages
travel as plain text over the bus instead of audio. Useful for
developing conversation workflows on a dev box without hooking up STT
+ TTS.

Bus topics
----------
  /chat/{proxy_id}/inbox      <- {"text": str, ...optional}
                                 operator publishes utterances here
                                 (UI text box, ``rlx publish``, etc.)
  /chat/{proxy_id}/spoken     -> {"text": str, "ts": float}
                                 published when the brain calls
                                 ``speak()`` — UI subscribes + renders
  /chat/{proxy_id}/state      -> {"listening": bool, "queued": int,
                                  "last_inbox": str, "last_spoken": str}
                                 retained snapshot for late subscribers
  /chat/{proxy_id}/control    <- standard framework envelope.
                                 Actions: ``listen``, ``speak``,
                                 ``send`` (back-channel for tests).

Why ``listen()`` blocks instead of streaming
--------------------------------------------
The brain's tool-call model is request/response — one call returns one
ToolResult. A streaming subscription wouldn't fit the existing engine.
``listen()`` therefore parks on an inbox queue until a message arrives
or its timeout fires, then returns the next utterance as a tool
result. The brain's workflow drives the conversation loop by calling
``listen()`` repeatedly.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Dict, Optional

from rlx_bus import ServiceConfig
from robotlab_x.framework import Service, service_method


logger = logging.getLogger(__name__)


class ChatConfig(ServiceConfig):
    """No persistent knobs — chat is stateless between runs. ServiceConfig
    is still required so the framework can mount ``set_config`` and any
    future fields land in the same place."""
    pass


class ChatService(Service):
    config_class = ChatConfig
    publishes = ["spoken", "state"]
    _inbox_queue: "asyncio.Queue[Dict[str, Any]]"
    _inbox_task: Optional[asyncio.Task]
    _controller_task: Optional[asyncio.Task]
    _last_inbox: str
    _last_spoken: str
    _listening: bool

    async def on_start(self) -> None:
        # The queue holds operator messages that arrived since the last
        # ``listen()`` returned. Bounded to keep a runaway publisher
        # from eating memory; oldest messages drop on overflow.
        self._inbox_queue = asyncio.Queue(maxsize=64)
        self._last_inbox = ""
        self._last_spoken = ""
        self._listening = False
        self._publish_state()
        self._inbox_task = asyncio.create_task(self._inbox_loop())
        self._controller_task = asyncio.create_task(self.run_control_loop())

    async def on_stop(self) -> None:
        for task in (self._inbox_task, self._controller_task):
            if task is not None and not task.done():
                task.cancel()
        await asyncio.gather(
            *(t for t in (self._inbox_task, self._controller_task) if t is not None),
            return_exceptions=True,
        )

    # ─── @service_method actions ────────────────────────────────────────

    @service_method("listen", publishes=["state"])
    async def listen(
        self,
        timeout_seconds: int = 8,
        bearing: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Pull one operator utterance off the inbox queue. Blocks for
        up to ``timeout_seconds`` waiting for a message; returns an
        empty utterance on timeout so the workflow can decide whether
        to retry or terminate (the brain's conversation_session exits
        after two timeouts in a row).

        ``bearing`` is reserved — the speech service would report an
        angle to the speaker; chat has no audio so it's None. Kept in
        the signature so the brain's prompt + workflows transfer
        verbatim between chat and a future speech service.

        Returns ``{"text": str, "bearing": float | None,
        "timeout": bool}``."""
        del bearing  # accepted for API parity, unused in text chat
        try:
            timeout = max(0.5, float(timeout_seconds))
        except (TypeError, ValueError):
            timeout = 8.0
        self._listening = True
        self._publish_state()
        try:
            msg = await asyncio.wait_for(self._inbox_queue.get(), timeout=timeout)
        except asyncio.TimeoutError:
            self._listening = False
            self._publish_state()
            return {"text": "", "bearing": None, "timeout": True}
        text = str(msg.get("text", "")).strip()
        self._last_inbox = text
        self._listening = False
        self._publish_state()
        return {"text": text, "bearing": None, "timeout": False}

    @service_method("speak", publishes=["spoken", "state"])
    def speak(self, text: str) -> Dict[str, Any]:
        """Emit a reply. Publishes to ``/chat/{id}/spoken`` so the UI
        renders it. Returns immediately — text "speech" has no
        playback to wait for, so the brain workflow's
        ``await speak; await listen`` ordering simply means "publish,
        then go back to listening".

        Returns ``{"spoken": str, "ts": float}`` so callers can log
        what they emitted."""
        if not isinstance(text, str):
            raise TypeError(f"speak.text must be str, got {type(text).__name__}")
        ts = time.time()
        self._last_spoken = text
        self.publish("spoken", {"text": text, "ts": ts})
        self._publish_state()
        return {"spoken": text, "ts": ts}

    @service_method("send")
    def send(self, text: str) -> Dict[str, Any]:
        """Back-channel for tests + manual exercises. Equivalent to
        publishing ``{"text": text}`` to ``/chat/{id}/inbox`` directly.

        Useful when you want to script an operator turn without the UI
        — e.g. ``rlx call /chat/chat-1/control send text="hi"``."""
        if not isinstance(text, str):
            raise TypeError(f"send.text must be str, got {type(text).__name__}")
        self.publish("inbox", {"text": text, "ts": time.time()})
        return {"sent": text}

    # ─── internals ──────────────────────────────────────────────────────

    def _publish_state(self) -> None:
        """One retained state message — UI reads it to render the
        current chat status without subscribing to every event topic."""
        self.publish(
            "state",
            {
                "listening": self._listening,
                "queued": self._inbox_queue.qsize() if hasattr(self, "_inbox_queue") else 0,
                "last_inbox": self._last_inbox,
                "last_spoken": self._last_spoken,
            },
            retained=True,
        )

    async def _inbox_loop(self) -> None:
        """Drain ``/chat/{id}/inbox`` into the queue. Anything that
        isn't a dict with a ``text`` field is dropped — silently for
        now; switch to a warn-log if operators start mis-shaping
        messages frequently."""
        async for msg in self.subscribe_iter("inbox"):
            payload = msg.payload if isinstance(msg.payload, dict) else None
            if not payload or not isinstance(payload.get("text"), str):
                continue
            try:
                self._inbox_queue.put_nowait(payload)
            except asyncio.QueueFull:
                # Drop the oldest to make room — the operator just
                # spoke and they care more about the latest message
                # than a stale one from before listen() was bound.
                try:
                    self._inbox_queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                self._inbox_queue.put_nowait(payload)
            self._publish_state()
