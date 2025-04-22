from typing import Optional, Dict, Any
import yaml
import os
import sys
from pydantic import model_validator, Field
from app.models.service import Service
from app.models.message import Message
from fastapi import WebSocket
from app.services.repo import Repo
from app.registry.in_memory_registry import InMemoryRegistry
from threading import Lock
from typing import ClassVar

class PyRobotLabXRuntime(Service):
    # Inherit arbitrary_types_allowed
    model_config = {"arbitrary_types_allowed": True}

    # Singleton control
    _instance: ClassVar[Optional["PyRobotLabXRuntime"]] = None
    _lock:     ClassVar[Lock]                            = Lock()

    # New fields specific to runtime
    config_dir:    str                    = "./config"
    config_name:   Optional[str]          = None
    data_dir:      str                    = "./data"
    debug:         bool                   = True
    processes:     Dict[str, Any]         = Field(default_factory=dict)
    hosts:         Dict[str, Any]         = Field(default_factory=dict)
    connections:   Dict[str, WebSocket]   = Field(default_factory=dict)
    types:         Dict[str, Any]         = Field(default_factory=dict)
    route_table:   Dict[str, Any]         = Field(default_factory=dict)
    default_route: Optional[Dict[str, Any]] = None
    repo_dir:      str                    = "./repo"
    repo:          Optional[Repo]         = None  # Now optional

    @classmethod
    def get_instance(cls, **kwargs) -> "PyRobotLabXRuntime":
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls(**kwargs)
            return cls._instance

    @model_validator(mode="before")
    def set_runtime_defaults(cls, values: Dict[str, Any]) -> Dict[str, Any]:
        name = values.get("name")
        if name:
            values.setdefault("config_name", f"{name}_runtime.yaml")
        repo_dir = values.get("repo_dir", "./repo")
        # Always set repo if not already set
        if "repo" not in values or values["repo"] is None:
            values["repo"] = Repo(repo_dir)
        return values

    def model_post_init(self, __context: Any) -> None:
        InMemoryRegistry.get_instance().register(self.fullname, self)


    @classmethod
    def get_instance(cls, *args, **kwargs):
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls(*args, **kwargs)
            return cls._instance

    # Registry-related methods
    def register_service(self, service: Service):
        InMemoryRegistry.get_instance().register(service.fullname, service)

    def release_service(self, name: str):
        InMemoryRegistry.get_instance().release(name)

    def get_service(self, name: str):
        return InMemoryRegistry.get_instance().get_service(name)

    def get_registry(self):
        return InMemoryRegistry.get_instance().get_registry()

    def get_service_names(self):
        return InMemoryRegistry.get_instance().get_service_names()

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
            "services": self.get_service_names(),
        }

    def save(self):
        config_path = os.path.join(self.config_dir, self.config_name)
        os.makedirs(os.path.dirname(config_path), exist_ok=True)
        with open(config_path, "w") as f:
            yaml.dump(self.config, f)

    async def handle_message(self, msg: Message, websocket: WebSocket, client_id: str):
        # Set gatewayId and gateway on the message
        msg.gatewayId = getattr(msg, 'gatewayId', None) or client_id
        msg.gateway = f"runtime@{self.get_id()}"

        # Dynamic Routing: add route if remoteId is different from this runtime
        from app.utils.codec_util import CodecUtil
        remote_id = CodecUtil.get_id(msg.sender)
        if remote_id and remote_id != self.get_id():
            self.add_route(remote_id, msg.gatewayId, msg.gateway)

        # --- Store.ts handleMessage logic ported ---
        # Record the message (simulate retained messages)
        remote_key = f"{msg.sender}.{msg.method}"
        if not hasattr(self, "messages"):
            self.messages = {}
        self.messages[remote_key] = msg

        # Determine fullName and msgId
        full_name = msg.name
        from app.utils.codec_util import CodecUtil
        msg_id = CodecUtil.get_id(full_name)

        # If message is not for this runtime, relay to remote gateway
        if msg_id != self.get_id():
            gateway = self.get_gateway(msg_id)
            if not gateway:
                self.error(f"NO GATEWAY for remoteId {msg_id}")
                return None
            # sendRemote should be implemented on gateway
            return gateway.send_remote(msg)

        # Local service invoke
        service = self.get_service(full_name)
        if not service:
            self.error(f"service {full_name} not found")
            return None
        # Use invoke_msg for message dispatch
        if hasattr(service, "invoke_msg"):
            return service.invoke_msg(msg)
        else:
            # fallback: call method directly if it exists
            if hasattr(service, msg.method):
                method = getattr(service, msg.method)
                if callable(method):
                    return method(*msg.data) if msg.data else method()
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
        self.info("Exiting PyRobotLabXRuntime")
        sys.exit(exit_code)

    def get_repo(self):
        return self.repo.get_repo()

    def get_service_package(self, service_name: str):
        return self.repo.get_service_package(service_name)

    def get_gateway(self, remote_id: str):
        """
        Get the gateway for a remote ID. If no route entry exists, use the default route.
        Mirrors RobotLabXRuntime.getGateway from Node.js.
        """
        entry = self.route_table.get(remote_id)
        if not entry and hasattr(self, 'default_route') and self.default_route:
            return self.get_service(self.default_route['gateway'])
        if entry:
            return self.get_service(entry['gateway'])
        return None

    def add_route(self, remote_id: str, gateway_id: str, gateway: str):
        """
        Add or update a route entry for a remote_id in the route_table.
        Mirrors the Node.js Store/RobotLabXRuntime dynamic routing logic.
        """
        self.route_table[remote_id] = {
            "gatewayId": gateway_id,
            "gateway": gateway
        }

    def register_process(self, process_data: dict) -> Optional[str]:
        """
        Register a process in the runtime. Expects a dict with at least 'id' and 'hostname'.
        Returns the process key if successful, else None.
        Mirrors RobotLabXRuntime.registerProcess.
        """
        pid = process_data.get('id')
        hostname = process_data.get('hostname')
        if pid and hostname:
            key = f"{pid}@{hostname}"
            self.processes[key] = process_data
            return key
        return None

    def register(self, service: dict[str, Any]):
        # Log registration
        self.info(f"==== registering service: {service.name}@{service.id} ====")
        key = f"{service.name}@{service.id}"
        existing_service = self.get_service(key)
        if existing_service is not None and self.id == service.id:
            self.info(f"service {service.name}@{service.id} already exists")
            return service
        self.register_service(service)
        self.invoke_msg(Message(self.fullname, "registered", [service]))
        self.invoke_msg(Message(self.fullname, "getRegistry", []))
        return service

    def send_remote(self, msg):
        """
        Sends a message to a remote process using the correct WebSocket connection.
        Mirrors RobotLabXRuntime.sendRemote.
        """
        from app.utils.codec_util import CodecUtil
        msg_id = CodecUtil.get_id(msg.name)
        gateway_route_id = self.get_route_id(msg_id) if hasattr(self, 'get_route_id') else msg_id
        ws = self.connections.get(gateway_route_id)
        if not ws:
            self.error(f"No websocket connection from runtime to remote, gateway should probably be handling this {gateway_route_id} for remoteId {msg_id}")
            return None
        try:
            import json
            json_msg = msg.json() if hasattr(msg, 'json') else json.dumps(msg)
            if hasattr(ws, 'send_text'):
                import asyncio
                if asyncio.iscoroutinefunction(ws.send_text):
                    asyncio.create_task(ws.send_text(json_msg))
                else:
                    ws.send_text(json_msg)
            else:
                self.error(f"WebSocket object does not support send_text for {gateway_route_id}")
        except Exception as e:
            self.error(f"Failed to send remote message: {e}")
        return None
