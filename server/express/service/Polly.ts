import {
  DescribeVoicesCommand,
  DescribeVoicesCommandInput,
  PollyClient,
  SynthesizeSpeechCommand,
  SynthesizeSpeechCommandInput
} from "@aws-sdk/client-polly"
import crypto from "crypto"
import fs from "fs"
import path from "path"
import { Readable } from "stream"
import Main from "../../electron/Main"
import { getLogger } from "../framework/Log"
import Service from "../framework/Service"

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
    secretAccessKey: null as string | null,
    secretId: null as string | null,
    format: "mp3" as "mp3" | "ogg" | "pcm"
  }

  client: PollyClient | null = null
  voices: { id: string; name: string; language: string; gender: string }[] = []

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

  async startService() {
    super.startService()
    if (!this.config.secretAccessKey || !this.config.secretId) {
      log.info(`Polly.startService: Missing secretAccessKey or secretId`)
      this.ready = false
    } else {
      await this.initializePollyClient()
      await this.fetchVoices()
    }
  }

  async initializePollyClient() {
    if (!this.client) {
      this.client = new PollyClient({
        credentials: {
          accessKeyId: this.config.secretId!,
          secretAccessKey: this.config.secretAccessKey!
        }
      })
    }
  }

  async fetchVoices() {
    if (!this.client) {
      log.error("Polly client not initialized")
      return
    }

    try {
      const command = new DescribeVoicesCommand({} as DescribeVoicesCommandInput)
      const response = await this.client.send(command)
      if (response.Voices) {
        this.voices = response.Voices.map((voice) => ({
          id: voice.Id!,
          name: voice.Name!,
          language: voice.LanguageName!,
          gender: voice.Gender!
        }))
        log.info(`Fetched ${this.voices.length} voices`)
      }
      this.invoke("broadcastState")
    } catch (error) {
      log.error(`Error fetching voices: ${error}`)
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

  applyConfig(config: any): void {
    super.applyConfig(config)
    if (this.config.secretAccessKey && this.config.secretId) {
      this.initializePollyClient()
      this.fetchVoices()
      this.ready = true
      this.invoke("broadcastState")
    }
  }

  async speak(text: string) {
    log.info(`Polly.speak: ${text}`)

    // Trim the text and generate a hash
    const trimmedText = text.trim()
    const hash = crypto.createHash("md5").update(trimmedText).digest("hex")
    const main = Main.getInstance()
    const filename = path.resolve(path.join(main.publicRoot, "repo", "polly", "cache", `${hash}.mp3`))

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
        await this.initializePollyClient()
        await this.fetchVoices()
        this.ready = true
      }

      const params: SynthesizeSpeechCommandInput = {
        OutputFormat: (this.config.format as "json") || "mp3" || "ogg_vorbis" || "pcm",
        Text: text,
        VoiceId: this.config.voice as "Joanna" | "Matthew"
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
      ...super.toJSON(),
      voices: this.voices
    }
  }
}
