import argparse
import os
import importlib
import uuid
import urllib.request
import time
import asyncio
import logging
from time import sleep
from concurrent.futures import ThreadPoolExecutor
from rlx_pkg_proxy.service import Service
from typing import List
import pyaudio
import wave

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("PyAudio")


class PyAudio(Service):
    def __init__(self, id=uuid.uuid1()):
        super().__init__(id)
        self.id: str = id

        self.recording: bool = False
        self.paused: bool = False
        self.config = {"mic": "", "recording": False, "paused": False}

        self.audio = pyaudio.PyAudio()
        self.stream = None
        self.frames = []
        self.current_mic_index = None
        self.output_filename = "output.wav"
        self.mics = {}

    def list_microphones(self):
        info = self.audio.get_host_api_info_by_index(0)
        numdevices = info.get("deviceCount")
        mics = {}
        for i in range(0, numdevices):
            if (
                self.audio.get_device_info_by_host_api_device_index(0, i).get(
                    "maxInputChannels"
                )
                > 0
            ):
                self.mics[i] = self.audio.get_device_info_by_host_api_device_index(
                    0, i
                ).get("name")
        return mics

    def set_microphone(self, mic: int):
        self.config["mic"] = mic
        self.current_mic_index = mic

    def start_recording(self, duration=5, output_filename="output.wav"):
        if self.current_mic_index is None:
            log.error("No microphone set. Use set_microphone() to set a microphone.")
            return

        self.config["recording"] = True
        self.output_filename = output_filename
        self.frames = []

        self.stream = self.audio.open(
            format=pyaudio.paInt16,
            channels=1,
            rate=44100,
            input=True,
            input_device_index=self.current_mic_index,
            frames_per_buffer=1024,
        )

        log.info("Recording...")
        for _ in range(0, int(44100 / 1024 * duration)):
            data = self.stream.read(1024)
            # self.frames.append(data)

        log.info("Finished recording.")
        self.stop_recording()

    def stop_recording(self):
        if self.stream is not None:
            self.stream.stop_stream()
            self.stream.close()
            self.stream = None

            with wave.open(self.output_filename, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(self.audio.get_sample_size(pyaudio.paInt16))
                wf.setframerate(44100)
                wf.writeframes(b"".join(self.frames))

            log.info(f"Audio saved as {self.output_filename}")
        self.config["recording"] = False

    def pause_recording(self):
        if self.recording and not self.paused:
            self.paused = True
            self.config["paused"] = True
            log.info("Recording paused.")

    def resume_recording(self):
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
    cv.connect(args.connect)
    cv.set_service(cv)
    cv.start_service()


if __name__ == "__main__":
    main()
