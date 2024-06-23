import argparse
import logging
import uuid
from time import sleep
import pyaudio
import wave
from rlx_pkg_proxy.service import Service

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
        self.frames = []
        self.output_filename = "output.wav"
        self.mics = {}

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

    def startRecording(self, duration=5, output_filename="output.wav"):
        if self.config["mic"] is None:
            log.error("No microphone set. Use setMicrophone(int) to set a microphone.")
            return

        log.info(f"Starting mic: {self.config['mic']} recording for {duration} seconds")

        self.config["recording"] = True
        self.output_filename = output_filename
        self.frames = []

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
        for _ in range(0, int(44100 / 1024 * duration)):
            if self.paused:
                log.info("Recording paused, waiting to resume...")
                while self.paused:
                    sleep(0.1)
            data = self.stream.read(1024)
            self.frames.append(data)

        # log.info("Finished recording.")
        # self.stopRecording()

    def stopRecording(self):
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

            try:
                with wave.open(self.output_filename, "wb") as wf:
                    wf.setnchannels(1)
                    wf.setsampwidth(self.audio.get_sample_size(pyaudio.paInt16))
                    wf.setframerate(44100)
                    wf.writeframes(b"".join(self.frames))
                log.info(f"Audio saved as {self.output_filename}")
            except Exception as e:
                log.error(f"Failed to save audio file: {e}")

        self.config["recording"] = False
        self.recording = False

    def pauseRecording(self):
        if self.recording and not self.paused:
            self.paused = True
            self.config["paused"] = True
            log.info("Recording paused.")

    def resumeRecording(self):
        if self.recording and self.paused:
            self.paused = False
            self.config["paused"] = False
            log.info("Recording resumed.")

    def releaseService(self):
        """Releases the service from the proxied runtime
        Will shutdown our capture and websocket and coroutines
        """
        print("Releasing service")
        if self.stream is not None:
            self.stream.stop_stream()
            self.stream.close()
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

    cv = PyAudio(args.id)
    # cv.connect(args.connect)
    cv.startService()


if __name__ == "__main__":
    main()
