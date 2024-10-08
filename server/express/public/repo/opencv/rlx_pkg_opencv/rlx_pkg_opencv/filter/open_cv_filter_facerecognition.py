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

    Modes:
    * learn - learn a new model
    * recognize - recognize faces in an image
    * train - train a new model

    """

    def __init__(self, name, service, mode="idle", num_images=10):
        super().__init__(name, service)
        self.config = {
            "mode": mode,
            "name": "idle",
            "num_images": num_images,
        }

        self.image_counts: Dict[str, int] = {}
        self.last_invoke_time = 0  # for debounce
        print(f"Face Recognition initialized in {mode} mode.")
        os.makedirs(BASE_DIR, exist_ok=True)
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
        elif mode == "idle":
            return frame
        else:
            raise ValueError("Invalid mode specified in config")
        return frame

    def capture_faces(self, frame, name, num_images=10):
        # print(f"Capturing faces for {name}")
        person_dir = os.path.join(BASE_DIR, name)
        if not os.path.exists(person_dir):
            os.makedirs(person_dir)

        self.get_model_image_counts()

        face_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )

        if self.image_counts[name] < self.config["num_images"]:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = face_cascade.detectMultiScale(
                gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30)
            )

            if len(faces) > 1 or len(faces) == 0:
                print("No faces detected or multiple faces detected in the image.")
                return

            # not really good for training to have multiple people in the same image
            for x, y, w, h in faces:
                # if count >= num_images:
                #     break
                face = gray[y : y + h, x : x + w]
                face_resized = cv2.resize(face, (100, 100))  # Resize to 100x100 pixels
                face_path = os.path.join(person_dir, f"{self.image_counts[name]}.jpg")
                print(f"Saving face to {face_path}")
                cv2.imwrite(face_path, face_resized)

                # Draw a rectangle around the face
                cv2.rectangle(frame, (x, y), (x + w, y + h), (255, 0, 0), 2)

            self.image_counts[name] = self.image_counts[name] + 1

        # cv2.imshow("Learning Mode - Press q to quit", frame)
        # cv2.waitKey(1)

    def train_model(self):
        # print("Training model...")
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
        # print("Recognizing faces...")
        model, label_encoder = load(MODEL_PATH)
        face_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = face_cascade.detectMultiScale(
            gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30)
        )

        recognitions = []

        current_time = time.time()

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

            recognitions.append(
                {
                    # confidence is not serializable,
                    # would need to be converted
                    # to an array of floats
                    # "confidence": proba,
                    "label": str(name[0]),
                    "x": int(x),
                    "y": int(y),
                    "w": int(w),
                    "h": int(h),
                    "ts": int(current_time),
                }
            )

        if (
            self.service
            and len(recognitions) > 0
            and (current_time - self.last_invoke_time)
            > self.service.config.get("debounce")
        ):
            self.service.invoke("publishRecognition", recognitions)
            self.last_invoke_time = current_time  # Update last invoke time

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
        name="face recognition", service=None, mode="idle", num_images=10
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
