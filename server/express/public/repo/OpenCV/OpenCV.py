import cv2
import time
import asyncio
from time import sleep
from concurrent.futures import ThreadPoolExecutor
from robotlabx.robotlabxclient import RobotLabXClient

class OpenCVFilter:
    def __init__(self, name):
        self.name = name

    def apply(self, frame):
        print(f"Applying filter: {self.name}")
        return frame

class OpenCVFilterCanny(OpenCVFilter):
    def __init__(self, name, threshold1=50, threshold2=150):
        super().__init__(name)
        self.threshold1 = threshold1
        self.threshold2 = threshold2

    def apply(self, frame):
        print(f"Applying Canny filter: {self.name}")
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray, self.threshold1, self.threshold2)
        return edges

class OpenCV:
    def __init__(self, id):
        self.id = id
        self.version = cv2.__version__
        self.cap = None
        self.capturing = False
        self.loop = asyncio.get_event_loop()
        self.executor = ThreadPoolExecutor()
        self.filters = []
        print(f"OpenCV version: {self.version}")

    def capture(self):
        if self.capturing:
            print("Webcam is already capturing.")
            return

        self.capturing = True
        self.loop.run_in_executor(self.executor, self._capture)

    def _capture(self):
        try:
            print("Starting webcam capture...")
            self.cap = cv2.VideoCapture(0)
            while self.capturing:
                start_time = time.perf_counter()

                ret, frame = self.cap.read()

                if not ret:
                    print("Error: Failed to capture image.")
                    break

                # Apply filters
                for filter in self.filters:
                    frame = filter.apply(frame)

                cv2.imshow('Webcam Stream', frame)

                if cv2.waitKey(1) & 0xFF == ord('q'):
                    self.stop_capture()
                    break

                # Calculate frame processing time
                frame_time = time.perf_counter() - start_time
                sleep_time = max(0.01 - frame_time, 0)  # Ensure non-negative sleep time
                sleep(sleep_time)  # Use time.sleep instead of asyncio.sleep

                # Optional: Print the actual FPS
                actual_fps = 1.0 / (frame_time + sleep_time)
                print(f"Actual FPS: {actual_fps:.2f}")

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
        filter_class_name = f"OpenCVFilter{type_of_filter}"
        filter_class = globals().get(filter_class_name)
        if filter_class:
            filter_instance = filter_class(name_of_filter)
            self.filters.append(filter_instance)
            print(f"Added filter: {name_of_filter} of type: {type_of_filter}")
        else:
            print(f"Filter class {filter_class_name} not found.")


    def to_dict(self):
        # Custom logic to handle serialization
        return {
            "id": self.id,
            "fullname": f"{self.id}@{self.id}",
            "name":  self.id,
            "typeKey": "OpenCV",
            "version": self.version,
            "capturing": self.capturing,
            "filters": [filter.name for filter in self.filters]
        }

def main():
    cv = OpenCV("cv1")
    cv.add_filter("canny", "Canny")
    # cv.capture()

    # sleep(5)  # Sleep for 5 seconds using regular sleep
    # cv.stop_capture()

    client = RobotLabXClient("cv1")
    client.connect("http://localhost:3001")
    client.set_service(cv)
    client.start_service()

if __name__ == "__main__":
    main()
