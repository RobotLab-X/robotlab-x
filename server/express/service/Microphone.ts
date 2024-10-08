import { execSync } from "child_process"
import mic from "mic"
import os from "os"
import wav from "wav"
import { getLogger } from "../framework/LocalLog"
import Service from "../framework/Service"

const log = getLogger("Microphone")

interface MicrophoneConfig {
  mic: string
  recording: boolean
  paused: boolean
}

/**
 * @class Microphone
 * @extends Service
 * @description A service that provides microphone and streaming audio functionality
 */
export default class Microphone extends Service {
  config: MicrophoneConfig = {
    mic: "",
    recording: false,
    paused: false
  }

  micInstance: any = null
  mics: { [key: string]: string } = {}

  constructor(
    public id: string,
    public name: string,
    public typeKey: string,
    public version: string,
    public hostname: string
  ) {
    super(id, name, typeKey, version, hostname)
  }

  toJSON() {
    return {
      ...super.toJSON(),
      config: this.config,
      mics: this.mics
    }
  }

  getMicrophones(): { [key: string]: string } {
    const platform = os.platform()
    let listCommand: string[]

    if (platform === "linux") {
      listCommand = ["arecord", "-l"]
    } else if (platform === "win32") {
      listCommand = ["powershell", "-Command", 'Get-PnpDevice | Where-Object { $_.Class -eq "AudioEndpoint" }']
    } else if (platform === "darwin") {
      listCommand = ["system_profiler", "SPAUDIODataType"]
    } else {
      log.info(`Unsupported platform: ${platform}`)
      return {}
    }

    try {
      const command = platform === "linux" ? listCommand.join(" ") : listCommand.join(" ")
      const output = execSync(command).toString()
      this.mics = this.parseMicrophoneList(output, platform)
      return this.mics
    } catch (error: any) {
      log.error(`Error listing microphones: ${error.message}`)
      return {}
    }
  }

  parseMicrophoneList(output: string, platform: string): { [key: string]: string } {
    const devices: { [key: string]: string } = {}

    if (platform === "linux") {
      const lines = output.split("\n")
      let currentCard: string | null = null
      lines.forEach((line) => {
        const cardMatch = line.match(/^card (\d+): (.*)/)
        if (cardMatch) {
          currentCard = cardMatch[0].trim() // entire card line
        }

        const deviceMatch = line.match(/device (\d+): (.*)/)
        if (deviceMatch && currentCard) {
          const device = parseInt(deviceMatch[1], 10)
          const description = deviceMatch[2].trim()
          devices[`plughw:${cardMatch[1]},${device}`] =
            `plughw:${cardMatch[1]},${device}: card ${cardMatch[1]}, device${device} - ${currentCard}`
        }
      })
    } else if (platform === "win32") {
      const lines = output.split("\n")
      lines.forEach((line) => {
        const match = line.match(/FriendlyName\s*:\s*(.*)/)
        if (match) {
          const key = match[1].trim()
          devices[key] = key
        }
      })
    } else if (platform === "darwin") {
      const lines = output.split("\n")
      let currentMic = ""
      lines.forEach((line) => {
        if (line.includes("Input Device: Yes")) {
          currentMic = line.trim()
        } else if (currentMic && line.includes("Device Input Level:")) {
          devices[currentMic] = currentMic
          currentMic = ""
        }
      })
    }

    return devices
  }

  startService() {
    super.startService()
    this.getMicrophones()
    if (this.config.recording) {
      this.startRecording()
    }
  }

  stopRecording() {
    if (this.config.recording) {
      if (this.micInstance) {
        // I think it needs to resume before it can be stopped
        if (this.config.paused) {
          this.info("Resuming recording to stop")
          this.micInstance.resume()
        }
        this.info("Stopping recording")
        this.micInstance.stop()
      }
      this.config.recording = false
      log.info("Recording stopped.")
      this.invoke("broadcastState")
    } else {
      log.error("No active recording to stop.")
    }
  }

  pauseRecording() {
    if (this.config.recording) {
      if (this.micInstance) {
        this.micInstance.pause()
      }
      log.info("Recording paused.")
      this.invoke("broadcastState")
    } else {
      log.info("No active recording to pause.")
    }
    if (!this.config.paused) {
      // state change to paused
      this.config.paused = true
      this.invoke("broadcastState")
    }
  }

  resumeRecording() {
    if (this.config.recording) {
      if (this.micInstance) {
        this.micInstance.resume()
      }
      log.info("Recording resumed.")
      this.invoke("broadcastState")
    } else {
      log.info("No active recording to resume.")
    }
    if (this.config.paused) {
      // state change to unpaused
      this.config.paused = false
      this.invoke("broadcastState")
    }
  }

  startRecording() {
    if (!this.config.mic) {
      log.error("No microphone selected.")
      return
    }

    this.info(`Starting recording from ${this.config.mic}`)

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

    if (this.config.paused) {
      log.info("Starting as paused")
      this.micInstance.pause()
    }

    this.config.recording = true
    this.invoke("broadcastState")
  }

  setMicrophone(mic: string) {
    this.config.mic = mic
    log.info(`Microphone selected: ${mic}`)
    this.invoke("broadcastState")
  }
}
