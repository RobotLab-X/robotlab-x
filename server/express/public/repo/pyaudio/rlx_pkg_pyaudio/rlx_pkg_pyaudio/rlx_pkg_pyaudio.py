import argparse
import logging
import threading
import uuid
from time import sleep
import pyaudio
import wave
from rlx_pkg_proxy.service import Service
from collections import deque
import requests
from io import BytesIO

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("PyAudio")


class PyAudio(Service):
    def __init__(self, id=uuid.uuid1()):
        super().__init__(id)
        self.id: str = str(id)

        self.recording: bool = False
        self.paused: bool = False
        self.config = {"mic": "", "recording": False, "paused": False}

        self.audio = pyaudio.PyAudio()
        self.stream = None
        self.frames = deque(maxlen=512)  # Fixed-size buffer for frames
        self.output_filename = "output.wav"
        self.mics = {}
        self.recording_thread = None

    def getMicrophones(self):
        log.info("Getting microphones")
        try:
            info = self.audio.get_host_api_info_by_index(0)
            numdevices = info.get("deviceCount")
            mics = {}
            for i in range(0, numdevices):
                device_info = self.audio.get_device_info_by_host_api_device_index(0, i)
                if device_info.get("maxInputChannels") > 0:
                    mics[i] = device_info.get("name")
            self.mics = mics
            log.info(f"Found {len(self.mics)} mics")
            return mics
        except Exception as e:
            log.error(f"Error getting microphones: {e}")
            return {}

    def setMicrophone(self, mic: int):
        self.config["mic"] = mic
        log.info(f"Setting microphone to {self.config['mic']}")
        self.invoke("broadcastState")

    def startRecording(self, output_filename="output.wav"):
        if not self.config["mic"]:
            log.error("No microphone set. Use setMicrophone(int) to set a microphone.")
            return

        log.info(f"Starting mic: {self.config['mic']} recording")
        self.config["recording"] = True
        self.output_filename = output_filename
        self.frames.clear()

        self.stream = self.audio.open(
            format=pyaudio.paInt16,
            channels=1,
            rate=44100,
            input=True,
            input_device_index=int(self.config["mic"]),
            frames_per_buffer=1024,
        )

        log.info("Recording...")
        self.recording = True
        self.recording_thread = threading.Thread(target=self._record)
        self.recording_thread.start()
        self.invoke("broadcastState")

    def _record(self):
        while self.recording:
            if self.paused:
                log.info("Recording paused, waiting to resume...")
                while self.paused and self.recording:
                    sleep(0.1)
                if not self.recording:
                    break
            try:
                data = self.stream.read(1024, exception_on_overflow=False)
                self.frames.append(data)
            except OSError as e:
                log.warning(f"Input overflowed: {e}")
                continue

    def stopRecording(self):
        log.info("Stopping recording...")
        self.recording = False
        if self.recording_thread is not None:
            self.recording_thread.join()

        if self.stream is not None:
            try:
                self.stream.stop_stream()
            except OSError:
                log.warning("Stream was already stopped.")
            try:
                self.stream.close()
            except OSError:
                log.warning("Stream was already closed.")
            self.stream = None

        self.config["recording"] = False
        self.recording = False
        self.invoke("broadcastState")

    def saveToFile(self):
        try:
            with wave.open(self.output_filename, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(self.audio.get_sample_size(pyaudio.paInt16))
                wf.setframerate(44100)
                wf.writeframes(b"".join(self.frames))
            log.info(f"Audio saved as {self.output_filename}")
        except Exception as e:
            log.error(f"Failed to save audio file: {e}")

    def loadFromFile(self, input_filename):
        try:
            with wave.open(input_filename, "rb") as wf:
                self.frames.clear()
                n_channels = wf.getnchannels()
                samp_width = wf.getsampwidth()
                frame_rate = wf.getframerate()
                if (
                    n_channels != 1
                    or samp_width != self.audio.get_sample_size(pyaudio.paInt16)
                    or frame_rate != 44100
                ):
                    log.error("Unsupported audio format")
                    return

                while True:
                    data = wf.readframes(1024)
                    if not data:
                        break
                    self.frames.append(data)

            log.info(f"Audio loaded from {input_filename}")
        except Exception as e:
            log.error(f"Failed to load audio file: {e}")

    def sendToASR(self, save_to_file=False):
        if save_to_file:
            self.saveToFile()

        try:
            # Prepare the WAV data in memory
            wav_buffer = BytesIO()
            with wave.open(wav_buffer, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(self.audio.get_sample_size(pyaudio.paInt16))
                wf.setframerate(44100)
                wf.writeframes(b"".join(self.frames))

            wav_buffer.seek(0)

            # Send the WAV data to the ASR endpoint
            files = {"file": ("output.wav", wav_buffer, "audio/wav")}
            response = requests.post("http://localhost:9000/asr", files=files)

            if response.status_code == 200:
                log.info("Audio successfully sent to ASR endpoint.")
                return response.json()
            else:
                log.error(
                    f"Failed to send audio to ASR endpoint: {response.status_code} {response.text}"
                )
                return None
        except Exception as e:
            log.error(f"Failed to send audio to ASR endpoint: {e}")
            return None

    def pauseRecording(self):
        if self.recording and not self.paused:
            self.paused = True
            self.config["paused"] = True
            log.info("Recording paused.")
            self.invoke("broadcastState")

    def resumeRecording(self):
        if self.recording and self.paused:
            self.paused = False
            self.config["paused"] = False
            log.info("Recording resumed.")
            self.invoke("broadcastState")

    def releaseService(self):
        """Releases the service from the proxied runtime
        Will shutdown our capture and websocket and coroutines
        """
        log.info("Releasing service")
        self.stopRecording()
        self.audio.terminate()
        super().releaseService()

    def to_dict(self):
        base_dict = super().to_dict()
        derived = {
            "mics": self.mics,
            "recording": self.recording,
            "paused": self.paused,
        }
        base_dict.update(derived)
        return base_dict

    def startService(self):
        log.info("Starting PyAudio service...")
        self.getMicrophones()
        super().startService()
        # BE AWARE - this coroutine super.startService() blocks forever


def main():
    parser = argparse.ArgumentParser(description="PyAudio Service")
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

    args = parser.parse_args()
    print(args)

    service = PyAudio(args.id)
    service.connect(args.connect)
    service.startService()


if __name__ == "__main__":
    main()
