from typing import Optional, Dict, Any
import threading
import yaml
import os
from app.models.service import Service
from app.models.message import Message
from fastapi import WebSocket

class PyRobotLabXRuntime(Service):
    _instance = None
    _lock = threading.Lock()

    def __init__(self, id: str, name: str, type_key: str, version: str, hostname: str, config_dir: str = "./config"):
        super().__init__(id, name, type_key, version, hostname)
        self.config_dir = config_dir
        self.config_name = f"{name}_runtime.yaml"
        self.services: Dict[str, Service] = {}
        self.data_dir = "./data"
        self.debug = True
        self.processes: Dict[str, Any] = {}
        self.hosts: Dict[str, Any] = {}
        self.connections: Dict[str, WebSocket] = {}
        self.types: Dict[str, Any] = {}
        self.route_table: Dict[str, Any] = {}

    @classmethod
    def get_instance(cls, *args, **kwargs):
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls(*args, **kwargs)
            return cls._instance

    def to_json(self):
        return {
            **super().to_json(),
            "config_name": self.config_name,
            "data_dir": self.data_dir,
            "processes": self.processes,
            "hosts": self.hosts,
            "connections": list(self.connections.keys()),
            "route_table": self.route_table,
            "types": self.types,
        }

    def save(self):
        config_path = os.path.join(self.config_dir, self.config_name)
        os.makedirs(os.path.dirname(config_path), exist_ok=True)
        with open(config_path, "w") as f:
            yaml.dump(self.config, f)

    def add_service(self, service: Service):
        self.services[service.fullname] = service

    def get_service(self, name: str) -> Optional[Service]:
        return self.services.get(name)

    def remove_service(self, name: str):
        if name in self.services:
            del self.services[name]

    def apply_service_file_config(self, service_name: str):
        # Placeholder for loading service config from file
        pass

    def create_service(self, id: str, name: str, type_key: str, version: str, hostname: str) -> Service:
        service = Service(id, name, type_key, version, hostname)
        self.add_service(service)
        return service

    async def handle_websocket_message(self, msg: Message, websocket: WebSocket, client_id: str):
        # Handle and route messages from websocket clients
        # Implement core message types: addListener, getRegistry, registerProcess, getServiceNames, etc.
        if msg.method == "addListener":
            # Register for updates on a method for a given service
            service = self.get_service(msg.name)
            if service:
                service.add_listener(msg.data[0], msg.sender, msg.data[1] if len(msg.data) > 1 else msg.data[0])
            return {"status": "listener added"}
        elif msg.method == "registerProcess":
            # Register a new process
            self.processes[msg.sender] = msg.data[0] if msg.data else {}
            return {"status": "process registered"}
        elif msg.method == "getRegistry":
            # Return the registry of services
            return {"registry": list(self.services.keys())}
        elif msg.method == "getServiceNames":
            # Return the list of service names
            return {"serviceNames": list(self.services.keys())}
        elif msg.method == "broadcastState":
            # Broadcast state to all clients
            await self.broadcast_state()
            return {"status": "state broadcasted"}
        else:
            # Try to invoke the method on the target service
            service = self.get_service(msg.name)
            if service and hasattr(service, msg.method):
                method = getattr(service, msg.method)
                if callable(method):
                    result = method(*msg.data) if msg.data else method()
                    return {"result": result}
            return {"error": f"Unknown method: {msg.method}"}

    async def broadcast_state(self):
        # Broadcast the runtime state to all connected clients
        import json
        state = self.to_json()
        for ws in self.connections.values():
            await ws.send_text(json.dumps({"type": "broadcastState", "data": state}))

    async def on_disconnect(self, client_id: str):
        # Cleanup on disconnect
        if client_id in self.connections:
            del self.connections[client_id]
