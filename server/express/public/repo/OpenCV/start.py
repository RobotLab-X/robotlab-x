import cv2
import time
import asyncio
from time import sleep
from concurrent.futures import ThreadPoolExecutor
from robotlabx.robotlabxclient import RobotLabXClient

class OpenCV:
    def __init__(self):
        self.version = cv2.__version__
        self.cap = None
        self.capturing = False
        self.loop = asyncio.get_event_loop()
        self.executor = ThreadPoolExecutor()
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
        print(f"Adding filter: {name_of_filter} of type: {type_of_filter}")
        pass

def main():
    webcam_capture = OpenCV()
    webcam_capture.capture()

    sleep(5)  # Sleep for 5 seconds using regular sleep
    webcam_capture.stop_capture()

    client = RobotLabXClient('client1')
    client.connect('http://localhost:3001')
    client.start_service()

if __name__ == "__main__":
    main()
