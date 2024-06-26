import os
import yaml
import importlib
import argparse
import traceback
import asyncio
from typing import List
import json
import websockets
import sys
import time
import requests
import logging
from enum import Enum, auto
from rlx_pkg_proxy.codecutil import CodecUtil
from rlx_pkg_proxy.message import Message
from pathlib import Path

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("Service")


class SubscriptionListener:
    topicMethod: str = None
    callbackName: str = None
    callbackMethod: str = None

    def __init__(
        self,
        topicMethod: str = None,
        callbackName: str = None,
        callbackMethod: str = None,
    ):
        self.topicMethod = topicMethod
        self.callbackName = callbackName
        self.callbackMethod = callbackMethod

    def to_dict(self):
        return {
            "callbackMethod": self.callbackMethod,
            "callbackName": self.callbackName,
            "topicMethod": self.topicMethod,
        }


class State(Enum):
    READY = auto()
    SHUTDOWN = auto()
    # RECONNECTING = auto()


class Service:
    """WebSocket client that connects to a WebSocket server and sends/receives messages.

    Args:
        client_id (str): The client ID to use when connecting to the WebSocket server.
    """

    def __init__(self, client_id):
        log.info("WebSocket client ID: %s", client_id)
        self.name = client_id
        self.id = client_id
        self.fullname = f"{self.name}@{self.id}"
        self.client_id = client_id
        self.websocket = None
        self.startTime = None
        self.stop_event = asyncio.Event()
        self.state = State.READY
        # "local" RLX runtime service which started this process
        self.remote_id = None
        self.loop = asyncio.get_event_loop()
        # integration point for service
        self.service = None
        self.notifyList = {}
        self.ready = True
        self.confg = None
        # needed when json definition of proxy switches to this service
        self.installed: bool = True
        self.config: any = None

        CodecUtil.id = self.client_id

    def get_remote_id(self, base_url):
        try:
            url = f"{base_url}/api/v1/services/runtime/getId"
            response = requests.get(url)
            if response.status_code == 200:
                self.remote_id = json.loads(response.text.strip())
                log.info(f"Remote ID: {self.remote_id}")
            else:
                log.info(
                    f"Failed to get remote ID, status code: {response.status_code}"
                )
        except requests.RequestException as e:
            log.info(f"Failed to get remote ID: {e}")

    def connect(self, url):
        try:
            self.url = url
            # Try to get remote ID before connecting
            self.get_remote_id(self.url)
            websocket_url = (
                f"ws://{self.url.split('//')[1]}/api/messages?id={self.client_id}"
            )
            log.info(f"Connecting to WebSocket server at: {websocket_url}")
            self.loop.run_until_complete(self._connect(websocket_url))
        except Exception as e:
            log.info(f"Could not connect: {e}")

    async def _connect(self, websocket_url):
        self.websocket = await websockets.connect(websocket_url)

    def send_message(self, message):
        asyncio.run_coroutine_threadsafe(self._send_message(message), self.loop)

    async def _send_message(self, message):
        try:
            # FOR WORKY-NESS required to add sender info
            message["sender"] = f"{self.client_id}@{self.client_id}"
            log.info(
                f"<-- {message.get('name')} {message.get('method')} <-- @{self.client_id}{message.get('data')}"
            )
            json_data = json.dumps(message)
            await self.websocket.send(json_data)
        except websockets.exceptions.ConnectionClosedError as e:
            log.info(f"Connection closed: {e}")

    def subscribe(self, fullname, method_name):
        asyncio.run_coroutine_threadsafe(
            self._subscribe(fullname, method_name), self.loop
        )

    async def _subscribe(self, fullname, method_name):
        try:
            message = {
                "name": fullname,
                "method": "addListener",
                "data": [method_name, "runtime@" + self.client_id],
            }
            await self.websocket.send(json.dumps(message))
        except websockets.exceptions.ConnectionClosedError as e:
            log.info(f"Connection closed: {e}")

    async def start_heartbeat(self):
        while self.state != State.SHUTDOWN:
            await self._send_message(
                {"id": self.remote_id, "name": "runtime", "method": "getUptime"}
            )
            await asyncio.sleep(1)  # Send message every second

    async def receive_messages(self):
        async for message in self.websocket:
            if self.state == State.SHUTDOWN:
                break
            self.handle_message(message)

    async def check_for_input(self):
        loop = asyncio.get_running_loop()
        user_input = await loop.run_in_executor(None, sys.stdin.readline)
        if user_input.strip().lower() == "q":
            self.shutdown()

    def addListener(self, method: str, remoteName: str, remoteMethod: str = None):
        log.info(
            f"== addListener {self.client_id}.{method} --> {remoteName}.{remoteMethod}"
        )

        if not remoteMethod:
            remoteMethod = CodecUtil.get_callback_topic_name(method)

        if not method in self.notifyList:
            self.notifyList[method] = []

        listeners: List[SubscriptionListener] = self.notifyList[method]
        for listener in listeners:
            if (
                listener.callbackName == remoteName
                and listener.callbackMethod == remoteMethod
            ):
                log.info(
                    f"listener on {method} for -> {remoteName}.{remoteMethod} already exists"
                )
                return listener

        listener = SubscriptionListener(method, remoteName, remoteMethod)
        self.notifyList[method].append(listener)
        return listener

    # FIXME - implementation not finished !!!
    def removeListener(self, method: str, remote_name: str, remote_method: str = None):
        # log.info(f"remove_listener {method} {remote_name} {remote_method}")

        if remote_method is None:
            # log.info(f"remote_method is null, setting to {CodecUtil.get_callback_topic_name(method)}")
            remote_method = CodecUtil.get_callback_topic_name(method)

        # log.info(f"== remove_listener {self.name}.{method} --> {remote_name}.{remote_method}")

        if not self.notifyList or method not in self.notifyList:
            # log.info(f"no listeners for method {method}")
            return

        for index, listener in enumerate(self.notifyList[method]):
            log.info(f"checking listener {listener}")
            pass
            # FIXME
            # log.info(f"checking listener {listener['callback_name']}.{listener['callback_method']} for {remote_name}.{remote_method}")
            # if listener['callback_name'] == remote_name and listener['callback_method'] == remote_method:
            # if listener.callbackName == remote_name and listener['callback_method'] == remote_method:
            #     del self.notifyList[method][index]
            #     # log.info(f"removed listener on {method} for -> {remote_name}.{remote_method}")
            #     return

    def setInstalled(self, installed):
        """FIXME - not sure the value of this method - maybe remove it"""
        log.info("setInstalled")
        self.installed = installed

    def broadcastState(self):
        # WARNING FIXME - IF YOU LOG.INFO IN A BROADCAST STATE IT WILL LOOP !
        # log.info(f"== broadcastState {self.client_id}")
        return self.to_dict()

    # I get a broadcastState from the runtime I connected even though I didn't subscribe to it
    def onBroadcastState(self, data: List[any]):
        # BUG - this can be an infinite loop where it updates the display
        # the display redraws, which sends a broadcastState, which updates the display
        # log.info(f"--> onBroadcastState {data}")
        pass

    def handle_message(self, message):
        msg = None
        params = None
        methodName = None
        try:
            msg = json.loads(message)
            params = msg.get("data")
            methodName: str = msg.get("method")

            # FIXME - loop needs to be fixed, why are broadcastStates coming back
            if methodName == "onBroadcastState":
                # log.warning("why onBroadcastState?")
                # self.onBroadcastState(*params)
                return

            log.info(
                f"{msg.get('sender')} --> {msg.get('name')}.{methodName}(data={params})"
            )
            self.invoke(methodName, *params)

        except Exception as e:
            log.info(f"could not execute message: {methodName}")
            traceback.print_exc()
            log.info(f"Failed to decode JSON message: {e}")

    async def wait_for_stop(self):
        await self.stop_event.wait()

    def stopService(self):
        log.info("Stopping service...")
        self.state = State.SHUTDOWN
        self.stop_event.set()

    def shutdown(self):
        self.stopService()
        log.info("Shutting down...")
        os._exit(0)

    def startService(self):
        log.info("Starting service...")
        self.startTime = int(time.time())
        # TODO - future connectivity status check
        # self.loop.create_task(self.start_heartbeat())
        self.loop.create_task(self.receive_messages())
        self.loop.create_task(self.check_for_input())
        self.loop.create_task(self.wait_for_stop())
        log.info("Service started")
        self.loop.run_forever()

    def releaseService(self):
        """Releases the service from the proxied runtime
        Will shutdown our capture and websocket and coroutines
        """
        print("Releasing service")

        # # Stop the service
        self.shutdown()

    def invoke(self, method_name, *args, **kwargs):
        # return self.invoke_method(self.__class__.__module__, self.service, method_name, *args, **kwargs)
        return self.invoke_method(self, method_name, *args, **kwargs)

    def invoke_method(self, instance, method_name, *args, **kwargs):
        try:
            # Import the module
            # module = importlib.import_module(module_name)

            # Get the method from the instance
            method = getattr(instance, method_name)

            # Call the method with the provided arguments and keyword arguments
            result = method(*args, **kwargs)

            # get the notify list and send msgs to all subscribers
            subscribers: List[SubscriptionListener] = self.notifyList[method_name]

            for subscriber in subscribers:
                msg: Message = Message(
                    subscriber.callbackName, subscriber.callbackMethod
                )
                log.info(f"<-- {msg.name}.{msg.method} {result}")
                msg.data = [result]
                self.send_message(msg.__dict__)

            return result
        # except ImportError:
        #     return f"Module {module_name} could not be imported."
        except AttributeError:
            return f"Method {method_name} not found in the instance."
        except Exception as e:
            return f"An error occurred: {e}"

    def save(self, configName: str = "default"):
        log.info(f"cwd {os.getcwd()}")
        full_path = (
            # FIXME - YIKES !!! needs local data of where config root is
            # os.getcwd()
            Path("../../../../")
            / Path("config/")
            / Path(configName)
            / f"{self.name}.yml"
        )
        log.info(f"save {self.name} to {full_path}")
        with open(full_path, "w", encoding="utf-8") as file:
            yaml.dump(self.config, file, default_flow_style=False)
        # FIXME - pass in configName or directory
        # determine if "local" proxy
        # need to know the runtime id and configName directory

    def to_dict(self):
        return {
            "config": self.config,
            "fullname": self.fullname,
            "id": self.id,
            "installed": self.installed,
            "name": self.id,
            "notifyList": {
                key: [listener.to_dict() for listener in listeners]
                for key, listeners in self.notifyList.items()
            },
            "ready": self.ready,
            "startTime": self.startTime,
            "typeKey": self.__class__.__name__,
        }


def main():
    parser = argparse.ArgumentParser(description="WebSocket Client")
    parser.add_argument(
        "-c",
        "--connect",
        required=False,
        help="WebSocket url to connect to",
        default="http://localhost:3001",
    )
    parser.add_argument(
        "-i", "--id", required=False, help="Client ID", default="python-client-1"
    )

    args = parser.parse_args()

    client = Service(args.id)
    client.connect(args.connect)
    # client is now connected, client can send messages and make subscriptions
    # FIXME - will need to work on blocking service requests at some point
    client.send_message({"runtime": "getRegistry"})
    client.subscribe("runtime", "getUptime")
    client.subscribe("runtime", "getVersion")

    try:
        client.startService()
    except KeyboardInterrupt:
        client.shutdown()


if __name__ == "__main__":
    main()
