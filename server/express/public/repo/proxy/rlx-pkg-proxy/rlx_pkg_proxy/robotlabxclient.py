import argparse
import traceback
import asyncio
from typing import List
import websockets
import json
import sys
import requests
import logging
from enum import Enum, auto
from robotlabx.codecutil import CodecUtil
from robotlabx.message import Message
import re

logging.basicConfig(level=logging.INFO)
log = logging.getLogger('RobotLabXClient')

class SubscriptionListener:
  topicMethod: str = None
  callbackName: str = None
  callbackMethod: str = None

  def __init__(self, topicMethod: str = None, callbackName: str = None, callbackMethod: str = None):
    self.topicMethod = topicMethod
    self.callbackName = callbackName
    self.callbackMethod = callbackMethod


class State(Enum):
    READY = auto()
    SHUTDOWN = auto()

class RobotLabXClient:
    """WebSocket client that connects to a WebSocket server and sends/receives messages.

    Args:
        client_id (str): The client ID to use when connecting to the WebSocket server.
    """

    def __init__(self, client_id):
        log.info(f"WebSocket client ID: {client_id}")
        self.client_id = client_id
        self.websocket = None
        self.stop_event = asyncio.Event()
        self.state = State.READY
        self.remote_id = None
        self.loop = asyncio.get_event_loop()
        # integration point for service
        self.service = None
        self.notifyList = {}

        CodecUtil.id = self.client_id

    def get_remote_id(self, base_url):
        try:
            url = f"{base_url}/api/v1/services/runtime/getId"
            response = requests.get(url)
            if response.status_code == 200:
                self.remote_id = json.loads(response.text.strip())
                log.info(f"Remote ID: {self.remote_id}")
            else:
                log.info(f"Failed to get remote ID, status code: {response.status_code}")
        except requests.RequestException as e:
            log.info(f"Failed to get remote ID: {e}")

    def connect(self, url):
        try:
          self.url = url
          # Try to get remote ID before connecting
          self.get_remote_id(self.url)
          websocket_url = f"ws://{self.url.split('//')[1]}/api/messages?id={self.client_id}"
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
            message['sender'] = f"{self.client_id}@{self.client_id}"
            log.info(f"<-- {message.get('name')} {message.get('method')} <-- @{self.client_id}{message.get('data')}")
            json_data = json.dumps(message)
            await self.websocket.send(json_data)
        except websockets.exceptions.ConnectionClosedError as e:
            log.info(f"Connection closed: {e}")

    def subscribe(self, fullname, method_name):
        asyncio.run_coroutine_threadsafe(self._subscribe(fullname, method_name), self.loop)

    async def _subscribe(self, fullname, method_name):
        try:
            message = {
                "name": fullname,
                "method": "addListener",
                "data": [method_name, "runtime@" + self.client_id]
            }
            await self.websocket.send(json.dumps(message))
        except websockets.exceptions.ConnectionClosedError as e:
            log.info(f"Connection closed: {e}")

    async def start_heartbeat(self):
        while self.state != State.SHUTDOWN:
            await self._send_message({
                "id": self.remote_id,
                "name": "runtime",
                "method": "getUptime"
            })
            await asyncio.sleep(1)  # Send message every second

    async def receive_messages(self):
        async for message in self.websocket:
            if self.state == State.SHUTDOWN:
                break
            self.handle_message(message)

    async def check_for_input(self):
        loop = asyncio.get_running_loop()
        user_input = await loop.run_in_executor(None, sys.stdin.readline)
        if user_input.strip().lower() == 'q':
            self.shutdown()

    def addListener(self, method: str, remoteName: str, remoteMethod: str = None):
        log.info(f"== addListener {self.client_id}.{method} --> {remoteName}.{remoteMethod}")

        if not remoteMethod:
          remoteMethod = CodecUtil.get_callback_topic_name(method)

        if not method in self.notifyList:
          self.notifyList[method] = []

        listeners:List[SubscriptionListener] = self.notifyList[method]
        for listener in listeners:
          if listener.callbackName == remoteName and listener.callbackMethod == remoteMethod:
            log.info(f"listener on {method} for -> {remoteName}.{remoteMethod} already exists")
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


    def broadcastState(self):
        log.info(f"== broadcastState {self.client_id}")

        # get the notify list and send msgs to all subscribers
        subscribers:List[SubscriptionListener] = self.notifyList["broadcastState"]

        for subscriber in subscribers:
          msg:Message = Message(subscriber.callbackName, subscriber.callbackMethod)
          log.info(f"<--------------------------broadcasting state to {subscriber.callbackName}.{subscriber.callbackMethod}")
          msg.data = [self.service.to_dict()]
          self.send_message(msg.__dict__)

    # I get a broadcastState from the runtime I connected even though I didn't subscribe to it
    def onBroadcastState(self, data:List[any]):
        log.info(f"--> onBroadcastState {data}")

    def handle_message(self, message):
        msg = None
        params = None
        methodName = None
        try:
            msg = json.loads(message)
            params = msg.get('data')
            methodName:str = msg.get('method')

            log.info(f"{msg.get('sender')} --> {msg.get('name')}.{methodName}(data={params})")

            # ROUTE CORE REQUIRED MESSAGING HERE
            # addListener broadcastState ...
            if methodName == "addListener":
                self.addListener(*params)
                return

            if methodName == "removeListener":
                self.removeListener(*params)
                return

            if methodName == "broadcastState":
                self.broadcastState()
                return

            if methodName == "onBroadcastState":
                self.onBroadcastState(params)
                return

            method = getattr(self.service, msg.get('method'))

            if not method:
                log.info(f"Method {msg.get('method')} not found.")
                return

            if self.service and params:
                # self.loop.create_task(self.service.handle_message(data))
                method(*params)
            else:
                method()

        except Exception as e:
            log.info(f"could not execute message: {methodName}")
            traceback.print_exc()
            log.info(f"Failed to decode JSON message: {e}")

    async def wait_for_stop(self):
        await self.stop_event.wait()

    def stop_service(self):
        log.info("Stopping service...")
        self.state = State.SHUTDOWN
        self.stop_event.set()

    def shutdown(self):
        self.stop_service()
        log.info("Shutting down...")
        sys.exit(0)

    def start_service(self):
        log.info("Starting service...")
        # TODO - future connectivity status check
        # self.loop.create_task(self.start_heartbeat())
        self.loop.create_task(self.receive_messages())
        self.loop.create_task(self.check_for_input())
        self.loop.create_task(self.wait_for_stop())
        log.info("Service started")
        self.loop.run_forever()

    def set_service(self, service):
        self.service = service

def main():
    parser = argparse.ArgumentParser(description='WebSocket Client')
    parser.add_argument('-c', '--connect', required=False, help='WebSocket url to connect to', default='http://localhost:3001')
    parser.add_argument('-i', '--id', required=False, help='Client ID', default='python-client-1')

    args = parser.parse_args()

    client = RobotLabXClient(args.id)
    client.connect(args.connect)
    # client is now connected, client can send messages and make subscriptions
    # FIXME - will need to work on blocking service requests at some point
    client.send_message({"runtime": "getRegistry"})
    client.subscribe("runtime", "getUptime")
    client.subscribe("runtime", "getVersion")

    try:
        client.start_service()
    except KeyboardInterrupt:
        client.shutdown()

if __name__ == '__main__':
    main()
