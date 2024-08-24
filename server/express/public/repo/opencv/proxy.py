import argparse
import cv2
import json
import os
import numpy as np
import urllib.request
import time
import asyncio
import websockets
import logging
import sys
import datetime
from time import sleep
from concurrent.futures import ThreadPoolExecutor
from typing import List
from rlx_pkg_opencv.opencv import OpenCV
from rlx_pkg_proxy.message import Message


logging.getLogger('websockets').setLevel(logging.INFO)

class WebSocketBatchHandler(logging.Handler):
    def __init__(self, url, id, batch_size=10, flush_interval=5):
        super().__init__()
        self.url = f"ws://{url.split('//')[1]}/api/messages?id={id}"
        self.batch_size = batch_size
        self.flush_interval = flush_interval
        self.log_buffer = []
        self.websocket = None
        self.loop = asyncio.get_event_loop()
        self.loop.run_until_complete(self.connect())

    async def connect(self):
        try:
            self.websocket = await websockets.connect(self.url)
        except Exception as e:
            print(f"Failed to connect to WebSocket: {e}")
            await asyncio.sleep(5)
            await self.connect()

    async def send_logs(self):
        if not self.websocket or not self.log_buffer:
            return
        try:
            msg: Message = Message(
            "runtime", "onLogMessage", [self.log_buffer])
            await self.websocket.send(json.dumps(msg.__dict__))
            self.log_buffer.clear()
        except websockets.exceptions.ConnectionClosed:
            await self.connect()
        except Exception as e:
            print(f"Error sending logs: {e}")

    def emit(self, record):

        log_entry = {
            'level': record.levelname.lower(),
            'message': record.getMessage(),
            'time': datetime.datetime.utcnow().isoformat() + 'Z',
            'name': record.name,
            'source': record.pathname
        }


        # log.info(f"<-- {msg.name}.{msg.method} {result}")
        # log.info(f"<-- {msg.name}.{msg.method}")
        # self.send_message(msg.__dict__)

        self.log_buffer.append(log_entry)
        if len(self.log_buffer) >= self.batch_size:
            self.loop.create_task(self.send_logs())

    async def periodic_flush(self):
        while True:
            await asyncio.sleep(self.flush_interval)
            await self.send_logs()

def setup_logging(url, id):
    logger = logging.getLogger()
    logger.setLevel(logging.DEBUG)

    # Setup WebSocket logging
    ws_handler = WebSocketBatchHandler(url, id)
    logger.addHandler(ws_handler)

    # Setup stdout and stderr capturing
    sys.stdout = LoggerWriter(logger, logging.INFO)
    sys.stderr = LoggerWriter(logger, logging.ERROR)

    # Start periodic flushing of logs
    ws_handler.loop.create_task(ws_handler.periodic_flush())

class LoggerWriter:
    def __init__(self, logger, level):
        self.logger = logger
        self.level = level

    def write(self, message):
        if message != '\n':
            self.logger.log(self.level, message)

    def flush(self):
        pass

def main():
    parser = argparse.ArgumentParser(description="OpenCV Service")
    parser.add_argument(
        "-c",
        "--connect",
        required=False,
        help="WebSocket url to connect to",
        default="ws://localhost:3001",
    )
    parser.add_argument(
        "-i", "--id", required=False, help="Client ID", default="python-client-1"
    )

    args = parser.parse_args()
    # setup_logging(args.connect, args.id)
    setup_logging(args.connect, "logger")

    cv = OpenCV(args.id)
    cv.connect(args.connect)
    cv.startService()

if __name__ == "__main__":
    main()
