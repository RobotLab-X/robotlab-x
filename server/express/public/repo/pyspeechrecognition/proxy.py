import argparse
import os
import urllib.request
import time
import asyncio
from time import sleep
from concurrent.futures import ThreadPoolExecutor
from typing import List
from rlx_pkg_pyspeechrecognition.rlx_pkg_pyspeechrecognition import PySpeechRecognition


def main():
    parser = argparse.ArgumentParser(description="PySpeechRecognition Service")
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

    # parse
    args = parser.parse_args()
    print(args)

    service = PySpeechRecognition(args.id)
    service.connect(args.connect)
    # load config ???
    service.startService()


if __name__ == "__main__":
    main()
