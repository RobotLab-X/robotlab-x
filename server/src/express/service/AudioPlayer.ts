import { ipcMain } from "electron"
import { getLogger } from "../framework/LocalLog"
import Service from "../framework/Service"

const log = getLogger("AudioPlayer")

/**
 * @class AudioPlayer
 * @extends Service
 * @description A service which can play audio files.
 */
export default class AudioPlayer extends Service {
  /**
   * @property {AudioPlayerConfig} config - The configuration for the audioplayer service.
   */
  config = {
    // playlists: { [key: string]: string[] } = {}
    playlists: {}
  }

  currentlyPlayingAudioFile: string | null = null

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

  play(audioFile: string): void {
    log.info(`AudioPlayer.play: ${audioFile}`)
    this.playAudioFile(audioFile)
  }

  playAudioFile(audioFile: string): void {
    log.info(`AudioPlayer.playAudio: ${audioFile}`)
    const mockEvent = { sender: { send: () => {} } }
    ipcMain.emit("play-sound", mockEvent, `${this.name}@${this.id}`, audioFile)
  }

  onPlayAudioFile(audioFile: string): void {
    log.info(`AudioPlayer.onPlayAudio: ${audioFile}`)
    this.playAudioFile(audioFile)
  }

  publishAudioFinished(audioFile: string): string {
    log.info(`AudioPlayer.publishAudioFinished: ${audioFile}`)
    this.currentlyPlayingAudioFile = null
    return audioFile
  }

  publishAudioStarted(audioFile: string): string {
    log.info(`AudioPlayer.publishAudioStarted: ${audioFile}`)
    this.currentlyPlayingAudioFile = audioFile
    return audioFile
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
