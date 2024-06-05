import argparse
import asyncio
import websockets
import json
import signal
import sys

class WebSocketClient:
    def __init__(self, endpoint, client_id):
        self.endpoint = endpoint
        self.client_id = client_id
        self.websocket = None
        self.stop_event = asyncio.Event()

    async def connect(self):
        self.websocket = await websockets.connect(self.endpoint)
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
                "id": "rlx1",
                "name": "runtime",
                "method": "getUptime"
            }
            await self.websocket.send(json.dumps(message))
        except websockets.exceptions.ConnectionClosedError as e:
            print(f"Connection closed: {e}")

    async def subscribe(self, fullname, methodName, callback):
        try:
            message = {
                "id": "rlx1",
                "name": fullname,
                "method": methodName
            }
            await self.websocket.send(json.dumps(message))
        except websockets.exceptions.ConnectionClosedError as e:
            print(f"Connection closed: {e}")

    async def start_heartbeat(self):
        while not self.stop_event.is_set():
            await self.send_message()
            await asyncio.sleep(1)  # Send message every second

    async def receive_messages(self):
        async for message in self.websocket:
            if self.stop_event.is_set():
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
        self.stop_event.set()

    def shutdown(self):
        self.stop_service()
        print("Shutting down...")
        sys.exit(0)

    def start_service(self):
        print("Starting service...")
        asyncio.run(self.connect())

def main():
    parser = argparse.ArgumentParser(description='WebSocket Client')
    parser.add_argument('-c', '--connect', required=False, help='WebSocket endpoint to connect to', default='ws://localhost:3001/api/messages?id=1')
    parser.add_argument('-i', '--id', required=False, help='Client ID', default='1')

    args = parser.parse_args()

    client = WebSocketClient(args.connect, args.id)

    def handle_signal(signal, frame):
        client.shutdown()

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    client.start_service()

if __name__ == '__main__':
    main()
