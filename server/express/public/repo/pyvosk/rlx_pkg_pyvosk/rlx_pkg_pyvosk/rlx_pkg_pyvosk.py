import argparse
import logging
import threading
import uuid
from time import sleep
import traceback
import sounddevice as sd
from vosk import Model, KaldiRecognizer, list_languages

from rlx_pkg_proxy.service import Service
from collections import deque
import requests
from io import BytesIO

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("PyVosk")

# start debug proxy
# python -u rlx_pkg_pyvosk.py -i sr1 -c http://localhost:3001

# Stand-In Replacement Console Proxy Debugging
#
# Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like '*proxy.py*' } | Select-Object ProcessId, CommandLine
# Stop-Process -Id 1234 -Force
# cd server\express\public\repo\pyvosk
# source .\.venv\Scripts\Activate.ps1
# cd server\express\public\repo\pyvosk\rlx_pkg_pyvosk\rlx_pkg_pyvosk
# python -u rlx_pkg_pyvosk.py -i sr1 -c http://localhost:3001


# on Linux FIXME


class PyVosk(Service):
    def __init__(self, id=uuid.uuid1()):
        super().__init__(id)
        self.id: str = str(id)
        # self.recognizer = sr.Recognizer()
        # self.microphone = sr.Microphone()
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
            "rate": None,
        }
        # list of available microphones
        self.mics = {}
        # self.audio = pyaudio.PyAudio()
        self.segment_cnt = 0

    def getMicrophones(self):
        log.info("Getting microphones")
        try:

            # Get a list of all available audio input devices
            devices = sd.query_devices()

            # Filter and print only input devices (microphones)
            input_devices = [
                device for device in devices if device["max_input_channels"] > 0
            ]

            # Clear mics
            self.mics = {}
            print("Available microphones:")
            for idx, device in enumerate(input_devices):
                print(f"{idx}: {device['name']} (ID: {device['index']})")
                self.mics[idx] = f"{idx}: {device['name']}"

            log.info(f"Found {len(input_devices)} mics")
            return self.mics
            # return mics
        except Exception as e:
            log.error(f"Error getting microphones: {e}")
            return {}

    def listen(self):
        try:
            # with self.microphone as source:
            #     while self.listening:
            #         log.info("Listening for speech...")
            #         # audio = self.recognizer.listen(source)
            #         log.info("Captured audio, attempting to recognize speech...")
            #         self.segment_cnt += 1
            #         # Save the audio to a file
            #         if self.config.get("saveAudio"):
            #             pass
            #             # with open(
            #             #     "segement_" + str(self.segment_cnt) + ".wav", "wb"
            #             # ) as f:
            #             #     f.write(audio.get_wav_data())

            #         try:
            #             # text = self.recognize_speech(audio)
            #             log.info(f"Recognized text:")
            #             # log.info(f"Recognized text: {text}")
            #             # self.invoke("publishText", text)
            #         except Exception as e:
            #             log.error(
            #                 f"Could not request results from Speech Recognition service; {e}"
            #             )
            #             log.error(traceback.format_exc())
            sleep(0.1)

        except Exception as e:
            log.error(f"Error in listen method: {e}")

    def publishText(self, text: str) -> str:
        """
        FIXME - make an interface for this
        Publishes the current text to the service."""
        log.info(f"publishText {text}")
        return text

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

        # set sample rate
        device_info = sd.query_devices(self.config["mic"], "input")
        # soundfile expects an int, sounddevice provides a float:
        self.config["rate"] = int(device_info["default_samplerate"])

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

    def setMicrophone(self, index):
        log.info(f"Setting microphone to index {index}")
        self.config["mic"] = index
        log.info(f"Setting microphone to {self.config['mic']}")
        # self.microphone = sr.Microphone(device_index=int(index))
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
        log.info("Starting PyVosk service...")
        self.getMicrophones()
        if self.config.get("listen"):
            self.startListening()
        super().startService()
        # BE AWARE - this coroutine super.startService() blocks forever


def main():
    # Debug with proxy
    # cd ~/mrl/robotlab-x/server/express/public/repo/pyvosk/rlx_pkg_pyvosk/rlx_pkg_pyvosk
    # python -u rlx_pkg_pyvosk.py -i sr3 -c http://localhost:3001

    parser = argparse.ArgumentParser(description="PyVosk Service")
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

    service = PyVosk(args.id)
    # service.setSpeechRecognizer(args.recognizer)
    # service.setMicrophone(8)
    # service.startListening()
    service.connect(args.connect)
    service.startService()
    # service.startListening()


if __name__ == "__main__":
    main()
