from fastapi import FastAPI
from app.routers import websocket

app = FastAPI()

# Include WebSocket router
app.include_router(websocket.router)

@app.get("/")
async def root():
    return {"message": "Welcome to the Python Server with WebSocket support!"}
