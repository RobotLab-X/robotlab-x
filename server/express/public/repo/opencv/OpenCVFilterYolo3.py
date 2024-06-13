import cv2
import numpy as np
from .OpenCV import OpenCVFilter

class OpenCVFilterYolo3(OpenCVFilter):
    def __init__(self, name, cfg_path, weights_path, names_path, conf_threshold=0.5, nms_threshold=0.4):
        super().__init__(name)
        self.conf_threshold = conf_threshold
        self.nms_threshold = nms_threshold
        self.net = cv2.dnn.readNetFromDarknet(cfg_path, weights_path)
        self.layer_names = self.net.getLayerNames()
        self.output_layers = [self.layer_names[i - 1] for i in self.net.getUnconnectedOutLayers()]
        with open(names_path, 'r') as f:
            self.classes = [line.strip() for line in f.readlines()]

    def apply(self, frame):
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
        for i in indices:
            i = i[0]
            box = boxes[i]
            x, y, w, h = box[0], box[1], box[2], box[3]
            cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)
            label = str(self.classes[class_ids[i]])
            confidence = confidences[i]
            cv2.putText(frame, f"{label} {confidence:.2f}", (x, y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)

        return frame

    def to_dict(self):
        return {
            "name": self.name,
            "typeKey": "Yolo3",
            "conf_threshold": self.conf_threshold,
            "nms_threshold": self.nms_threshold
        }
