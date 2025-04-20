from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.services.websocket_manager import WebSocketManager
from app.models.message import Message
from app.services.py_robotlabx_runtime import PyRobotLabXRuntime
import inspect

router = APIRouter()

manager = WebSocketManager()

@router.websocket("/api/messages")
async def websocket_endpoint(websocket: WebSocket, id: str):
    await manager.connect(websocket)
    runtime = PyRobotLabXRuntime.get_instance()
    runtime.connections[id] = websocket
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = Message.parse_raw(data)
            except Exception as e:
                await websocket.send_text(f"{{'error': 'Invalid message format: {str(e)}'}}")
                continue
            # Route message to runtime for handling
            result = runtime.handle_message(msg, websocket, id)
            if inspect.iscoroutine(result):
                await result
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        del runtime.connections[id]
        await runtime.on_disconnect(id)

@router.get("/api/v1/services/runtime/getId")
async def get_runtime_id():
    runtime = PyRobotLabXRuntime.get_instance()
    # return {"runtime_id": runtime.id}
    return runtime.id
