from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.services.websocket_manager import WebSocketManager

router = APIRouter()

manager = WebSocketManager()

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            await manager.broadcast(f"Client says: {data}")
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# TODO build all routes dynamically

@router.get("/api/v1/services/runtime/getId")
async def get_runtime_id():
    # Replace with logic to generate or retrieve runtime ID
    runtime_id = "runtime-12345"
    return {"runtime_id": runtime_id}
