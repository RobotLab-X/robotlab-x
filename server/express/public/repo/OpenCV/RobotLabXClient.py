import argparse
import asyncio
import websockets
import json
import sys
import requests
from enum import Enum, auto

class State(Enum):
    READY = auto()
    SHUTDOWN = auto()

class WebSocketClient:
    """WebSocket client that connects to a WebSocket server and sends/receives messages.

    Args:
        client_id (str): The client ID to use when connecting to the WebSocket server.
    """

    def __init__(self, client_id):
        print(f"WebSocket client ID: {client_id}")
        self.client_id = client_id
        self.websocket = None
        self.stop_event = asyncio.Event()
        self.state = State.READY
        self.remote_id = None
        self.loop = asyncio.get_event_loop()

    def get_remote_id(self, base_url):
        try:
            url = f"{base_url}/api/v1/services/runtime/getId"
            response = requests.get(url)
            if response.status_code == 200:
                self.remote_id = response.text.strip()
                print(f"Remote ID: {self.remote_id}")
            else:
                print(f"Failed to get remote ID, status code: {response.status_code}")
        except requests.RequestException as e:
            print(f"Failed to get remote ID: {e}")

    def connect(self, url):
        self.url = url
        # Try to get remote ID before connecting
        self.get_remote_id(self.url)
        websocket_url = f"ws://{self.url.split('//')[1]}/api/messages?id={self.client_id}"
        print(f"Connecting to WebSocket server at: {websocket_url}")
        self.loop.run_until_complete(self._connect(websocket_url))

    async def _connect(self, websocket_url):
        self.websocket = await websockets.connect(websocket_url)

    def send_message(self, message):
        asyncio.run_coroutine_threadsafe(self._send_message(message), self.loop)

    async def _send_message(self, message):
        try:
            await self.websocket.send(json.dumps(message))
        except websockets.exceptions.ConnectionClosedError as e:
            print(f"Connection closed: {e}")

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
            print(f"Connection closed: {e}")

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

    def handle_message(self, message):
        try:
            data = json.loads(message)
            print(f"Received message: {data}")
        except json.JSONDecodeError as e:
            print(f"Failed to decode JSON message: {e}")

    async def wait_for_stop(self):
        await self.stop_event.wait()

    def stop_service(self):
        print("Stopping service...")
        self.state = State.SHUTDOWN
        self.stop_event.set()

    def shutdown(self):
        self.stop_service()
        print("Shutting down...")
        sys.exit(0)

    def start_service(self):
        print("Starting service...")
        self.loop.create_task(self.start_heartbeat())
        self.loop.create_task(self.receive_messages())
        self.loop.create_task(self.check_for_input())
        self.loop.create_task(self.wait_for_stop())
        self.loop.run_forever()

def main():
    parser = argparse.ArgumentParser(description='WebSocket Client')
    parser.add_argument('-c', '--connect', required=False, help='WebSocket url to connect to', default='http://localhost:3001')
    parser.add_argument('-i', '--id', required=False, help='Client ID', default='python-client-1')

    args = parser.parse_args()

    client = WebSocketClient(args.id)
    client.connect(args.connect)
    # client is now connected, client can send messages and make subscriptions
    client.send_message({"runtime": "getRegistry"})
    client.subscribe("runtime", "getUptime")
    client.subscribe("runtime", "getVersion")

    try:
        client.start_service()
    except KeyboardInterrupt:
        client.shutdown()

if __name__ == '__main__':
    main()
