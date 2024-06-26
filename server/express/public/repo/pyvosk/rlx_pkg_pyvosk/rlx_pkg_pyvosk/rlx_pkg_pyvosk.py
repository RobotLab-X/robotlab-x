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
import queue

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

q = queue.Queue()


def callback(indata, frames, time, status):
    """This is called (from a separate thread) for each audio block."""
    if status:
        log.error(status)
    q.put(bytes(indata))


class PyVosk(Service):
    def __init__(self, id=uuid.uuid1()):
        super().__init__(id)
        self.id = str(id)
        self.listening = False  # the "state" of the listening
        self.paused = False
        self.thread = None
        self.config = {
            "mic": "",
            "listen": False,  # the "command" to listen on startup
            "saveAudio": True,
            "rate": None,
            "language": "en-us",  # Default model
        }
        self.mics = {}
        self.segment_cnt = 0
        self.rec = None  # Vosk recognizer

    def getMicrophones(self):
        log.info("Getting microphones")
        try:
            devices = sd.query_devices()
            input_devices = [
                device for device in devices if device["max_input_channels"] > 0
            ]

            self.mics = {}
            print("Available microphones:")
            for idx, device in enumerate(input_devices):
                print(f"{idx}: {device['name']} (ID: {device['index']})")
                self.mics[idx] = f"{idx}: {device['name']}"

            log.info(f"Found {len(input_devices)} mics")
            return self.mics
        except Exception as e:
            log.error(f"Error getting microphones: {e}")
            return {}

    def listen(self):
        try:
            model = Model(lang=self.config["language"])
            self.rec = KaldiRecognizer(model, self.config["rate"])
            with sd.RawInputStream(
                samplerate=self.config["rate"],
                blocksize=8000,
                device=self.config["mic"],
                dtype="int16",
                channels=1,
                callback=callback,
            ):
                while self.listening:
                    if self.paused:
                        sleep(0.1)
                        continue
                    data = q.get()
                    if self.rec.AcceptWaveform(data):
                        result = self.rec.Result()
                        log.info(f"Recognized text: {result}")
                        self.invoke("publishText", result)
                    else:
                        # log.info(f"Partial result: {self.rec.PartialResult()}")
                        pass
                    sleep(0.1)
        except Exception as e:
            log.error(f"Error in listen method: {e}")

    def publishText(self, text: str) -> str:
        log.info(f"publishText {text}")
        # You can implement the actual publishing logic here
        return text

    def startListening(self):
        log.info("Start Listening")
        device_info = sd.query_devices(self.config["mic"], "input")
        self.config["rate"] = int(device_info["default_samplerate"])

        if self.thread is None:
            self.listening = True
            self.thread = threading.Thread(target=self.listen)
            self.thread.start()
        self.invoke("broadcastState")

    def pauseListening(self):
        log.info("Pause Listening")
        self.paused = True
        self.invoke("broadcastState")

    def resumeListening(self):
        log.info("Resume Listening")
        self.paused = False
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
        self.invoke("broadcastState")

    def to_dict(self):
        base_dict = super().to_dict()
        derived = {
            "listening": self.listening,
            "mics": self.mics,
            "paused": self.paused,
        }
        base_dict.update(derived)
        return base_dict

    def startService(self):
        log.info("Starting PyVosk service...")
        self.getMicrophones()
        if self.config.get("listen"):
            self.startListening()
        super().startService()


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
