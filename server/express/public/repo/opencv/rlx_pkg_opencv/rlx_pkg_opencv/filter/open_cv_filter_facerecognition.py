import time
import os
import cv2
import numpy as np
from sklearn.preprocessing import LabelEncoder
from sklearn.svm import SVC
from joblib import dump, load
from rlx_pkg_opencv.filter.open_cv_filter import OpenCVFilter
from typing import Dict

# Directory to save face images and model
BASE_DIR = "face_recognition_data"
MODEL_PATH = os.path.join(BASE_DIR, "face_recognizer.joblib")


class OpenCVFilterFaceRecognition(OpenCVFilter):
    """
    Face recognition filter.
    """

    def __init__(self, name, service, mode="recognize", num_images=10):
        super().__init__(name, service)
        self.config = {
            "mode": mode,
            "name": "unknown",
            "num_images": num_images,
        }

        self.image_counts: Dict[str, int] = {}
        print(f"Face Recognition initialized in {mode} mode.")
        self.get_model_image_counts()

    def list_models(self):
        """List all the models in the directory."""
        return [
            name
            for name in os.listdir(BASE_DIR)
            if os.path.isdir(os.path.join(BASE_DIR, name))
        ]

    def list_images(self, model_name):
        """List all the images in the directory."""
        return os.listdir(os.path.join(BASE_DIR, model_name))

    def get_model_image_counts(self):
        """Get the number of images in each model."""
        for model_name in self.list_models():
            self.image_counts[model_name] = len(self.list_images(model_name))
        return self.image_counts

    def apply(self, frame):
        mode = self.config.get("mode")
        if mode == "learn":
            self.capture_faces(
                frame,
                self.config.get("name", "unknown"),
                self.config.get("num_images", 10),
            )
        elif mode == "train":
            self.train_model()
        elif mode == "recognize":
            return self.recognize_faces(frame)
        else:
            raise ValueError("Invalid mode specified in config")
        return frame

    def capture_faces(self, frame, name, num_images=10):
        person_dir = os.path.join(BASE_DIR, name)
        if not os.path.exists(person_dir):
            os.makedirs(person_dir)

        face_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )

        count = 0
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = face_cascade.detectMultiScale(
            gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30)
        )

        for x, y, w, h in faces:
            if count >= num_images:
                break
            face = gray[y : y + h, x : x + w]
            face_resized = cv2.resize(face, (100, 100))  # Resize to 100x100 pixels
            face_path = os.path.join(person_dir, f"{count}.jpg")
            cv2.imwrite(face_path, face_resized)
            count += 1

            # Draw a rectangle around the face
            cv2.rectangle(frame, (x, y), (x + w, y + h), (255, 0, 0), 2)

        # cv2.imshow("Learning Mode - Press q to quit", frame)
        # cv2.waitKey(1)

    def train_model(self):
        face_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )
        X, y = [], []

        for person_name in os.listdir(BASE_DIR):
            person_dir = os.path.join(BASE_DIR, person_name)
            if os.path.isdir(person_dir):
                for img_name in os.listdir(person_dir):
                    img_path = os.path.join(person_dir, img_name)
                    img = cv2.imread(img_path, cv2.IMREAD_GRAYSCALE)
                    faces = face_cascade.detectMultiScale(
                        img, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30)
                    )
                    for x, y_, w, h in faces:
                        face_resized = cv2.resize(
                            img[y_ : y_ + h, x : x + w], (100, 100)
                        )  # Resize to 100x100 pixels
                        X.append(face_resized.flatten())
                        y.append(person_name)

        label_encoder = LabelEncoder()
        y_encoded = label_encoder.fit_transform(y)

        # Train SVM model
        model = SVC(kernel="linear", probability=True)
        model.fit(X, y_encoded)

        # Save model and label encoder
        dump((model, label_encoder), MODEL_PATH)

    def recognize_faces(self, frame):
        model, label_encoder = load(MODEL_PATH)
        face_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = face_cascade.detectMultiScale(
            gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30)
        )

        for x, y, w, h in faces:
            face_resized = cv2.resize(
                gray[y : y + h, x : x + w], (100, 100)
            )  # Resize to 100x100 pixels
            face_flatten = face_resized.flatten().reshape(1, -1)
            proba = model.predict_proba(face_flatten)
            name = label_encoder.inverse_transform([np.argmax(proba)])

            # Draw a rectangle around the face and label it
            cv2.rectangle(frame, (x, y), (x + w, y + h), (255, 0, 0), 2)
            cv2.putText(
                frame,
                name[0],
                (x, y - 10),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.9,
                (36, 255, 12),
                2,
            )

            if self.service:
                self.service.invoke(
                    "publishRecognition",
                    {
                        "confidence": proba,
                        "label": str(name[0]),
                        "x": x,
                        "y": y,
                        "w": w,
                        "h": h,
                        "ts": int(time.time()),
                    },
                )

        return frame

    def to_dict(self):
        """
        Convert the filter to a dictionary for serialization.
        """
        base_dict = super().to_dict()
        base_dict.update({"image_counts": self.image_counts})
        return base_dict


def main():
    # Initialize the filter
    canny_filter = OpenCVFilterFaceRecognition(
        name="face recognition", mode="learn", num_images=10
    )

    # Capture video from the default camera
    cap = cv2.VideoCapture(0)

    if not cap.isOpened():
        print("Error: Could not open video stream")
        return

    while True:
        # Read a frame from the camera
        ret, frame = cap.read()
        if not ret:
            print("Error: Could not read frame")
            break

        # Apply the Canny filter to the frame
        edges = canny_filter.apply(frame)

        # Display the original frame and the edges frame
        cv2.imshow("Original", frame)
        cv2.imshow("Edges", edges)

        # Break the loop if the user presses 'q'
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    # Release the video capture object and close all OpenCV windows
    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
