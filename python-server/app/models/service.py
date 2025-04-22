from typing import Optional, Dict, List, Any
from pydantic import BaseModel, model_validator, Field
import os
import logging
from .message import Message
from utils.lang_util import convert_to_snake

logger = logging.getLogger("Service")

# Placeholder for SubscriptionListener, Status, InstallStatus, Package, etc.
class SubscriptionListener:
    def __init__(self, method: str, callback_name: str, callback_method: str):
        self.method = method
        self.callbackName = callback_name
        self.callbackMethod = callback_method

class Status:
    def __init__(self, level: str, detail: str, name: Optional[str] = None):
        self.level = level
        self.detail = detail
        self.name = name

class InstallStatus:
    def __init__(self, status: str, detail: str):
        self.status = status
        self.detail = detail

class Service(BaseModel):
    # allow arbitrary types if needed
    model_config = {"arbitrary_types_allowed": True}

    # Field declarations
    id:            Optional[str]        = None
    name:          Optional[str]        = None
    type_key:      Optional[str]        = None
    version:       Optional[str]        = None
    hostname:      Optional[str]        = None
    public_root:   Optional[str]        = None
    start_time:    Optional[float]      = None

    fullname:      Optional[str]        = None
    data_path:     Optional[str]        = None
    notify_list:   Dict[str, List[Any]] = Field(default_factory=dict)
    pkg:           Optional[Any]        = None
    config:        Dict[str, Any]       = Field(default_factory=dict)
    ready:         bool                 = False
    installed:     bool                 = False

    @model_validator(mode="before")
    def build_derived(cls, values: Dict[str, Any]) -> Dict[str, Any]:
        name = values.get("name")
        _id = values.get("id")
        if name and _id:
            values.setdefault("fullname", f"{name}@{_id}")
        public_root = values.get("public_root")
        if public_root and name:
            values.setdefault(
                "data_path",
                os.path.join(public_root, f"service/{name}")
            )
        return values

    def get_subscribers_for_method(self, method: str) -> List[str]:
        listeners = self.notify_list.get(method, [])
        ret = [listener.callbackName for listener in listeners]
        logger.error(f"getSubscribersForMethod {method} {ret}")
        return []

    def send_to(self, name: str, method: str, data: List[Any]):
        logger.info(f"sendTo {name} {method} {data}")
        msg = Message(name=name, method=method, data=data)
        msg.sender = self.fullname
        self.invoke_msg(msg)

    def create_message(self, in_name: str, in_method: str, in_params: List[Any]):
        id_ = self.get_id()
        msg = Message(name=in_name, method=in_method, data=in_params)
        msg.sender = f"runtime@{id_}"
        return msg

    def subscribe_to(self, name: str, method: str):
        logger.info(f"subscribeTo {name} {method}")
        # Placeholder: actual implementation would add to notify_list

    def add_listener(self, method: str, remote_name: str, remote_method: str = None):
        """
        Add a listener to the notify_list for a given method.
        remote_name will be ensured to be a fullname (e.g. name@id).
        remote_method will default to the callback topic name if not provided.
        Mirrors Service.addListener from TypeScript.
        """
        from app.utils.codec_util import CodecUtil
        # Ensure remote_name is a fullname
        if '@' not in remote_name:
            remote_name = CodecUtil.get_full_name(remote_name)
        # Set remote_method to callback topic if not provided
        if not remote_method:
            remote_method = CodecUtil.get_callback_topic_name(method)
        if not hasattr(self, 'notify_list') or self.notify_list is None:
            self.notify_list = {}
        if method not in self.notify_list:
            self.notify_list[method] = []
        # Add or update listener entry
        listener_entry = type('Listener', (), {})()
        listener_entry.callbackName = remote_name
        listener_entry.callbackMethod = remote_method
        self.notify_list[method].append(listener_entry)

    def broadcast_state(self):
        return self

    def get_config(self) -> dict:
        return self.config

    def apply_config(self, config: dict):
        logger.info(f"applyConfig {self.name} {config}")
        self.config = config

    def apply_config_value(self, key: str, value: Any):
        self.config[key] = value
        self.invoke("broadcast_state")

    def apply_file_config(self, filename: Optional[str] = None):
        # Placeholder for RobotLabXRuntime logic
        self.invoke("broadcast_state")

    def save_config(self):
        # Placeholder for RobotLabXRuntime logic
        pass

    def get_notify_list(self):
        return self.notify_list

    def get_hostname(self) -> Optional[str]:
        return self.hostname

    def get_id(self):
        return self.id

    def get_methods(self, filters: Optional[List[str]] = None) -> List[str]:
        method_names = [func for func in dir(self)
                        if callable(getattr(self, func)) and not func.startswith("__") and func != "__init__"]
        if filters:
            method_names = [name for name in method_names if any(name.startswith(f) for f in filters)]
        return sorted(method_names)

    def get_name(self):
        return self.name

    def get_uptime(self) -> str:
        import time
        if not self.start_time:
            return "service not started"
        uptime = time.time() - self.start_time
        return f"uptime: {uptime} seconds"

    def invoke(self, method_name: str, *args: Any) -> Any:
        msg = Message(name=self.name, method=method_name, data=list(args))
        msg.sender = self.fullname
        return self.invoke_msg(msg)

    def invoke_msg(self, msg: Message) -> Any:
        """
        Invokes the method on this service as described by msg.method, passing in msg.data as arguments.
        Handles local, remote, and subscription notification logic. Mirrors Service.ts invokeMsg.
        """
        ret = None
        try:
            # Determine fullName and id for this service and message
            my_fullname = getattr(self, "fullname", None)
            my_id = getattr(self, "id", None)
            msg_fullname = getattr(msg, "name", None)
            msg_id = None
            if msg_fullname and "@" in msg_fullname:
                msg_id = msg_fullname.split("@")[-1]

            # REMOTE MESSAGE HANDLING
            # If the message is not for this process, forward it to the correct gateway
            if msg_id and msg_id != my_id:
                from services.py_robotlabx_runtime import PyRobotLabXRuntime
                runtime = PyRobotLabXRuntime.get_instance()
                gateway = None
                if hasattr(runtime, "get_gateway"):
                    gateway = runtime.get_gateway(msg_id)
                else:
                    # fallback: try to get the connection directly
                    gateway = runtime.connections.get(msg_id)
                if not gateway:
                    logger.error(f"NO GATEWAY for remoteId {msg_id}")
                    return None
                if hasattr(gateway, "send_remote"):
                    return gateway.send_remote(msg)
                elif hasattr(gateway, "send"):
                    return gateway.send(msg)
                else:
                    logger.error(f"Gateway for {msg_id} does not support send_remote/send")
                    return None

            # LOCAL MESSAGE HANDLING
            method_name = convert_to_snake(msg.method)
            if hasattr(self, method_name):
                method = getattr(self, method_name)
                args = msg.data if hasattr(msg, 'data') and msg.data else []
                try:
                    ret = method(*args)
                except Exception as e:
                    self.error(f"failed to invoke {self.name}.{msg.method} because {e}")
            else:
                self.error(f"Method {method_name} not found on {self.name}")

            # Notify listeners if any
            if hasattr(self, 'notify_list') and self.notify_list and msg.method in self.notify_list:
                for listener in self.notify_list[msg.method]:
                    from app.models.message import Message
                    sub_msg = Message()
                    sub_msg.name = listener.callbackName
                    sub_msg.method = listener.callbackMethod
                    sub_msg.data = [ret]
                    sub_msg.sender = getattr(self, 'fullname', None)
                    self.invoke_msg(sub_msg)
            return ret
        except Exception as e:
            logger.error(f"general catch failed to invoke {self.name}.{msg.method} because {e}")
            return None

    def is_ready(self) -> bool:
        return self.ready

    def publish_stdout(self, msg: str) -> str:
        logger.info(f"stdout: {msg}")
        return msg

    def release_service(self):
        logger.info(f"========= released service {self.get_name()} ===========")
        # Placeholder for RobotLabXRuntime.release

    def remove_listener(self, method: str, remote_name: str, remote_method: str):
        if not self.notify_list or method not in self.notify_list:
            return
        listeners = self.notify_list[method]
        self.notify_list[method] = [l for l in listeners if not (l.callbackName == remote_name and l.callbackMethod == remote_method)]

    def publish_status(self, status: Status):
        if status.level == "error":
            logger.error(status.detail)
        elif status.level == "warn":
            logger.warning(status.detail)
        else:
            logger.info(status.detail)
        return status

    def publish_install_status(self, status: InstallStatus):
        return status

    def start_service(self):
        import time
        self.start_time = time.time()
        self.ready = True
        logger.info(f"========= started service {self.name} ===========")

    def stop_service(self):
        self.start_time = None
        self.ready = False
        logger.info(f"========= stopped service {self.name} ===========")

    def info(self, msg: Optional[str]):
        logger.info(msg)
        self.invoke("publish_status", Status("info", msg or "", self.name))

    def warn(self, msg: Optional[str]):
        logger.warning(msg)
        self.invoke("publish_status", Status("warn", msg or "", self.name))

    def error(self, msg: Optional[str]):
        logger.error(msg)
        self.invoke("publish_status", Status("error", msg or "", self.name))

    def send_remote(self, msg: Message):
        from services.py_robotlabx_runtime import PyRobotLabXRuntime
        PyRobotLabXRuntime.get_instance().send_remote(msg)

    def set_installed(self, installed: bool):
        self.installed = installed

    def save(self):
        self.save_config()

    def to_json(self):
        return {
            "config": getattr(self, "config", {}),
            "fullname": getattr(self, "fullname", None),
            "hostname": getattr(self, "hostname", None),
            "id": getattr(self, "id", None),
            "installed": getattr(self, "installed", False),
            "name": getattr(self, "name", None),
            "notifyList": getattr(self, "notify_list", {}),
            "pkg": getattr(self, "pkg", None),
            "ready": getattr(self, "ready", False),
            "typeKey": getattr(self, "type_key", None),
            "version": getattr(self, "version", None),
            "startTime": getattr(self, "start_time", None)
        }

    def __json__(self):
        return self.to_json()

    def __repr__(self):
        return str(self.to_json())
