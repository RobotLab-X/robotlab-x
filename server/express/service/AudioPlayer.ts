import { ipcMain } from "electron"
import { getLogger } from "../framework/Log"
import Service from "../framework/Service"

const log = getLogger("AudioPlayer")

/**
 * @class AudioPlayer
 * @extends Service
 * @description A service that provides audioplayer functionality, periodically publishing the current epoch time.
 */
export default class AudioPlayer extends Service {
  /**
   * @property {AudioPlayerConfig} config - The configuration for the audioplayer service.
   */
  config = {}

  private intervalId: NodeJS.Timeout | null = null

  /**
   * Creates an instance of AudioPlayer.
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

  startService(): void {
    super.startService()
    //this.start()
  }

  /**
   * Starts the audio player service.
   */
  start() {
    log.info("Starting AudioPlayer service")
    this.intervalId = setInterval(() => {
      // const audioFilePath = path.resolve(process.cwd(), "path/to/your/sound/file.mp3")
      const audioFilePath = "express/public/repo/polly/cache/0e88a34dc0f850ce2ca882d6abe5eef3.mp3"
      log.info("Timer expired, sending play-sound message:", audioFilePath)
      ipcMain.emit("play-sound", null, audioFilePath)
    }, 5000) // 5 seconds interval
  }

  /**
   * Stops the audio player service.
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    log.info("Stopping AudioPlayer service")
  }

  play(audioFile: string): void {
    log.info(`AudioPlayer.play: ${audioFile}`)
    this.playAudioFile(audioFile)
  }

  playAudioFile(audioFile: string): void {
    log.info(`AudioPlayer.playAudio: ${audioFile}`)
    ipcMain.emit("play-sound", null, audioFile)
  }

  onPlayAudioFile(audioFile: string): void {
    log.info(`AudioPlayer.onPlayAudio: ${audioFile}`)
    this.playAudioFile(audioFile)
  }

  /**
   * Serializes the AudioPlayer instance to JSON.
   * Excludes intervalId from serialization.
   * @returns {object} The serialized AudioPlayer instance.
   */
  toJSON() {
    return {
      ...super.toJSON()
    }
  }
}
