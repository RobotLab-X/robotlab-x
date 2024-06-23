import argparse
import os
import urllib.request
import time
import asyncio
from time import sleep
from concurrent.futures import ThreadPoolExecutor
from typing import List
from rlx_pkg_pyaudio.pyaudio import PyAudio


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

    service = PyAudio(args.id)
    service.connect(args.connect)
    # load config ???
    service.startService()


if __name__ == "__main__":
    main()
