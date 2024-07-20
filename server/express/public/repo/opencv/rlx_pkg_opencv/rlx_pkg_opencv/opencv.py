import argparse
import cv2
import os
import importlib
import uuid
import numpy as np
import urllib.request
import time
import base64
import asyncio
import logging
from time import sleep
from concurrent.futures import ThreadPoolExecutor
from rlx_pkg_proxy.service import Service
from typing import List
from typing import Dict
from typing import Any

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("OpenCV")


class OpenCV(Service):
    def __init__(self, id=uuid.uuid1()):
        super().__init__(id)
        # FIXME remove all Service defined members from here

        self.id: str = id

        self.version: str = cv2.__version__
        self.cap = None
        self.frame_count = 0
        self.last_invoke_time = 0  # for debounce

        # FIXME - this is serving dual purpose, both write and read
        # the command to start capturing and the status of capturing
        self.capturing: bool = False
        self.loop = asyncio.get_event_loop()
        self.executor = ThreadPoolExecutor()
        self.filters: List[any] = []
        self.config = {
            "camera_index": "0",
            # 1 second debounce
            "debounce": 1,
            "capture": False,
        }

        self.pkg = {
            "typeKey": "OpenCV",
            "title": "OpenCV",
            "platform": "python",
            "platformVersion": "3.10",
            "description": "Python OpenCV service",
            "version": "0.0.1",
            "requirements": "pip install -r requirements.txt",
            "cmd": "python",
            "installed": True,
        }

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
                current_time = time.time()

                ret, frame = self.cap.read()

                if not ret:
                    print("Error: Failed to capture image.")
                    break

                if (current_time - self.last_invoke_time) > self.config.get("debounce"):
                    log.info(
                        f"Publishing input image after {self.config.get('debounce')} seconds"
                    )
                    _, buffer = cv2.imencode(".jpg", frame)
                    encoded64 = base64.b64encode(buffer).decode("utf-8")
                    self.invoke("publishInputBase64", encoded64)
                    self.last_invoke_time = current_time

                for cvfilter in self.filters:
                    frame = cvfilter.apply(frame)

                cv2.imshow(self.fullname, frame)

                if cv2.waitKey(1) & 0xFF == ord("q"):
                    self.stop_capture()
                    break

                frame_time = time.perf_counter() - start_time
                sleep_time = max(0.01 - frame_time, 0)
                sleep(sleep_time)

                self.frame_count = self.frame_count + 1
                if self.frame_count % 100 == 0:
                    fps = 1.0 / (frame_time + sleep_time)
                    self.invoke("publishFps", int(fps))

        except Exception as e:
            print(f"Error: {e}")
        finally:
            self.stop_capture()

    def publishFps(self, fps):
        # log.info(f"publishFps: {fps}")
        return fps

    def publishDetection(self, detections: List[Dict[str, Any]]):
        # log.info(f"publishDetection: {detection}")
        return detections

    def publishRecognition(self, recognition):
        # log.info(f"publishRecognition: {recognition}")
        return recognition

    def publishInputBase64(self, input_base64):
        # log.info(f"publishInputBase64: {input_base64}")
        return input_base64

    def setInstalled(self, installed):
        log.info("setInstalled")
        self.installed = installed

    def stop_capture(self):
        self.capturing = False
        if self.cap:
            # wait for capture to read the last frame
            sleep(1)
            self.cap.release()
            cv2.destroyAllWindows()
            self.cap = None
        print("Webcam capture stopped.")

    def onStatus(self, status):
        log.error(f"why should I be receiving a onStatus: {status}")

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
            filter_instance = filter_class(name_of_filter, self)
            self.filters.append(filter_instance)
            print(f"Added filter: {name_of_filter} of type: {type_of_filter}")
        except ModuleNotFoundError:
            print(f"Module {module_name} not found.")
        except AttributeError:
            print(f"Filter class {filter_class_name} not found in {module_name}.")
        except Exception as e:
            print(f"Error adding filter: {e}")

    def remove_filter(self, name_of_filter):
        self.filters = [
            filter for filter in self.filters if filter.name != name_of_filter
        ]
        print(f"Removed filter: {name_of_filter}")

    def releaseService(self):
        """Releases the service from the proxied runtime
        Will shutdown our capture and websocket and coroutines
        """
        print("Releasing service")

        # Stop capturing
        try:
            self.stop_capture()
        except Exception as e:
            print(f"Error stopping capture: {e}")

        # Call the super class's releaseService method
        super().releaseService()

    def apply_filter_config(self, name, config):
        for filter in self.filters:
            if filter.name == name:
                filter.apply_config(config)
                return

    # FIXME - REFACTOR WITH SERVICE
    def to_dict(self):
        base_dict = super().to_dict()
        derived = {
            "capturing": self.capturing,
            "installed": self.installed,
            "filters": [filter.to_dict() for filter in self.filters],
            "ready": self.ready,
        }
        base_dict.update(derived)
        return base_dict


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
    cv.connect(args.connect)
    cv.startService()


if __name__ == "__main__":
    main()
