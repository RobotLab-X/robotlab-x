import { getLogger } from "../framework/LocalLog"
import Service from "../framework/Service"

const log = getLogger("NeoPixel")

/**
 * @class NeoPixel
 * @extends Service
 * @description A service that provides neopixel functionality, periodically publishing the current epoch time.
 */
export default class NeoPixel extends Service {
  /**
   * @property {NodeJS.Timeout | null} intervalId - The ID of the interval timer. This property is excluded from serialization.
   * @private
   */
  private intervalId: NodeJS.Timeout | null = null

  /**
   * @property {NeoPixelConfig} config - The configuration for the neopixel service.
   */
  config = {
    pin: number | null,
    controller: "",
    intervalMs: 1000,
    start: false
  }

  /**
   * Creates an instance of NeoPixel.
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
  publishEpoch(): number {
    const epoch = Date.now()
    log.info(`NeoPixel.publishEpoch: ${epoch}`)
    return epoch
  }

  /**
   * Handles the tick event, invoking the publishEpoch method.
   */
  onTick(): void {
    this.invoke("publishEpoch")
  }

  stopService(): void {
    this.stopNeoPixel()
    super.stopService()
  }

  /**
   * Starts the neopixel timer.
   * @param {number} [intervalMs] - The interval in milliseconds. If not provided, the existing intervalMs from the config is used.
   * @example [ 1000 ]
   */
  public startNeoPixel(intervalMs?: number): void {
    this.config.start = true

    if (intervalMs) {
      this.config.intervalMs = intervalMs
    }

    // Ensure no other timer is running before starting a new one
    if (this.intervalId === null) {
      log.info(`NeoPixel.startNeoPixel: Starting timer with interval ${this.config.intervalMs} ms`)
      this.intervalId = setInterval(() => this.onTick(), this.config.intervalMs)
    } else {
      log.warn("NeoPixel.startNeoPixel: Timer is already running")
    }
  }

  /**
   * Stops the neopixel timer.
   */
  public stopNeoPixel(): void {
    this.config.start = false
    if (this.intervalId !== null) {
      log.info("NeoPixel.stopNeoPixel: Stopping timer")
      clearInterval(this.intervalId)
      this.intervalId = null
    } else {
      log.warn("NeoPixel.stopNeoPixel: Timer is not running")
    }
  }

  /**
   * Serializes the NeoPixel instance to JSON.
   * Excludes intervalId from serialization.
   * @returns {object} The serialized NeoPixel instance.
   */
  toJSON() {
    return {
      ...super.toJSON()
    }
  }
}
