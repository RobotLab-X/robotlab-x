import argparse
import logging
import threading
import json
import uuid
from time import sleep
import traceback

import aiml
import time

from rlx_pkg_proxy.service import Service
from collections import deque
import requests
from io import BytesIO
import queue

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("PyAIML")

# start debug proxy
# python -u rlx_pkg_pyaiml.py -i sr1 -c http://localhost:3001

# Stand-In Replacement Console Proxy Debugging
#
# Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like '*proxy.py*' } | Select-Object ProcessId, CommandLine
# Stop-Process -Id 1234 -Force
# cd server\express\public\repo\pyaiml
# source .\.venv\Scripts\Activate.ps1
# cd server\express\public\repo\pyaiml\rlx_pkg_pyaiml\rlx_pkg_pyaiml
# python -u rlx_pkg_pyaiml.py -i sr1 -c http://localhost:3001


class PyAIML(Service):
    def __init__(self, id=uuid.uuid1()):
        super().__init__(id)

        self.config = {
            "chatbot": "example",
        }
        self.kernel = aiml.Kernel()

    def chat(self, text: str):
        try:
            log.info(f"chat {text}")
            msg = self.kernel.respond(text)
            response = {
                "ts": int(time.time()),
                "msg": msg,
                "src": self.fullname,
            }
            # TODO - model response
            self.invoke("publishResponse", response)
            self.invoke("publishChat", response)
            self.invoke("publishText", msg)
            return response
        except Exception as e:
            log.error(f"Error chat: {e}")
            return {}

    def publishResponse(self, response: str) -> str:
        log.info(f"publishResponse {response}")
        # TODO - model response
        return response

    def loadFile(self, aimlFile: str):
        log.info(f"loadFile {aimlFile}")
        self.kernel.learn(aimlFile)

    def publishText(self, text: str) -> str:
        log.info(f"publishText {text}")
        # You can implement the actual publishing logic here
        return text

    def to_dict(self):
        base_dict = super().to_dict()
        derived = {}
        base_dict.update(derived)
        return base_dict

    def startService(self):
        log.info("Starting PyAIML service...")
        super().startService()


def main():
    # Debug with proxy
    # cd ~/mrl/robotlab-x/server/express/public/repo/pyaiml/rlx_pkg_pyaiml/rlx_pkg_pyaiml
    # python -u rlx_pkg_pyaiml.py -i sr3 -c http://localhost:3001

    parser = argparse.ArgumentParser(description="PyAIML Service")
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

    service = PyAIML(args.id)
    # service.setSpeechRecognizer(args.recognizer)
    # service.setMicrophone(8)
    # service.startListening()
    service.connect(args.connect)
    service.startService()
    # service.startListening()


if __name__ == "__main__":
    main()
