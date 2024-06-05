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
    # Listening ?

class WebSocketClient:
    """WebSocket client that connects to a WebSocket server and sends/receives messages.

    Args:
        url (str): The WebSocket url to connect to.
        client_id (str): The client ID to use when connecting to the WebSocket server.
        """

    def __init__(self, client_id):
        print(f"WebSocket client ID: {client_id}")
        self.client_id = client_id
        self.websocket = None
        self.stop_event = asyncio.Event()
        self.state = State.READY
        self.remote_id = None

    def get_remote_id(self, base_url):
        try:
            url = f"{base_url}/api/v1/services/runtime/getId"
            response = requests.get(url)
            if response.status_code == 200:
                self.remote_id = json.loads(response.text.strip())
                print(f"Remote ID: {self.remote_id}")
            else:
                print(f"Failed to get remote ID, status code: {response.status_code}")
                self.remote_id = 'rlx1'
        except requests.RequestException as e:
            print(f"Failed to get remote ID: {e}")
            self.remote_id = 'rlx1'

    async def connect(self, url):
        self.url = url
        # Try to get remote ID before connecting
        self.get_remote_id(self.url)
        websocket_url = f"ws://{self.url.split('//')[1]}/api/messages?id={self.remote_id}"
        print(f"Connecting to WebSocket server at: {websocket_url}")
        self.websocket = await websockets.connect(websocket_url)
        try:
            await asyncio.gather(
                self.start_heartbeat(),
                self.receive_messages(),
                self.check_for_input(),
                self.wait_for_stop()
            )
        finally:
            await self.websocket.close()

    async def send_message(self):
        try:
            message = {
                "id": self.remote_id,
                "name": "runtime",
                "method": "getUptime"
            }
            await self.websocket.send(json.dumps(message))
        except websockets.exceptions.ConnectionClosedError as e:
            print(f"Connection closed: {e}")

    async def subscribe(self, fullname, method_name, callback):
        try:
            message = {
                "name": fullname,
                "method": "addListener",
                "data":[method_name, fullname]
            }
            await self.websocket.send(json.dumps(message))
        except websockets.exceptions.ConnectionClosedError as e:
            print(f"Connection closed: {e}")

    async def start_heartbeat(self):
        while self.state != State.SHUTDOWN:
            await self.send_message()
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

    async def start_service(self, url):
        print("Starting service...")
        await self.connect(url)

def main():
    parser = argparse.ArgumentParser(description='WebSocket Client')
    parser.add_argument('-c', '--connect', required=False, help='WebSocket url to connect to', default='http://localhost:3001')
    parser.add_argument('-i', '--id', required=False, help='Client ID', default='python-client-1')

    args = parser.parse_args()

    client = WebSocketClient(args.id)
    asyncio.run(client.start_service(args.connect))

if __name__ == '__main__':
    main()
