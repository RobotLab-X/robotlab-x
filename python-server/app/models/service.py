from typing import Optional, Dict, List, Any, Callable
import os
import logging
from .message import Message

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

class Service:
    def __init__(
        self,
        id: str,
        name: str,
        type_key: str,
        version: str,
        hostname: Optional[str] = None,
        public_root: Optional[str] = None
    ):
        self.start_time: Optional[float] = None
        self.id: Optional[str] = id
        self.name: Optional[str] = name
        self.type_key: Optional[str] = type_key
        self.version: Optional[str] = version
        self.hostname: Optional[str] = hostname
        self.fullname: Optional[str] = f"{self.name}@{self.id}" if self.name and self.id else None
        self.data_path: Optional[str] = os.path.join(public_root, f"service/{self.name}") if public_root else None
        self.notify_list: Dict[str, List[SubscriptionListener]] = {}
        self.pkg: Optional[Any] = None
        self.ready: bool = False
        self.installed: bool = False
        self.config: dict = {}

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
        # Placeholder: implement routing and invocation logic as needed
        logger.debug(f"invoke_msg called with: {msg}")
        from app.utils.lang_util import convert_to_snake

        method_name = convert_to_snake(msg.method)

        # Simulate local method invocation
        if hasattr(self, method_name):
            method = getattr(self, method_name)
            if callable(method):
                try:
                    return method(*msg.data) if msg.data else method()
                except Exception as e:
                    logger.error(f"failed to invoke {self.name}.{method_name} because {e}")
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
        # Placeholder for RobotLabXRuntime.sendRemote
        pass

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
