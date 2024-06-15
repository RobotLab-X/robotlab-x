import cv2
from rlx_pkg_opencv.filter.open_cv_filter import OpenCVFilter


class OpenCVFilterFaceDetect(OpenCVFilter):
    """Face detection filter using Haar cascades."""

    def __init__(self, name, cascade_path="haarcascade_frontalface_default.xml"):
        super().__init__(name)
        self.config = {"cascade_path": cascade_path}
        self.face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + cascade_path)

    def apply_config(self, config):
        super().apply_config(config)
        self.face_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + config.get("cascade_path")
        )

    def apply(self, frame):
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = self.face_cascade.detectMultiScale(
            gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30)
        )
        for x, y, w, h in faces:
            cv2.rectangle(frame, (x, y), (x + w, y + h), (255, 0, 0), 2)

        # TODO - publish_face_detections(faces)
        return frame
