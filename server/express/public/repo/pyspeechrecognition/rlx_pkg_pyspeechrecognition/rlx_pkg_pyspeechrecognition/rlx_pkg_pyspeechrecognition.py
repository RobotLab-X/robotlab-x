import argparse
import logging
import threading
import uuid
from time import sleep
import speech_recognition as sr
from rlx_pkg_proxy.service import Service
from collections import deque
import requests
from io import BytesIO

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("PySpeechRecognition")


class PySpeechRecognition(Service):
    def __init__(self, id=uuid.uuid1()):
        super().__init__(id)
        self.id: str = str(id)
        self.recognizer = sr.Recognizer()
        self.microphone = sr.Microphone()
        self.listening = False
        self.thread = None
        self.recognizer_backend = "google"  # Default recognizer
        self.mic_index = None  # Added mic_index to select microphone

    def listen(self):
        with self.microphone as source:
            while self.listening:
                log.info("Listening for speech...")
                audio = self.recognizer.listen(source)
                try:
                    log.info("Captured audio, attempting to recognize speech...")
                    text = self.recognize_speech(audio)
                    log.info(f"Recognized text: {text}")
                except sr.UnknownValueError:
                    log.warning("Speech Recognition could not understand audio")
                except sr.RequestError as e:
                    log.error(
                        f"Could not request results from Speech Recognition service; {e}"
                    )
                sleep(0.1)

    def recognize_speech(self, audio):
        log.info(f"Using {self.recognizer_backend} recognizer")
        if self.recognizer_backend == "google":
            return self.recognizer.recognize_google(audio)
        elif self.recognizer_backend == "sphinx":
            return self.recognizer.recognize_sphinx(audio)
        elif self.recognizer_backend == "ibm":
            return self.recognizer.recognize_ibm(
                audio, username="YOUR_IBM_USERNAME", password="YOUR_IBM_PASSWORD"
            )
        elif self.recognizer_backend == "bing":
            return self.recognizer.recognize_bing(audio, key="YOUR_BING_KEY")
        elif self.recognizer_backend == "houndify":
            return self.recognizer.recognize_houndify(
                audio,
                client_id="YOUR_HOUNDIFY_CLIENT_ID",
                client_key="YOUR_HOUNDIFY_CLIENT_KEY",
            )
        elif self.recognizer_backend == "wit":
            return self.recognizer.recognize_wit(audio, key="YOUR_WIT_KEY")
        elif self.recognizer_backend == "azure":
            return self.recognizer.recognize_azure(
                audio, key="YOUR_AZURE_KEY", location="YOUR_AZURE_LOCATION"
            )
        elif self.recognizer_backend == "google_cloud":
            return self.recognizer.recognize_google_cloud(
                audio, credentials_json="YOUR_GOOGLE_CLOUD_CREDENTIALS_JSON"
            )
        elif self.recognizer_backend == "vosk":
            return self.recognizer.recognize_vosk(audio)
        elif self.recognizer_backend == "whisper":
            return self.recognizer.recognize_whisper(audio)
        elif self.recognizer_backend == "whisper_api":
            return self.recognizer.recognize_whisper_api(
                audio, api_key="YOUR_OPENAI_API_KEY"
            )
        else:
            raise ValueError("Unsupported recognizer backend")

    def startListening(self):
        log.info("Start Listening")
        self.listening = True
        self.thread = threading.Thread(target=self.listen)
        self.thread.start()
        self.invoke("broadcastState")

    def stopListening(self):
        log.info("Stop Listening")
        self.listening = False
        if self.thread is not None:
            self.thread.join()
        self.invoke("broadcastState")

    def setSpeechRecognizer(self, recognizer_backend):
        log.info(f"Set Speech Recognizer to {recognizer_backend}")
        self.recognizer_backend = recognizer_backend
        self.invoke("broadcastState")

    def listMicrophones(self):
        mic_list = sr.Microphone.list_microphone_names()
        for i, mic_name in enumerate(mic_list):
            log.info(f"Microphone {i}: {mic_name}")
        return mic_list

    def setMicrophone(self, index):
        log.info(f"Setting microphone to index {index}")
        self.mic_index = index
        self.microphone = sr.Microphone(device_index=self.mic_index)
        mic_list = sr.Microphone.list_microphone_names()
        if index < len(mic_list):
            log.info(f"Microphone set to {mic_list[index]}")
        else:
            log.warning(f"Microphone index {index} is out of range.")
        self.invoke("broadcastState")

    def to_dict(self):
        base_dict = super().to_dict()
        derived = {
            "listening": self.listening,
            "mic_index": self.mic_index,
        }
        base_dict.update(derived)
        return base_dict

    def startService(self):
        log.info("Starting PySpeechRecognition service...")
        super().startService()
        # BE AWARE - this coroutine super.startService() blocks forever


def main():
    parser = argparse.ArgumentParser(description="PySpeechRecognition Service")
    parser.add_argument(
        "-c",
        "--connect",
        required=False,
        help="WebSocket url to connect to",
        default="http://localhost:3001",
    )
    parser.add_argument(
        "-i", "--id", required=False, help="Client ID", default="python-client-1"
    )
    parser.add_argument(
        "-r",
        "--recognizer",
        required=False,
        help="Speech Recognizer Backend",
        default="google",
    )

    args = parser.parse_args()
    log.info(args)

    service = PySpeechRecognition(args.id)
    service.setSpeechRecognizer(args.recognizer)
    service.setMicrophone(8)
    service.startListening()
    service.connect(args.connect)
    service.startService()
    # service.startListening()


if __name__ == "__main__":
    main()
