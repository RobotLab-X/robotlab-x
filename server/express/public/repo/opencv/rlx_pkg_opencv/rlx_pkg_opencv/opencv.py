import argparse
import cv2
import os
import importlib
import uuid
import numpy as np
import urllib.request
import time
import asyncio
from time import sleep
from concurrent.futures import ThreadPoolExecutor
from rlx_pkg_proxy.robotlabxclient import RobotLabXClient
from typing import List


class OpenCV:
    def __init__(self, id=uuid.uuid1()):
        self.id: str = id
        self.version: str = cv2.__version__
        self.cap = None
        # FIXME - this is serving dual purpose, both write and read
        # the command to start capturing and the status of capturing
        self.capturing: bool = False
        self.loop = asyncio.get_event_loop()
        self.executor = ThreadPoolExecutor()
        self.filters: List[str] = []
        self.config = {
            "camera_index": "0",
        }
        # needed when json definition of proxy switches to this service
        self.installed: bool = True

        print(f"OpenCV version: {self.version}")

    def set_camera(self, camera_index):
        self.config["camera_index"] = camera_index

    def capture(self):
        if self.capturing:
            print("Webcam is already capturing.")
            return

        self.capturing = True
        self.loop.run_in_executor(self.executor, self._capture)

    def _capture(self):
        try:
            print("Starting webcam capture...")
            self.cap = cv2.VideoCapture(int(self.config.get("camera_index")))
            while self.capturing:
                start_time = time.perf_counter()

                ret, frame = self.cap.read()

                if not ret:
                    print("Error: Failed to capture image.")
                    break

                for filter in self.filters:
                    frame = filter.apply(frame)

                cv2.imshow("Webcam Stream", frame)

                if cv2.waitKey(1) & 0xFF == ord("q"):
                    self.stop_capture()
                    break

                frame_time = time.perf_counter() - start_time
                sleep_time = max(0.01 - frame_time, 0)
                sleep(sleep_time)

                actual_fps = 1.0 / (frame_time + sleep_time)

        except Exception as e:
            print(f"Error: {e}")
        finally:
            self.stop_capture()

    def stop_capture(self):
        self.capturing = False
        if self.cap:
            self.cap.release()
            cv2.destroyAllWindows()
            self.cap = None
        print("Webcam capture stopped.")

    def add_filter(self, name_of_filter, type_of_filter):
        # Construct the module path
        module_name = f"rlx_pkg_opencv.filter.open_cv_filter_{type_of_filter.lower()}"
        filter_class_name = f"OpenCVFilter{type_of_filter}"

        try:
            # Dynamically import the module
            module = importlib.import_module(module_name)
            # Get the filter class
            filter_class = getattr(module, filter_class_name)
            # Create an instance of the filter class
            filter_instance = filter_class(name_of_filter)
            self.filters.append(filter_instance)
            print(f"Added filter: {name_of_filter} of type: {type_of_filter}")
        except ModuleNotFoundError:
            print(f"Module {module_name} not found.")
        except AttributeError:
            print(f"Filter class {filter_class_name} not found in {module_name}.")

    def remove_filter(self, name_of_filter):
        self.filters = [
            filter for filter in self.filters if filter.name != name_of_filter
        ]
        print(f"Removed filter: {name_of_filter}")

    def to_dict(self):
        return {
            "id": self.id,
            "fullname": f"{self.id}@{self.id}",
            "name": self.id,
            "typeKey": "OpenCV",
            "version": self.version,
            "config": self.config,
            "capturing": self.capturing,
            "installed": self.installed,
            "filters": [filter.to_dict() for filter in self.filters],
        }


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
