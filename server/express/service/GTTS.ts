import crypto from "crypto"
import fs from "fs"
import path from "path"
import Main from "../../electron/ElectronStarter"
import { getLogger } from "../framework/Log"
import Service from "../framework/Service"
const gTTS = require("gtts")
const sound = require("sound-play")

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

  protected hash = crypto.createHash("md5")

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

  speak(text: string): void {
    log.info(`GTTS.speak: ${text}`)

    const filename = path.join(Main.publicRoot, "repo", "gtts", "cache", `${this.hash.update(text).digest("hex")}.mp3`)

    if (fs.existsSync(filename)) {
      log.info(`file exists ${filename}`)
      sound.play(filename)
      return
    }

    const gtts = new gTTS(text, this.config.lang)

    gtts.save(filename, function (err: any, result: any) {
      if (err) {
        // throw new Error(err)
        log.error(`error ${err}`)
        return
      }
      log.info(`caching ${filename}`)
    })

    this.invoke("publishSpeaking", text)
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
