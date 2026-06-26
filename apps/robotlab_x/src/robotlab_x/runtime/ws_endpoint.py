# unmanaged
"""WebSocket endpoint for the runtime bus.

Mounts ``GET /v1/ws`` on the FastAPI app via ``register_ws_routes(app)``,
which is called from ``robotlab_x.yml`` ``api.extend``. One connection
per user. Frames are JSON, matching the shape of the ``message`` model
in the yml:

    { "id": "<uuid>", "method": "<verb>", "data": { ... } }

Methods (client → server):
    subscribe   { topic }
    unsubscribe { topic }
    publish     { topic, payload, retained?: bool }
    request     { topic, payload, reply_to } — same as publish; sender
                                               supplies reply_to so a
                                               responder can address them.

Server → client frames use ``method: "message"`` for bus deliveries,
``method: "ack"`` for command receipts, and ``method: "error"`` for
malformed frames.

Auth is JWT in the ``?token=`` query parameter. Browsers cannot set
headers on ``new WebSocket(url)``, so the query carries the token. Same
shared secret + algorithm (HS256) as ``packages/auth/local_auth.py``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from typing import Dict, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

import jwt

from robotlab_x.runtime.bus import Bus, get_bus


logger = logging.getLogger(__name__)


# WebSocket close codes (RFC 6455 — application range starts at 4000).
_CLOSE_NO_TOKEN = 4401      # like HTTP 401 for the WS world.
_CLOSE_BAD_TOKEN = 4403     # like HTTP 403.


def _jwt_secret() -> str:
    # Match packages/auth/local_auth.py exactly — same env var, same default.
    return os.environ.get("JWT_SECRET_KEY", "fallback_dev_key")


def _decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, _jwt_secret(), algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        logger.info("ws.auth_rejected reason=%s", exc.__class__.__name__)
        return None


async def _ws_send_json(ws: WebSocket, frame: dict) -> None:
    """Send a frame but tolerate a half-closed socket."""
    if ws.client_state != WebSocketState.CONNECTED:
        return
    try:
        await ws.send_text(json.dumps(frame))
    except (WebSocketDisconnect, RuntimeError):
        # Client disconnected mid-write or socket is closing — give up
        # silently; the main read-loop will catch the disconnect and
        # tear the connection down.
        pass


async def _pump_bus_to_ws(
    bus: Bus,
    topic: str,
    subscriber_id: str,
    ws: WebSocket,
) -> None:
    """Forward every message on ``topic`` to ``ws`` as a frame.

    Owned by the WS handler — cancelled on unsubscribe or disconnect.
    """
    try:
        async for msg in bus.subscribe(topic, subscriber_id=subscriber_id):
            if msg.topic == "__terminate__":
                return
            await _ws_send_json(
                ws,
                {
                    "method": "message",
                    "topic": msg.topic,
                    "payload": msg.payload,
                    "sender_id": msg.sender_id,
                    "reply_to": msg.reply_to,
                    "timestamp": msg.timestamp,
                },
            )
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("ws.pump_error topic=%s subscriber=%s", topic, subscriber_id)


def register_ws_routes(app: FastAPI) -> None:
    """Attach ``GET /v1/ws`` to the FastAPI app.

    Called from robotlab_x.yml ``api.extend`` so route registration stays
    with the rest of the app's generated routes.
    """
    bus = get_bus()

    @app.websocket("/v1/ws")
    async def ws_endpoint(websocket: WebSocket) -> None:
        token = websocket.query_params.get("token")
        if not token:
            await websocket.close(code=_CLOSE_NO_TOKEN, reason="missing token")
            return
        payload = _decode_token(token)
        if not payload:
            await websocket.close(code=_CLOSE_BAD_TOKEN, reason="bad token")
            return

        await websocket.accept()
        user = payload.get("user") or {}
        user_id = user.get("id") or payload.get("sub") or "anonymous"
        # Per-connection subscriber id keeps two tabs from sharing queues.
        connection_id = f"{user_id}#{uuid.uuid4().hex[:8]}"
        pumps: Dict[str, asyncio.Task] = {}

        logger.info("ws.connect user=%s conn=%s", user_id, connection_id)

        try:
            while True:
                raw = await websocket.receive_text()
                try:
                    frame = json.loads(raw)
                except json.JSONDecodeError:
                    await _ws_send_json(
                        websocket,
                        {"method": "error", "error": "invalid_json"},
                    )
                    continue

                method = frame.get("method")
                data = frame.get("data") or {}
                topic = data.get("topic") if isinstance(data, dict) else None
                frame_id = frame.get("id")

                if method == "subscribe":
                    if not topic:
                        await _ws_send_json(
                            websocket,
                            {"method": "error", "id": frame_id, "error": "missing_topic"},
                        )
                        continue
                    if topic in pumps:
                        # idempotent: ack but don't double-subscribe.
                        await _ws_send_json(
                            websocket,
                            {"method": "ack", "id": frame_id, "topic": topic, "subscribed": True},
                        )
                        continue
                    task = asyncio.create_task(
                        _pump_bus_to_ws(bus, topic, connection_id, websocket),
                        name=f"ws_pump:{connection_id}:{topic}",
                    )
                    pumps[topic] = task
                    await _ws_send_json(
                        websocket,
                        {"method": "ack", "id": frame_id, "topic": topic, "subscribed": True},
                    )

                elif method == "unsubscribe":
                    task = pumps.pop(topic, None) if topic else None
                    if task is not None:
                        task.cancel()
                    await _ws_send_json(
                        websocket,
                        {"method": "ack", "id": frame_id, "topic": topic, "subscribed": False},
                    )

                elif method == "publish":
                    if not topic:
                        await _ws_send_json(
                            websocket,
                            {"method": "error", "id": frame_id, "error": "missing_topic"},
                        )
                        continue
                    payload_value = data.get("payload")
                    retained = bool(data.get("retained", False))
                    count = await bus.publish(
                        topic,
                        payload_value,
                        sender_id=connection_id,
                        retained=retained,
                    )
                    await _ws_send_json(
                        websocket,
                        {
                            "method": "ack",
                            "id": frame_id,
                            "topic": topic,
                            "delivered": count,
                        },
                    )

                elif method == "list_topics":
                    # Inspector polls this to discover what's flowing on the
                    # bus. Returns active topic names with their current
                    # subscriber count, retained-message flag, dropped
                    # count, AND the parsed identity of each subscriber
                    # (Layer 3 — so the UI can say *who* is listening,
                    # not just how many). ``patterns`` carries wildcard
                    # subscriptions separately so the UI can show them
                    # distinct from concrete topics.
                    topics_out = bus.list_topics_detail()
                    patterns_out = sorted(bus.patterns())
                    await _ws_send_json(
                        websocket,
                        {
                            "method": "topics",
                            "id": frame_id,
                            "topics": topics_out,
                            "patterns": patterns_out,
                        },
                    )

                elif method == "request":
                    # Same write path as publish; sender supplies reply_to
                    # so the responder can route a reply via publish.
                    if not topic:
                        await _ws_send_json(
                            websocket,
                            {"method": "error", "id": frame_id, "error": "missing_topic"},
                        )
                        continue
                    reply_to = frame.get("reply_to") or data.get("reply_to")
                    payload_value = data.get("payload")
                    count = await bus.publish(
                        topic,
                        payload_value,
                        sender_id=connection_id,
                        reply_to=reply_to,
                    )
                    await _ws_send_json(
                        websocket,
                        {
                            "method": "ack",
                            "id": frame_id,
                            "topic": topic,
                            "delivered": count,
                        },
                    )

                else:
                    await _ws_send_json(
                        websocket,
                        {"method": "error", "id": frame_id, "error": "unknown_method", "method_received": method},
                    )

        except WebSocketDisconnect:
            pass
        except Exception:
            logger.exception("ws.handler_error conn=%s", connection_id)
        finally:
            for task in pumps.values():
                task.cancel()
            # Wait briefly so the iterator's `finally` cleanup runs.
            if pumps:
                await asyncio.gather(*pumps.values(), return_exceptions=True)
            await bus.unsubscribe_all(connection_id)
            logger.info("ws.disconnect conn=%s", connection_id)
