import { getLogger } from "../framework/LocalLog"
import Service from "../framework/Service"

const log = getLogger("Random")

/**
 * @class Random
 * @extends Service
 * @description A service that provides random functionality by publishing a random messages.
 *
 * Each random message definition will come with a frequency and a range of values.
 */
export default class Random extends Service {
  /**
   * @property {NodeJS.Timeout | null} intervalId - The ID of the interval timer. This property is excluded from serialization.
   * @private
   */
  private intervalId: NodeJS.Timeout | null = null

  /**
   * @property {RandomConfig} config - The configuration for the random service.
   */
  config = {
    intervalMs: 1000,
    start: false,
    randomDefinitions:{
      "default": {
        name: "neck",
        method:"moveTo",
        min: 65,
        max: 120,
        frequency: 1,
        range: [1, 100]
      }
    }
  }

  /**
   * Creates an instance of Random.
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
   * Handles the tick event, invoking the publishEpoch method.
   */
  onTick(): void {
    this.send(serviceName, "applyConfig", config)
  }

  stopService(): void {
    this.stopRandom()
    super.stopService()
  }

  /**
   * Starts the random timer.
   * @param {number} [intervalMs] - The interval in milliseconds. If not provided, the existing intervalMs from the config is used.
   * @example [ 1000 ]
   */
  public startRandom(intervalMs?: number): void {
    this.config.start = true

    if (intervalMs) {
      this.config.intervalMs = intervalMs
    }

    // Ensure no other timer is running before starting a new one
    if (this.intervalId === null) {
      log.info(`Random.startRandom: Starting timer with interval ${this.config.intervalMs} ms`)
      this.intervalId = setInterval(() => this.onTick(), this.config.intervalMs)
    } else {
      log.warn("Random.startRandom: Timer is already running")
    }
  }

  /**
   * Stops the random timer.
   */
  public stopRandom(): void {
    this.config.start = false
    if (this.intervalId !== null) {
      log.info("Random.stopRandom: Stopping timer")
      clearInterval(this.intervalId)
      this.intervalId = null
    } else {
      log.warn("Random.stopRandom: Timer is not running")
    }
  }

  /**
   * Serializes the Random instance to JSON.
   * Excludes intervalId from serialization.
   * @returns {object} The serialized Random instance.
   */
  toJSON() {
    return {
      ...super.toJSON()
    }
  }
}
