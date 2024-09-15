import { getLogger } from "../framework/LocalLog"
import Service from "../framework/Service"

const log = getLogger("WebkitSpeechRecognition")

/**
 * @class WebkitSpeechRecognition
 * @extends Service
 * @description A service that provides webkitspeechrecognition functionality, periodically publishing the current epoch time.
 */
export default class WebkitSpeechRecognition extends Service {
  /**
   * @property {NodeJS.Timeout | null} intervalId - The ID of the interval timer. This property is excluded from serialization.
   * @private
   */
  private intervalId: NodeJS.Timeout | null = null

  /**
   * @property {WebkitSpeechRecognitionConfig} config - The configuration for the webkitspeechrecognition service.
   */
  config = {
    intervalMs: 1000,
    start: false
  }

  /**
   * Creates an instance of WebkitSpeechRecognition.
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
   * Publishes the current epoch time.
   * @returns {number} The current epoch time.
   */
  publishText(text: string): string {
    log.info(`WebkitSpeechRecognition.publishText: ${text}`)
    return text
  }

  /**
   * Serializes the WebkitSpeechRecognition instance to JSON.
   * Excludes intervalId from serialization.
   * @returns {object} The serialized WebkitSpeechRecognition instance.
   */
  toJSON() {
    return {
      ...super.toJSON()
    }
  }
}
