import { execSync } from "child_process"
import mic from "mic"
import os from "os"
import wav from "wav"
import { getLogger } from "../framework/Log"
import Service from "../framework/Service"

const log = getLogger("Microphone")

interface MicrophoneConfig {
  mic: string
  recording: boolean
}

/**
 * @class Microphone
 * @extends Service
 * @description A service that provides microphone and streaming audio functionality
 */
export default class Microphone extends Service {
  /**
   * @property {MicrophoneConfig} config - The configuration for the microphone service.
   */
  config: MicrophoneConfig = {
    mic: "",
    recording: false
  }

  micInstance: any = null

  microphoneList: string[] = []

  /**
   * Creates an instance of Microphone.
   * @param {string} id - The unique identifier for the service.
   * @param {string} name - The name of the service.
   * @param {string} typeKey - The type key of the service.
   * @param {string} version - The version of the service.
   * @param {string} hostname - The hostname of the service.
   */
  constructor(
    public id: string,
    public name: string,
    public typeKey: string,
    public version: string,
    public hostname: string
  ) {
    super(id, name, typeKey, version, hostname)
  }

  /**
   * Serializes the Microphone instance to JSON.
   * Excludes intervalId from serialization.
   * @returns {object} The serialized Microphone instance.
   */
  toJSON() {
    return {
      ...super.toJSON(),
      config: this.config,
      microphoneList: this.microphoneList
    }
  }

  /**
   * Lists available microphones.
   * @returns {string[]} The list of available microphones.
   */
  listMicrophones(): string[] {
    const platform = os.platform()
    let listCommand: string[]

    if (platform === "linux") {
      listCommand = ["-l"]
    } else if (platform === "win32") {
      listCommand = ["powershell", "-Command", 'Get-PnpDevice | Where-Object { $_.Class -eq "AudioEndpoint" }']
    } else if (platform === "darwin") {
      log.info("Listing microphones on macOS is not directly supported by a single command.")
      return []
    } else {
      return []
    }

    try {
      const output = execSync(`arecord ${listCommand.join(" ")}`).toString()
      this.microphoneList = this.parseMicrophoneList(output)
      return this.microphoneList
    } catch (error: any) {
      log.error(`Error listing microphones: ${error.message}`)
      return []
    }
  }

  /**
   * Parses the output of arecord -l and converts it to a list of microphone devices.
   * @param {string} output - The output of the arecord -l command.
   * @returns {string[]} The list of ALSA device strings.
   */
  parseMicrophoneList(output: string): string[] {
    const lines = output.split("\n")
    const devices: string[] = []

    let currentCard = -1
    lines.forEach((line) => {
      const cardMatch = line.match(/^card (\d+):/)
      if (cardMatch) {
        currentCard = parseInt(cardMatch[1], 10)
      }

      const deviceMatch = line.match(/device (\d+):/)
      if (deviceMatch && currentCard !== -1) {
        const device = parseInt(deviceMatch[1], 10)
        devices.push(`plughw:${currentCard},${device}`)
      }
    })

    return devices
  }

  /**
   * Stops the current recording.
   */
  stopRecording() {
    if (this.config.recording) {
      if (this.micInstance) {
        this.micInstance.stop()
      }
      this.config.recording = false
      log.info("Recording stopped.")
    } else {
      log.error("No active recording to stop.")
    }
  }

  /**
   * Starts recording from the selected microphone.
   */
  startRecording() {
    if (!this.config.mic) {
      log.error("No microphone selected.")
      return
    }

    this.micInstance = mic({
      rate: "16000",
      channels: "1",
      debug: true,
      exitOnSilence: 6,
      device: this.config.mic
    })

    const micInputStream = this.micInstance.getAudioStream()

    const outputFileStream = new wav.FileWriter("output.wav", {
      sampleRate: 16000,
      channels: 1
    })

    // FIXME - pipe it to STT
    micInputStream.pipe(outputFileStream)

    micInputStream.on("data", (data: any) => {
      log.info("Received Input Stream: " + data.length)
    })

    micInputStream.on("error", (err: any) => {
      log.info("Error in Input Stream: " + err)
    })

    micInputStream.on("startComplete", () => {
      log.info("Got SIGNAL startComplete")
    })

    micInputStream.on("stopComplete", () => {
      log.info("Got SIGNAL stopComplete")
    })

    micInputStream.on("pauseComplete", () => {
      log.info("Got SIGNAL pauseComplete")
    })

    micInputStream.on("resumeComplete", () => {
      log.info("Got SIGNAL resumeComplete")
    })

    micInputStream.on("silence", () => {
      log.info("Got SIGNAL silence")
    })

    micInputStream.on("processExitComplete", () => {
      log.info("Got SIGNAL processExitComplete")
    })

    this.micInstance.start()

    this.config.recording = true

    // Stop recording after 5 seconds
    // setTimeout(() => {
    //   micInstance.stop()
    //   this.config.recording = false
    // }, 5000);
  }

  /**
   * Selects a microphone to be used.
   * @param {string} mic - The identifier of the microphone to select.
   */
  selectMicrophone(mic: string) {
    this.config.mic = mic
    log.info(`Microphone selected: ${mic}`)
  }
}
