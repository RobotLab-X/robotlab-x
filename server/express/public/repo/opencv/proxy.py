import argparse
import cv2
import os
import numpy as np
import urllib.request
import time
import asyncio
from time import sleep
from concurrent.futures import ThreadPoolExecutor
from robotlabx.robotlabxclient import RobotLabXClient
from typing import List
from rlx_pkg_opencv.opencv import OpenCV


def main():
    parser = argparse.ArgumentParser(description="OpenCV Service")
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

    cv = OpenCV(args.id)
    # cv.add_filter("canny", "Canny")
    # cv.add_filter("yolo", "Yolo3")
    # cv.capture()

    # sleep(100)
    # cv.stop_capture()

    client = RobotLabXClient(args.id)
    client.connect(args.connect)
    client.set_service(cv)
    client.start_service()


if __name__ == "__main__":
    main()
