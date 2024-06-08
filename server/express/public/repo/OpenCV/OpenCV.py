import cv2
import os
import numpy as np
import urllib.request
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

    def to_dict(self):
        return {
            "name": self.name,
            "typeKey": "Filter"
        }

class OpenCVFilterCanny(OpenCVFilter):
    def __init__(self, name, threshold1=50, threshold2=150):
        super().__init__(name)
        self.threshold1 = threshold1
        self.threshold2 = threshold2

    def apply(self, frame):
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray, self.threshold1, self.threshold2)
        return edges

    def to_dict(self):
        return {
            "name": self.name,
            "typeKey": "Canny",
            "threshold1": self.threshold1,
            "threshold2": self.threshold2
        }

class OpenCVFilterYolo3(OpenCVFilter):
    def __init__(self, name, conf_threshold=0.5, nms_threshold=0.4):
        super().__init__(name)
        print("OpenCVFilterYolo3")
        self.conf_threshold = conf_threshold
        self.nms_threshold = nms_threshold
        paths = self.download_yolo_files('yolo')
        self.net = cv2.dnn.readNetFromDarknet(paths.get("cfg_path"), paths.get("weights_path"))
        self.layer_names = self.net.getLayerNames()
        self.output_layers = [self.layer_names[i - 1] for i in self.net.getUnconnectedOutLayers()]
        with open(paths.get("names_path"), 'r') as f:
            self.classes = [line.strip() for line in f.readlines()]

    def download_yolo_files(self, destination_dir):
        os.makedirs(destination_dir, exist_ok=True)

        # files = {
        #     'cfg': 'yolov3.cfg',
        #     'weights': 'yolov3.weights',
        #     'names': 'coco.names'
        # }

        # urls = {
        #     'cfg': 'https://raw.githubusercontent.com/pjreddie/darknet/master/cfg/yolov3.cfg',
        #     'weights': 'https://pjreddie.com/media/files/yolov3.weights',
        #     'names': 'https://raw.githubusercontent.com/pjreddie/darknet/master/data/coco.names'
        # }


        files = {
            'cfg': 'yolov3-tiny.cfg',
            'weights': 'yolov3-tiny.weights',
            'names': 'coco.names'
        }

        urls = {
            'cfg': 'https://raw.githubusercontent.com/pjreddie/darknet/master/cfg/yolov3-tiny.cfg',
            'weights': 'https://pjreddie.com/media/files/yolov3-tiny.weights',
            'names': 'https://raw.githubusercontent.com/pjreddie/darknet/master/data/coco.names'
        }



        paths = {}
        for file_type, file_name in files.items():
            file_path = os.path.join(destination_dir, file_name)
            if not os.path.exists(file_path):
                print(f'Downloading {file_type} from {urls[file_type]}...')
                urllib.request.urlretrieve(urls[file_type], file_path)
                print(f'Saved {file_type} to {file_path}')
            else:
                print(f'{file_type} already exists at {file_path}, skipping download.')
            paths[f'{file_type}_path'] = file_path

        return paths

    def apply(self, frame):
        if not self.net:
            print("Error: YOLO model not loaded.")
            return frame

        blob = cv2.dnn.blobFromImage(frame, 0.00392, (416, 416), (0, 0, 0), True, crop=False)
        self.net.setInput(blob)
        outs = self.net.forward(self.output_layers)

        class_ids = []
        confidences = []
        boxes = []

        height, width = frame.shape[:2]
        for out in outs:
            for detection in out:
                scores = detection[5:]
                class_id = np.argmax(scores)
                confidence = scores[class_id]
                if confidence > self.conf_threshold:
                    center_x = int(detection[0] * width)
                    center_y = int(detection[1] * height)
                    w = int(detection[2] * width)
                    h = int(detection[3] * height)
                    x = int(center_x - w / 2)
                    y = int(center_y - h / 2)
                    boxes.append([x, y, w, h])
                    confidences.append(float(confidence))
                    class_ids.append(class_id)

        indices = cv2.dnn.NMSBoxes(boxes, confidences, self.conf_threshold, self.nms_threshold)
        if len(indices) > 0:
            for i in indices.flatten():
                box = boxes[i]
                x, y, w, h = box[0], box[1], box[2], box[3]
                cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)
                label = str(self.classes[class_ids[i]])
                confidence = confidences[i]
                cv2.putText(frame, f"{label} {confidence:.2f}", (x, y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)

                # TODO publish_classified_objects(label, confidence, x, y, w, h)

        return frame

    def to_dict(self):
        return {
            "name": self.name,
            "typeKey": "Yolo3",
            "conf_threshold": self.conf_threshold,
            "nms_threshold": self.nms_threshold
        }

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
            "typeKey": "FaceDetect"
        }

class OpenCV:
    def __init__(self, id):
        self.id = id
        self.version = cv2.__version__
        self.cap = None
        # FIXME - this is serving dual purpose, both write and read
        # the command to start capturing and the status of capturing
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

                for filter in self.filters:
                    frame = filter.apply(frame)

                cv2.imshow('Webcam Stream', frame)

                if cv2.waitKey(1) & 0xFF == ord('q'):
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
        filter_class_name = f"OpenCVFilter{type_of_filter}"
        filter_class = globals().get(filter_class_name)
        if filter_class:
            filter_instance = filter_class(name_of_filter)
            self.filters.append(filter_instance)
            print(f"Added filter: {name_of_filter} of type: {type_of_filter}")
        else:
            print(f"Filter class {filter_class_name} not found.")

    def remove_filter(self, name_of_filter):
        self.filters = [filter for filter in self.filters if filter.name != name_of_filter]
        print(f"Removed filter: {name_of_filter}")

    def to_dict(self):
        return {
            "id": self.id,
            "fullname": f"{self.id}@{self.id}",
            "name": self.id,
            "typeKey": "OpenCV",
            "version": self.version,
            "capturing": self.capturing,
            "filters": [filter.to_dict() for filter in self.filters]
        }

def main():
    cv = OpenCV("cv8")
    # cv.add_filter("canny", "Canny")
    # cv.add_filter("yolo", "Yolo3")
    # cv.capture()

    # sleep(100)
    # cv.stop_capture()

    client = RobotLabXClient("cv8")
    client.connect("http://localhost:3001")
    client.set_service(cv)
    client.start_service()

if __name__ == "__main__":
    main()
