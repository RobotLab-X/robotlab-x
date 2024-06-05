import cv2
import asyncio
from time import sleep
from robotlabx.robotlabxclient import RobotLabXClient

class OpenCV:
    def __init__(self):
        self.version = cv2.__version__
        self.cap = None
        self.capturing = False
        self.loop = asyncio.get_event_loop()
        self.capture_task = None
        print(f"OpenCV version: {self.version}")

    def capture(self):
        if self.capturing:
            print("Webcam is already capturing.")
            return

        self.capturing = True
        self.capture_task = self.loop.create_task(self._capture())

    async def _capture(self):
        try:
            print("Starting webcam capture...")
            self.cap = cv2.VideoCapture(0)
            while self.capturing:
                ret, frame = self.cap.read()

                if not ret:
                    print("Error: Failed to capture image.")
                    break

                cv2.imshow('Webcam Stream', frame)

                if cv2.waitKey(1) & 0xFF == ord('q'):
                    self.stop_capture()
                    break

                await asyncio.sleep(0.01)
        except Exception as e:
            print(f"Error: {e}")
            self.stop_capture()
        finally:
            self.stop_capture()

    def stop_capture(self):
        if self.cap:
            self.cap.release()
            cv2.destroyAllWindows()
            self.cap = None
        self.capturing = False
        if self.capture_task:
            self.capture_task.cancel()
            self.capture_task = None
        print("Webcam capture stopped.")

    def add_filter(self, name_of_filter, type_of_filter):
        print(f"Adding filter: {name_of_filter} of type: {type_of_filter}")
        pass


async def main():
    webcam_capture = OpenCV()
    webcam_capture.capture()

    await asyncio.sleep(5)
    webcam_capture.stop_capture()

    # client = RobotLabXClient('client1')
    # client.connect('http://localhost:3001')
    # client.start_service()

if __name__ == "__main__":
    asyncio.run(main())
