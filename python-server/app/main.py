from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import websocket
import uvicorn
from app.services.py_robotlabx_runtime import PyRobotLabXRuntime

app = FastAPI()

# Allow all origins, methods, and headers for development (adjust for production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include WebSocket router
app.include_router(websocket.router)

@app.get("/")
async def root():
    return {"message": "Welcome to the Python Server with WebSocket support!"}

def start_runtime():
    # Initialize the singleton runtime instance
    runtime = PyRobotLabXRuntime.get_instance(
        id="runtime1",
        name="runtime",
        type_key="runtime",
        version="1.0.0",
        hostname="localhost"
    )
    # runtime.register(runtime.to_dict())
    # runtime.register_service(runtime)
    return runtime

# Ensure runtime is started at module load (for dependency injection and endpoint access)
runtime = start_runtime()

@app.on_event("startup")
async def on_startup():
    # Any async startup logic if needed
    pass

def main():
    uvicorn.run("app.main:app", host="127.0.0.1", port=3001, reload=True)

if __name__ == "__main__":
    main()
