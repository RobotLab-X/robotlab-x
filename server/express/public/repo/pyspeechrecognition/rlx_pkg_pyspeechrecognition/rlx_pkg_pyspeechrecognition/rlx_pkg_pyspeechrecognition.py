import argparse
import logging
import threading
import uuid
from time import sleep
import traceback
import pyaudio

# from zstandard import backend
import speech_recognition as sr
from rlx_pkg_proxy.service import Service
from collections import deque
import requests
from io import BytesIO

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("PySpeechRecognition")

# start debug proxy
# python -u rlx_pkg_pyspeechrecognition.py -i sr1 -c http://localhost:3001

# Stand-In Replacement Console Proxy Debugging
#
# Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like '*proxy.py*' } | Select-Object ProcessId, CommandLine
# Stop-Process -Id 1234 -Force
# cd server\express\public\repo\pyspeechrecognition
# source .\.venv\Scripts\Activate.ps1
# cd server\express\public\repo\pyspeechrecognition\rlx_pkg_pyspeechrecognition\rlx_pkg_pyspeechrecognition
# python -u rlx_pkg_pyspeechrecognition.py -i sr1 -c http://localhost:3001


# on Linux FIXME

class PySpeechRecognition(Service):
    def __init__(self, id=uuid.uuid1()):
        super().__init__(id)
        self.id: str = str(id)
        self.recognizer = sr.Recognizer()
        self.microphone = sr.Microphone()
        self.listening = False  # the "state" of the listening
        self.thread = None
        self.config = {
            "mic": "",
            "listen": False,  # the "command" to listen on startup
            "paused": False,
            "backend": "google",
            "user": None,
            "key": None,
            "location": None,
            "saveAudio": True,
        }
        # list of available microphones
        self.mics = {}
        self.audio = pyaudio.PyAudio()
        self.segment_cnt = 0

    def getMicrophones(self):
        log.info("Getting microphones")
        try:
            info = self.audio.get_host_api_info_by_index(0)
            numdevices = info.get("deviceCount")
            mics = {}
            for i in range(0, numdevices):
                device_info = self.audio.get_device_info_by_host_api_device_index(0, i)
                if device_info.get("maxInputChannels") > 0:
                    mics[i] = f"{i}: {device_info.get('name')}"
            self.mics = mics
            log.info(f"Found {len(self.mics)} mics")
            return mics
        except Exception as e:
            log.error(f"Error getting microphones: {e}")
            return {}

    def listen(self):
        try:
            with self.microphone as source:
                while self.listening:
                    log.info("Listening for speech...")
                    audio = self.recognizer.listen(source)
                    log.info("Captured audio, attempting to recognize speech...")
                    self.segment_cnt += 1
                    # Save the audio to a file
                    if self.confg.get("saveAudio"):
                        with open(
                            "segement_" + str(self.segment_cnt) + ".wav", "wb"
                        ) as f:
                            f.write(audio.get_wav_data())

                    try:
                        text = self.recognize_speech(audio)
                        log.info(f"Recognized text: {text}")
                        self.invoke("publishText", text)
                    except sr.UnknownValueError:
                        log.warning("Speech Recognition could not understand audio")
                    except Exception as e:
                        log.error(
                            f"Could not request results from Speech Recognition service; {e}"
                        )
                        log.error(traceback.format_exc())
                    sleep(0.1)

        except Exception as e:
            log.error(f"Error in listen method: {e}")

    def publishText(self, text: str) -> str:
        """
        FIXME - make an interface for this
        Publishes the current text to the service."""
        log.info(f"publishText {text}")
        return text

    def recognize_speech(self, audio):
        backend = self.config["backend"]
        log.info(f"Using {backend} recognizer")
        if backend == "google":
            return self.recognizer.recognize_google(audio)
        elif backend == "sphinx":
            return self.recognizer.recognize_sphinx(audio)
        elif backend == "ibm":
            return self.recognizer.recognize_ibm(
                audio, username=self.config.get("user"), password=self.config.get("key")
            )
        elif backend == "bing":
            return self.recognizer.recognize_bing(audio, key="YOUR_BING_KEY")
        elif backend == "houndify":
            return self.recognizer.recognize_houndify(
                audio,
                client_id=self.config.get("user"),
                client_key=self.config.get("key"),
            )
        elif backend == "wit":
            return self.recognizer.recognize_wit(audio, key=self.config.get("key"))
        elif backend == "azure":
            return self.recognizer.recognize_azure(
                audio, key=self.config.get("key"), location=self.config.get("location")
            )
        elif backend == "google_cloud":
            return self.recognizer.recognize_google_cloud(
                audio, credentials_json=self.config.get("key")
            )
        elif backend == "vosk":
            return self.recognizer.recognize_vosk(audio)
        elif backend == "whisper":
            return self.recognizer.recognize_whisper(audio)
        elif backend == "whisper_api":
            return self.recognizer.recognize_whisper_api(
                audio, api_key=self.config.get("key")
            )
        else:
            raise ValueError("Unsupported recognizer backend")

    def setApiUser(self, user):
        log.info(f"Set API User to {user}")
        self.config["user"] = user
        # self.invoke("broadcastState")

    def setApiLocation(self, location):
        log.info(f"Set API Location to {location}")
        self.config["location"] = location
        # self.invoke("broadcastState")

    def setApiKey(self, key):
        log.info(f"Set API Key to {key}")
        self.config["key"] = key
        # self.invoke("broadcastState")

    def startListening(self):
        log.info("Start Listening")
        if self.thread is None:
            self.thread = threading.Thread(target=self.listen)
            self.thread.start()
        self.listening = True
        self.invoke("broadcastState")

    def stopListening(self):
        log.info("Stop Listening")
        self.listening = False
        if self.thread is not None:
            self.thread.join()
            self.thread = None
        self.invoke("broadcastState")

    def setBackend(self, backend):
        log.info(f"Set Speech Recognizer to {backend}")
        self.config["backend"] = backend
        self.invoke("broadcastState")

    def listMicrophones(self):
        mic_list = sr.Microphone.list_microphone_names()
        for i, mic_name in enumerate(mic_list):
            log.info(f"Microphone {i}: {mic_name}")
        return mic_list

    def setMicrophone(self, index):
        log.info(f"Setting microphone to index {index}")
        self.config["mic"] = index
        log.info(f"Setting microphone to {self.config['mic']}")
        self.microphone = sr.Microphone(device_index=int(index))
        self.invoke("broadcastState")

    def to_dict(self):
        base_dict = super().to_dict()
        derived = {
            "listening": self.listening,
            "mics": self.mics,
        }
        base_dict.update(derived)
        return base_dict

    def startService(self):
        log.info("Starting PySpeechRecognition service...")
        self.getMicrophones()
        if self.config.get("listen"):
            self.startListening()
        super().startService()
        # BE AWARE - this coroutine super.startService() blocks forever


def main():
    # Debug with proxy
    # cd ~/mrl/robotlab-x/server/express/public/repo/pyspeechrecognition/rlx_pkg_pyspeechrecognition/rlx_pkg_pyspeechrecognition
    # python -u rlx_pkg_pyspeechrecognition.py -i sr3 -c http://localhost:3001

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
    # service.setSpeechRecognizer(args.recognizer)
    # service.setMicrophone(8)
    # service.startListening()
    service.connect(args.connect)
    service.startService()
    # service.startListening()


if __name__ == "__main__":
    main()
