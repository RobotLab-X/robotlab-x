import time
import cv2
import os
import numpy as np
import urllib.request
from rlx_pkg_opencv.filter.open_cv_filter import OpenCVFilter


class OpenCVFilterYolo3(OpenCVFilter):
    def __init__(self, name, service, conf_threshold=0.5, nms_threshold=0.4):
        super().__init__(name, service)
        print("OpenCVFilterYolo3")
        self.conf_threshold = conf_threshold
        self.nms_threshold = nms_threshold
        paths = self.download_yolo_files("yolo")
        self.net = cv2.dnn.readNetFromDarknet(
            paths.get("cfg_path"), paths.get("weights_path")
        )
        self.layer_names = self.net.getLayerNames()
        self.output_layers = [
            self.layer_names[i - 1] for i in self.net.getUnconnectedOutLayers()
        ]
        with open(paths.get("names_path"), "r") as f:
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
            "cfg": "yolov3-tiny.cfg",
            "weights": "yolov3-tiny.weights",
            "names": "coco.names",
        }

        urls = {
            "cfg": "https://raw.githubusercontent.com/pjreddie/darknet/master/cfg/yolov3-tiny.cfg",
            "weights": "https://pjreddie.com/media/files/yolov3-tiny.weights",
            "names": "https://raw.githubusercontent.com/pjreddie/darknet/master/data/coco.names",
        }

        paths = {}
        for file_type, file_name in files.items():
            file_path = os.path.join(destination_dir, file_name)
            if not os.path.exists(file_path):
                print(f"Downloading {file_type} from {urls[file_type]}...")
                urllib.request.urlretrieve(urls[file_type], file_path)
                print(f"Saved {file_type} to {file_path}")
            else:
                print(f"{file_type} already exists at {file_path}, skipping download.")
            paths[f"{file_type}_path"] = file_path

        return paths

    def apply(self, frame):
        if not self.net:
            print("Error: YOLO model not loaded.")
            return frame

        blob = cv2.dnn.blobFromImage(
            frame, 0.00392, (416, 416), (0, 0, 0), True, crop=False
        )
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
                    if self.service:
                        self.service.invoke(
                            "publishDetection",
                            {
                                "class_id": class_id,
                                "confidence": confidence,
                                "label": str(self.classes[class_id]),
                                "x": x,
                                "y": y,
                                "w": w,
                                "h": h,
                                "ts": int(time.time()),
                            },
                        )

        indices = cv2.dnn.NMSBoxes(
            boxes, confidences, self.conf_threshold, self.nms_threshold
        )
        if len(indices) > 0:
            for i in indices.flatten():
                box = boxes[i]
                x, y, w, h = box[0], box[1], box[2], box[3]
                cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)
                label = str(self.classes[class_ids[i]])
                confidence = confidences[i]
                cv2.putText(
                    frame,
                    f"{label} {confidence:.2f}",
                    (x, y - 10),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.5,
                    (0, 255, 0),
                    2,
                )

                # TODO publish_classified_objects(label, confidence, x, y, w, h)

        return frame

    def to_dict(self):
        return {
            "name": self.name,
            "typeKey": "Yolo3",
            "conf_threshold": self.conf_threshold,
            "nms_threshold": self.nms_threshold,
        }
