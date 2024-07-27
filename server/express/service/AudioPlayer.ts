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
