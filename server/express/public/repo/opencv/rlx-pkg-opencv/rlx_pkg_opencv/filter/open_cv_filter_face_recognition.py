
import os
import cv2
import numpy as np
from sklearn.preprocessing import LabelEncoder
from sklearn.svm import SVC
from joblib import dump, load

# Directory to save face images and model
BASE_DIR = 'face_recognition_data'
MODEL_PATH = os.path.join(BASE_DIR, 'face_recognizer.joblib')

# Create the base directory if it doesn't exist
if not os.path.exists(BASE_DIR):
    os.makedirs(BASE_DIR)

def capture_faces(name, num_images=10):
    person_dir = os.path.join(BASE_DIR, name)
    if not os.path.exists(person_dir):
        os.makedirs(person_dir)

    cap = cv2.VideoCapture(0)
    face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')

    count = 0
    while count < num_images:
        ret, frame = cap.read()
        if not ret:
            break

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))

        for (x, y, w, h) in faces:
            face = gray[y:y+h, x:x+w]
            face_resized = cv2.resize(face, (100, 100))  # Resize to 100x100 pixels
            face_path = os.path.join(person_dir, f'{count}.jpg')
            cv2.imwrite(face_path, face_resized)
            count += 1

            # Draw a rectangle around the face
            cv2.rectangle(frame, (x, y), (x+w, y+h), (255, 0, 0), 2)

        cv2.imshow('Learning Mode - Press q to quit', frame)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()

def train_model():
    face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    X, y = [], []

    for person_name in os.listdir(BASE_DIR):
        person_dir = os.path.join(BASE_DIR, person_name)
        if os.path.isdir(person_dir):
            for img_name in os.listdir(person_dir):
                img_path = os.path.join(person_dir, img_name)
                img = cv2.imread(img_path, cv2.IMREAD_GRAYSCALE)
                faces = face_cascade.detectMultiScale(img, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))
                for (x, y_, w, h) in faces:
                    face_resized = cv2.resize(img[y_:y_+h, x:x+w], (100, 100))  # Resize to 100x100 pixels
                    X.append(face_resized.flatten())
                    y.append(person_name)

    label_encoder = LabelEncoder()
    y_encoded = label_encoder.fit_transform(y)

    # Train SVM model
    model = SVC(kernel='linear', probability=True)
    model.fit(X, y_encoded)

    # Save model and label encoder
    dump((model, label_encoder), MODEL_PATH)

def recognize_faces():
    model, label_encoder = load(MODEL_PATH)
    cap = cv2.VideoCapture(0)
    face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))

        for (x, y, w, h) in faces:
            face_resized = cv2.resize(gray[y:y+h, x:x+w], (100, 100))  # Resize to 100x100 pixels
            face_flatten = face_resized.flatten().reshape(1, -1)
            proba = model.predict_proba(face_flatten)
            name = label_encoder.inverse_transform([np.argmax(proba)])

            # Draw a rectangle around the face and label it
            cv2.rectangle(frame, (x, y), (x+w, y+h), (255, 0, 0), 2)
            cv2.putText(frame, name[0], (x, y-10), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (36, 255, 12), 2)

        cv2.imshow('Recognizing Mode - Press q to quit', frame)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == '__main__':
    mode = input("Enter mode (learn/train/recognize): ").strip().lower()
    if mode == 'learn':
        name = input("Enter the name: ").strip()
        capture_faces(name)
    elif mode == 'train':
        train_model()
    elif mode == 'recognize':
        recognize_faces()
    else:
        print("Invalid mode")
