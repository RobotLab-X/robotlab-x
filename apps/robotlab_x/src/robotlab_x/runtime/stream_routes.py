# unmanaged
"""HTTP + WS routes for the stream media plane.

Three endpoints:
  * ``GET  /v1/stream``                — admin: list every registered stream
  * ``GET  /v1/stream/{id}/mjpeg``     — consumer: multipart/x-mixed-replace
                                          stream of JPEG frames. Auth via
                                          query-param ``?token=`` because
                                          ``<img src>`` can't set headers.
  * ``WS   /v1/stream/{id}/upload``    — producer: binary frame uploads from
                                          a subprocess service. Same JWT as
                                          /v1/ws; subprocess token works.

The discovery topic ``/stream/index/<id>`` lives on the bus — producers
publish it (retained) so consumers don't have to poll this list endpoint.

Why MJPEG over the more efficient HLS / WebRTC for Phase 1: it's a single
HTTP response with no JS, no WebRTC stack, no per-segment muxing. Trades
~300ms of latency for "it just works in an <img> tag." WebRTC is Phase 2
when latency matters.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, AsyncGenerator, Dict, List, Optional

import jwt
from fastapi import Depends, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from fastapi.routing import APIRouter

from robotlab_x.api.crud_router_factory import auth_deps
from robotlab_x.runtime.streams import StreamMetadata, get_registry


logger = logging.getLogger(__name__)


# Mirror ws_endpoint._decode_token — same env var, same algorithm. Kept
# local instead of imported because we apply it to query params on a
# regular HTTP response, not a WebSocket.
def _jwt_secret() -> str:
    return os.environ.get("JWT_SECRET_KEY", "fallback_dev_key")


def _decode_query_token(token: Optional[str]) -> Dict[str, Any]:
    """Decode ``?token=`` for HTTP routes. Raises 401/403 on failure.

    Used by binary endpoints that ``<img>`` / EventSource style consumers
    can't add Authorization headers to. The token must verify under the
    same JWT_SECRET_KEY as the rest of the auth surface.
    """
    if not token:
        raise HTTPException(status_code=401, detail="missing token")
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        logger.info("stream.http_auth_rejected reason=%s", exc.__class__.__name__)
        raise HTTPException(status_code=403, detail="bad token")
    user = payload.get("user") or {}
    roles = user.get("roles") or []
    # Subprocess tokens carry sub="subprocess" with Admin role; user
    # tokens carry the real user. We only need ANY authenticated role —
    # admins, members, subprocesses. Anything authenticated can view a
    # stream they know the id of.
    if not roles and payload.get("sub") != "subprocess":
        raise HTTPException(status_code=403, detail="no roles")
    return payload


# Multipart boundary used between MJPEG frames. Browsers parse the
# boundary string from the Content-Type header; any unique-ish token
# works. ``--frame`` is the conventional one and what Chrome/Firefox
# DevTools display nicely.
_MJPEG_BOUNDARY = "frame"
_MJPEG_CONTENT_TYPE = f"multipart/x-mixed-replace; boundary={_MJPEG_BOUNDARY}"


async def _mjpeg_generator(stream_id: str) -> AsyncGenerator[bytes, None]:
    """Yield multipart-encoded MJPEG parts for one consumer.

    Sends the latest frame immediately on connect (so the <img> populates
    without waiting up to 1/fps for the next push), then blocks on the
    stream's condvar for each subsequent frame. On producer stale we
    yield no bytes — the consumer's TCP read just hangs until either a
    new frame arrives or the consumer closes the socket.

    Backpressure: if the consumer's TCP send buffer fills, our awaits on
    the condvar still wake on each new frame, but ``yield`` blocks until
    the buffer drains. The producer is unaffected — only our own
    coroutine queues. That's the right behaviour: one slow consumer
    doesn't slow the producer or other consumers.
    """
    registry = get_registry()
    state = registry.get(stream_id)
    if state is None:
        # Stream doesn't exist (yet). Yield nothing — the response will
        # close cleanly with an empty body.
        return

    state.add_consumer()
    try:
        last_seq = 0
        # 1. Send the most recent frame immediately if we have one.
        snapshot = state.latest_frame()
        if snapshot is not None:
            frame, seq = snapshot
            last_seq = seq
            yield _encode_mjpeg_part(frame)

        # 2. Loop waiting for new frames, with timeout-based keep-alive
        # so a dead producer surfaces as a dead stream rather than a
        # silently-stuck connection.
        while True:
            result = await state.wait_for_frame(last_seq, timeout_s=5.0)
            if result is None:
                # No new frame in 5s — check whether the stream is dead.
                # If yes, exit; consumer will reconnect. If the producer's
                # still alive (just idle), keep waiting.
                if state.is_stale():
                    return
                continue
            frame, seq = result
            last_seq = seq
            yield _encode_mjpeg_part(frame)
    except asyncio.CancelledError:
        # Consumer disconnected (client closed the connection). The
        # cancellation comes from FastAPI/uvicorn's response framework.
        raise
    finally:
        state.remove_consumer()


def _encode_mjpeg_part(frame: bytes) -> bytes:
    """Wrap a JPEG payload in the multipart envelope. Headers
    intentionally minimal — Content-Type + Content-Length is the
    well-known shape and is what every browser MJPEG decoder expects."""
    return (
        f"--{_MJPEG_BOUNDARY}\r\n"
        f"Content-Type: image/jpeg\r\n"
        f"Content-Length: {len(frame)}\r\n"
        f"\r\n"
    ).encode("ascii") + frame + b"\r\n"


# ─── route registration ───────────────────────────────────────────────


def register_stream_routes(app: FastAPI) -> None:
    """Attach the /v1/stream HTTP routes + the producer-side upload WS.

    Called from robotlab_x.yml ``api.extend`` alongside register_ws_routes.
    """
    router = APIRouter()
    require_admin = Depends(auth_deps.require_role(["Admin"]))

    @router.get(
        "/v1/stream",
        dependencies=[require_admin],
        summary="List all registered streams",
    )
    def list_streams() -> Dict[str, List[Dict[str, Any]]]:
        return {"streams": get_registry().list_all()}

    @router.get(
        "/v1/stream/{stream_id:path}/mjpeg",
        summary="Multipart MJPEG stream",
    )
    def mjpeg_stream(stream_id: str, token: Optional[str] = Query(default=None)):
        # Auth via ?token= — <img src> tags can't set Authorization.
        # Any authenticated principal can subscribe to a stream they
        # know the id of; access-control on which streams exist is
        # already gated by the bus topic discovery (which is admin-only).
        _decode_query_token(token)
        if get_registry().get(stream_id) is None:
            raise HTTPException(status_code=404, detail=f"stream {stream_id!r} not registered")
        return StreamingResponse(
            _mjpeg_generator(stream_id),
            media_type=_MJPEG_CONTENT_TYPE,
            # Standard cache-busting for "this is a live stream" — without
            # these proxies + the browser might cache the first multipart
            # response chunk and replay it.
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Connection": "close",
            },
        )

    @app.websocket("/v1/stream/{stream_id:path}/upload")
    async def stream_upload(websocket: WebSocket, stream_id: str) -> None:
        """Producer-side WS for pushing binary frames into a stream.

        Wire protocol:
          1. Producer connects with ``?token=<subprocess_jwt>``.
          2. Producer sends a single TEXT frame: JSON metadata describing
             the stream (kinds, resolution, fps, format, producer_id).
             This registers the stream + makes it discoverable.
          3. Producer sends BINARY frames — each one is a complete JPEG.
             Latest-wins; we don't buffer history.
          4. Disconnect (clean or otherwise) leaves the StreamState in
             the registry but flagged stale after 10s with no frames.
             Re-connect re-registers + resumes pushing.

        The metadata-then-frames split keeps the registry sync code out
        of the per-frame hot path. Subsequent metadata-only updates can
        come as TEXT frames between BINARY ones if the producer's
        resolution/fps changes.
        """
        token = websocket.query_params.get("token")
        try:
            _decode_query_token(token)
        except HTTPException as exc:
            # WS close codes mirror ws_endpoint's: 4401 for missing,
            # 4403 for bad. Producer reconnect logic handles both as
            # "go fetch a fresh token".
            close_code = 4401 if exc.status_code == 401 else 4403
            await websocket.close(code=close_code, reason=exc.detail)
            return

        await websocket.accept()
        registry = get_registry()
        stream_state = None

        try:
            # First frame MUST be the metadata text frame.
            try:
                first = await asyncio.wait_for(websocket.receive_text(), timeout=10.0)
            except asyncio.TimeoutError:
                await websocket.close(code=4400, reason="metadata timeout")
                return
            try:
                meta_dict = json.loads(first)
            except json.JSONDecodeError:
                await websocket.close(code=4400, reason="metadata not json")
                return

            metadata = StreamMetadata(
                stream_id=stream_id,
                producer_id=meta_dict.get("producer_id"),
                kinds=list(meta_dict.get("kinds") or ["mjpeg"]),
                format=meta_dict.get("format"),
                resolution=meta_dict.get("resolution"),
                fps=meta_dict.get("fps"),
            )
            stream_state = await registry.register(metadata)
            logger.info("stream.upload connected id=%s producer=%s",
                        stream_id, metadata.producer_id)

            # Frame loop: binary frames are JPEG bytes, text frames
            # update metadata mid-stream.
            while True:
                msg = await websocket.receive()
                # Starlette's WebSocket.receive() returns a discriminated
                # dict — type is "websocket.receive" with either text or
                # bytes set, or "websocket.disconnect" on close.
                if msg.get("type") == "websocket.disconnect":
                    return
                payload_bytes = msg.get("bytes")
                payload_text = msg.get("text")
                if payload_bytes:
                    await stream_state.set_frame(payload_bytes)
                elif payload_text:
                    # Metadata update — best-effort merge.
                    try:
                        update = json.loads(payload_text)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(update, dict):
                        merged = StreamMetadata(
                            stream_id=stream_id,
                            producer_id=update.get("producer_id") or metadata.producer_id,
                            kinds=list(update.get("kinds") or metadata.kinds),
                            format=update.get("format") or metadata.format,
                            resolution=update.get("resolution") or metadata.resolution,
                            fps=update.get("fps") or metadata.fps,
                        )
                        await registry.register(merged)
                        metadata = merged

        except WebSocketDisconnect:
            pass
        except Exception:  # noqa: BLE001
            logger.exception("stream.upload error id=%s", stream_id)
        finally:
            # Leave the registry entry behind so consumers see a stale
            # stream instead of an outright 404 if the producer
            # reconnects quickly. The stale flag flips after _STALE_AFTER_S
            # of no frames.
            if stream_state is not None:
                logger.info("stream.upload disconnected id=%s", stream_id)

    app.include_router(router)
