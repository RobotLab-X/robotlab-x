import argparse
import asyncio
import websockets
import json
import time

class WebSocketClient:
    def __init__(self, endpoint, client_id):
        self.endpoint = endpoint
        self.client_id = client_id

    async def connect(self):
        async with websockets.connect(self.endpoint) as websocket:
            send_task = asyncio.create_task(self.send_messages(websocket))
            receive_task = asyncio.create_task(self.receive_messages(websocket))
            await asyncio.gather(send_task, receive_task)

    async def send_messages(self, websocket):
        while True:
            message = {
                "id": "rlx1",
                "name": "runtime",
                "method": "getUptime"
            }
            await websocket.send(json.dumps(message))
            await asyncio.sleep(1)  # Send message every second

    async def receive_messages(self, websocket):
        async for message in websocket:
            self.handle_message(message)

    def handle_message(self, message):
        try:
            data = json.loads(message)
            print(f"Received message: {data}")
        except json.JSONDecodeError as e:
            print(f"Failed to decode JSON message: {e}")

def main():
    parser = argparse.ArgumentParser(description='WebSocket Client')
    parser.add_argument('-c', '--connect', required=False, help='WebSocket endpoint to connect to', default='ws://localhost:3001/api/messages?id=1')
    parser.add_argument('-i', '--id', required=False, help='Client ID', default='1')

    args = parser.parse_args()

    client = WebSocketClient(args.connect, args.id)
    asyncio.run(client.connect())

if __name__ == '__main__':
    main()
