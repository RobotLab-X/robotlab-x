from typing import Optional, Dict, Any
import threading
import yaml
import os
import sys
from app.models.service import Service
from app.models.message import Message
from fastapi import WebSocket
from app.services.repo import Repo

class PyRobotLabXRuntime(Service):
    _instance = None
    _lock = threading.Lock()

    def __init__(self, id: str, name: str, type_key: str, version: str, hostname: str, config_dir: str = "./config", repo_dir: str = "./repo"):
        super().__init__(id, name, type_key, version, hostname)
        self.config_dir = config_dir
        self.config_name = f"{name}_runtime.yaml"
        self.services: Dict[str, Service] = {}  # Registry of running services
        self.data_dir = "./data"
        self.debug = True
        self.processes: Dict[str, Any] = {}
        self.hosts: Dict[str, Any] = {}
        self.connections: Dict[str, WebSocket] = {}
        self.types: Dict[str, Any] = {}
        self.route_table: Dict[str, Any] = {}
        self.repo = Repo(repo_dir)

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
            "services": list(self.services.keys()),
        }

    def save(self):
        config_path = os.path.join(self.config_dir, self.config_name)
        os.makedirs(os.path.dirname(config_path), exist_ok=True)
        with open(config_path, "w") as f:
            yaml.dump(self.config, f)

    # Service registry management
    def add_service(self, service: Service):
        self.services[service.fullname] = service

    def get_service(self, name: str) -> Optional[Service]:
        return self.services.get(name)

    def remove_service(self, name: str):
        if name in self.services:
            service = self.services[name]
            service.release_service()
            del self.services[name]

    def create_service(self, id: str, name: str, type_key: str, version: str, hostname: str) -> Service:
        service = Service(id, name, type_key, version, hostname)
        self.add_service(service)
        return service

    def start_service(self, name: str):
        service = self.get_service(name)
        if service:
            service.start_service()
            return True
        return False

    def release_service(self, name: str):
        self.remove_service(name)

    def register_service(self, id: str, name: str, type_key: str, version: str, hostname: str) -> Service:
        # Register (create and start) a new service
        service = self.create_service(id, name, type_key, version, hostname)
        service.start_service()
        return service

    async def handle_websocket_message(self, msg: Message, websocket: WebSocket, client_id: str):
        if msg.method == "addListener":
            service = self.get_service(msg.name)
            if service:
                service.add_listener(msg.data[0], msg.sender, msg.data[1] if len(msg.data) > 1 else msg.data[0])
            return {"status": "listener added"}
        elif msg.method == "register":
            # Ported logic: expects msg.data[0] to be a dict with service fields, or a Service instance
            service_data = msg.data[0] if isinstance(msg.data, list) and msg.data else msg.data
            if isinstance(service_data, dict):
                # Extract fields
                id = service_data.get("id")
                name = service_data.get("name")
                type_key = service_data.get("type_key") or service_data.get("typeKey")
                version = service_data.get("version")
                hostname = service_data.get("hostname")
                if id and name and type_key and version and hostname:
                    if self.get_service(f"{name}@{id}"):
                        # Already exists
                        return {"status": "service already registered", "service": self.get_service(f"{name}@{id}").to_json()}
                    service = Service(id, name, type_key, version, hostname)
                    self.add_service(service)
                    # Optionally start service
                    service.start_service()
                    # Notify listeners (simulate invoke("registered", service))
                    # In TS: this.invoke("registered", service)
                    # In TS: this.invoke("getRegistry")
                    return {"status": "service registered", "service": service.to_json()}
                else:
                    return {"error": "Missing required service fields for register"}
            else:
                return {"error": "register expects a dict with service fields as data[0]"}
        elif msg.method == "registerProcess":
            # Expects a dict representing process data in msg.data[0]
            process_data = msg.data[0] if isinstance(msg.data, list) and msg.data else msg.data
            if isinstance(process_data, dict):
                pid = process_data.get("id")
                hostname = process_data.get("hostname")
                if pid and hostname:
                    key = f"{pid}@{hostname}"
                    self.processes[key] = process_data
                    return {"status": f"process {key} registered", "process": process_data}
                else:
                    return {"error": "Missing id or hostname in process data for registerProcess"}
            else:
                return {"error": "registerProcess expects a dict with process fields as data[0]"}

        elif msg.method == "releaseService":
            if msg.name:
                self.release_service(msg.name)
                return {"status": f"service {msg.name} released"}
            else:
                return {"error": "No service name provided"}
        elif msg.method == "startService":
            if msg.name:
                started = self.start_service(msg.name)
                return {"status": f"service {msg.name} started" if started else f"service {msg.name} not found"}
            else:
                return {"error": "No service name provided"}
        elif msg.method == "getRegistry":
            return {"registry": list(self.services.keys())}
        elif msg.method == "getServiceNames":
            return {"serviceNames": list(self.services.keys())}
        elif msg.method == "broadcastState":
            await self.broadcast_state()
            return {"status": "state broadcasted"}
        elif msg.method == "getRepo":
            repo_data = self.get_repo()
            listeners = []
            if hasattr(self, 'notify_list') and self.notify_list.get('getRepo'):
                listeners = self.notify_list['getRepo']
            for listener in listeners:
                remote_name = listener.callbackName
                ws = self.connections.get(remote_name)
                if ws:
                    msg_out = {
                        "msgId": None,
                        "type": None,
                        "gatewayId": None,
                        "gateway": None,
                        "name": remote_name,
                        "method": "onRepo",
                        "sender": self.fullname,
                        "data": [repo_data]  # always an array
                    }
                    import json
                    await ws.send_text(json.dumps(msg_out))
            return None
        elif msg.method == "getServicePackage":
            if msg.name:
                pkg = self.get_service_package(msg.name)
                if pkg:
                    return {"package": pkg}
                else:
                    return {"error": f"No package.yml found for {msg.name}"}
            else:
                return {"error": "No service name provided"}
        else:
            service = self.get_service(msg.name)
            if service and hasattr(service, msg.method):
                method = getattr(service, msg.method)
                if callable(method):
                    result = method(*msg.data) if msg.data else method()
                    return {"result": result}
            return {"error": f"Unknown method: {msg.method}"}

    async def broadcast_state(self):
        import json
        state = self.to_json()
        listeners = []
        if hasattr(self, 'notify_list') and self.notify_list.get('broadcastState'):
            listeners = self.notify_list['broadcastState']
        for listener in listeners:
            remote_name = listener.callbackName
            ws = self.connections.get(remote_name)
            if ws:
                msg = {
                    "msgId": None,
                    "type": None,
                    "gatewayId": None,
                    "gateway": None,
                    "name": remote_name,
                    "method": "onBroadcastState",
                    "sender": self.fullname,
                    "data": [state]
                }
                await ws.send_text(json.dumps(msg))
        for ws in self.connections.values():
            await ws.send_text(json.dumps({"type": "broadcastState", "data": [state]}))
        return {"status": "state broadcasted"}

    async def on_disconnect(self, client_id: str):
        if client_id in self.connections:
            del self.connections[client_id]

    def get_client_keys(self):
        """Return a list of client IDs currently connected via WebSocket."""
        return list(self.connections.keys())

    def exit(self, exit_code: int = 0):
        """Exit the Python process with the given exit code."""
        print("Exiting PyRobotLabXRuntime")
        sys.exit(exit_code)

    def get_repo(self):
        return self.repo.get_repo()

    def get_service_package(self, service_name: str):
        return self.repo.get_service_package(service_name)
