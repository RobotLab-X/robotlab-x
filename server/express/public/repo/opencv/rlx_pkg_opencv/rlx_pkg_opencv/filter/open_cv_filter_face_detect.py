
import cv2
from .open_cv_filter import OpenCVFilter

class OpenCVFilterFaceDetect(OpenCVFilter):
    """Face detection filter using Haar cascades.

      Face Detection:

      haarcascade_frontalface_default.xml
      haarcascade_frontalface_alt.xml
      haarcascade_frontalface_alt2.xml
      haarcascade_frontalface_alt_tree.xml
      haarcascade_profileface.xml
      Eye Detection:

      haarcascade_eye.xml
      haarcascade_eye_tree_eyeglasses.xml
      Smile Detection:

      haarcascade_smile.xml
      Upper Body Detection:

      haarcascade_upperbody.xml
      Full Body Detection:

      haarcascade_fullbody.xml
      Lower Body Detection:

      haarcascade_lowerbody.xml
      License Plate Detection:

      haarcascade_russian_plate_number.xml
      Hand Detection:

      haarcascade_hand.xml
      LeNet (Handwritten Digit Recognition):

      haarcascade_leye.xml

    """
    def __init__(self, name, cascade_path='haarcascade_frontalface_default.xml'):
        super().__init__(name)
        self.cascade_path = cascade_path
        self.face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + cascade_path)

    def apply(self, frame):
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = self.face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))
        for (x, y, w, h) in faces:
            cv2.rectangle(frame, (x, y), (x+w, y+h), (255, 0, 0), 2)

        # TODO - publish_face_detections(faces)
        return frame

    def to_dict(self):
        return {
            "name": self.name,
            "typeKey": "FaceDetect",
            "cascade_path": self.cascade_path
        }
