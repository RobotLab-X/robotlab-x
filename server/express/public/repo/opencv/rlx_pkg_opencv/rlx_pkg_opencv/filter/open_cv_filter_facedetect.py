import cv2
from rlx_pkg_opencv.filter.open_cv_filter import OpenCVFilter
import time

class OpenCVFilterFaceDetect(OpenCVFilter):
    """Face detection filter using Haar cascades."""

    def __init__(
        self, name, service, cascade_path="haarcascade_frontalface_default.xml"
    ):
        super().__init__(name, service)
        self.config = {"cascade_path": cascade_path}
        self.face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + cascade_path)
        self.last_invoke_time = 0  # for debounce

    def apply_config(self, config):
        super().apply_config(config)
        self.face_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + config.get("cascade_path")
        )

    def apply(self, frame):
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        detections = []
        faces = self.face_cascade.detectMultiScale(
            gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30)
        )

        current_time = time.time()
        for x, y, w, h in faces:
            cv2.rectangle(frame, (x, y), (x + w, y + h), (255, 0, 0), 2)
            detections.append(
                {
                    "class_id": 0,
                    "confidence": 1.0,
                    "label": "face",
                    "x": int(x),
                    "y": int(y),
                    "w": int(w),
                    "h": int(h),
                    "ts": int(current_time),
                }
            )

        # self.service.invoke("publishDetection", detections)

        if (
            self.service
            and len(detections) > 0
            and (current_time - self.last_invoke_time)
            > self.service.config.get("debounce")
        ):
            self.service.invoke("publishDetection", detections)
            self.last_invoke_time = current_time  # Update last invoke time

        return frame
