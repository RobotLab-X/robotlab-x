import { PollyClient, SynthesizeSpeechCommand, SynthesizeSpeechCommandInput } from "@aws-sdk/client-polly"
import crypto from "crypto"
import fs from "fs"
import path from "path"
import { Readable } from "stream"
import Main from "../../electron/ElectronStarter"
import { getLogger } from "../framework/Log"
import Service from "../framework/Service"
// const load = require("audio-loader")
// const play = require("audio-play")
// const { createAudio } = require("node-mp3-player")
// const Audio = createAudio()

const log = getLogger("Polly")

/**
 * @class Polly
 * @extends Service
 * @description A service that provides polly functionality, periodically publishing the current epoch time.
 */
export default class Polly extends Service {
  /**
   * @property {ClockConfig} config - The configuration for the polly service.
   */
  config = {
    voice: "Joanna",
    secretAccessKey: null as string,
    secretId: null as string,
    format: "mp3" as "mp3" | "ogg" | "pcm"
  }

  client: PollyClient | null = null

  /**
   * Creates an instance of Polly.
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

  startService() {
    super.startService()
    if (!this.config.secretAccessKey || !this.config.secretId) {
      log.info(`Polly.startService: Missing secretAccessKey or secretId`)
      this.ready = false
    }
  }

  publishSpeaking(text: string): string {
    log.info(`Polly.publishSpeaking: ${text}`)
    return text
  }

  onText(text: string): void {
    log.info(`Polly.onPublishText: ${text}`)
    this.speak(text)
  }

  async speak(text: string) {
    log.info(`Polly.speak: ${text}`)

    // Trim the text and generate a hash
    const trimmedText = text.trim()
    const hash = crypto.createHash("md5").update(trimmedText).digest("hex")
    const filename = path.join(Main.publicRoot, "repo", "polly", "cache", `${hash}.mp3`)

    // Ensure the cache directory exists
    const cacheDir = path.dirname(filename)
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true })
    }

    if (fs.existsSync(filename)) {
      log.info(`File exists: ${filename}`)
      this.invoke("publishPlayAudioFile", filename)
      return
    } else {
      log.info(`Generating audio file: ${filename}`)
    }

    try {
      if (!this.config.voice) {
        log.error(`Voice not set`)
        return
      }

      if (!this.client) {
        this.client = new PollyClient({
          // region: "us-east-1", // replace with your desired region
          credentials: {
            accessKeyId: this.config.secretId, // replace with your access key id
            secretAccessKey: this.config.secretAccessKey // replace with your secret access key
          }
        })
      }

      const params: SynthesizeSpeechCommandInput = {
        OutputFormat: (this.config.format as "json") || "mp3" || "ogg_vorbis" || "pcm",
        Text: text,
        VoiceId: this.config.voice as "Joanna" | "Matthew" // replace with your desired voice
      }

      const command = new SynthesizeSpeechCommand(params)
      const response = await this.client.send(command)

      // Convert response.AudioStream to Node.js Readable stream
      const audioStream = response.AudioStream as Readable
      const writeStream = fs.createWriteStream(filename)
      audioStream.pipe(writeStream)

      writeStream.on("finish", () => {
        this.invoke("publishPlayAudioFile", filename)
      })
    } catch (error) {
      log.error(`Error synthesizing speech: ${error}`)
    }

    this.invoke("publishSpeaking", trimmedText)
  }

  publishPlayAudioFile(filename: string): string {
    log.info(`Polly.publishPlayAudioFile: ${filename}`)
    return filename
  }

  /**
   * Serializes the Polly instance to JSON.
   * Excludes intervalId from serialization.
   * @returns {object} The serialized Polly instance.
   */
  toJSON() {
    return {
      ...super.toJSON()
    }
  }
}
