import crypto from "crypto"
import fs from "fs"
import path from "path"
import Main from "../../electron/ElectronStarter"
import { getLogger } from "../framework/Log"
import Service from "../framework/Service"
const gTTS = require("gtts")
const player = require("play-sound")()

const log = getLogger("GTTS")

/**
 * @class GTTS
 * @extends Service
 * @description A service that provides gtts functionality, periodically publishing the current epoch time.
 */
export default class GTTS extends Service {
  /**
   * @property {ClockConfig} config - The configuration for the gtts service.
   */
  config = {
    lang: "en"
  }

  /**
   * Creates an instance of GTTS.
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

  publishSpeaking(text: string): number {
    const epoch = Date.now()
    log.info(`GTTS.publishEpoch: ${epoch}`)
    return epoch
  }

  onText(text: string): void {
    log.info(`GTTS.onPublishText: ${text}`)
    this.speak(text)
  }

  speak(text: string): void {
    log.info(`GTTS.speak: ${text}`)

    // Trim the text and generate a hash
    const trimmedText = text.trim()
    const hash = crypto.createHash("md5").update(trimmedText).digest("hex")
    const filename = path.join(Main.publicRoot, "repo", "gtts", "cache", `${hash}.mp3`)

    // Ensure the cache directory exists
    const cacheDir = path.dirname(filename)
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true })
    }

    if (fs.existsSync(filename)) {
      log.info(`File exists: ${filename}`)
      player.play(filename, function (err: any) {
        if (err) {
          log.error(`Error playing sound: ${err}`)
        }
      })
      return
    }

    const gtts = new gTTS(trimmedText, this.config.lang)

    gtts.save(filename, (err: any, result: any) => {
      if (err) {
        log.error(`Error: ${err}`)
        return
      }
      log.info(`Caching file: ${filename}`)
      player.play(filename, function (err: any) {
        if (err) {
          log.error(`Error playing sound: ${err}`)
        }
      })
    })

    this.invoke("publishSpeaking", trimmedText)
  }

  /**
   * Serializes the GTTS instance to JSON.
   * Excludes intervalId from serialization.
   * @returns {object} The serialized GTTS instance.
   */
  toJSON() {
    return {
      ...super.toJSON()
    }
  }
}
