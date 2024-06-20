import argparse
import os
import importlib
import uuid
import urllib.request
import time
import asyncio
import logging
from time import sleep
from concurrent.futures import ThreadPoolExecutor
from rlx_pkg_proxy.service import Service
from typing import List

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("PyAudio")


class PyAudio(Service):
    def __init__(self, id=uuid.uuid1()):
        super().__init__(id)
        # FIXME remove all Service defined members from here

        self.id: str = id
        self.frame_count = 0

        # FIXME - this is serving dual purpose, both write and read
        # the command to start capturing and the status of capturing
        self.capturing: bool = False
        self.loop = asyncio.get_event_loop()
        self.executor = ThreadPoolExecutor()
        self.filters: List[any] = []
        self.config = {
            "camera_index": "0",
        }

        print(f"PyAudio version: {self.version}")

    def set_microphone(self, camera_index):
        self.config["camera_index"] = camera_index

    def releaseService(self):
        """Releases the service from the proxied runtime
        Will shutdown our capture and websocket and coroutines
        """
        print("Releasing service")

        # Call the super class's releaseService method
        super().releaseService()

    def to_dict(self):
        return {
            "id": self.id,
            "fullname": f"{self.id}@{self.id}",
            "name": self.id,
            "typeKey": "PyAudio",
            "version": self.version,
            "config": self.config,
            "capturing": self.capturing,
            "installed": self.installed,
            "filters": [filter.to_dict() for filter in self.filters],
            "ready": self.ready,
        }


def main():

    parser = argparse.ArgumentParser(description="PyAudio Service")

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
    print(args)

    cv = PyAudio(args.id)
    cv.connect(args.connect)
    cv.set_service(cv)
    cv.start_service()


if __name__ == "__main__":
    main()
