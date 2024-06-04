import { getLogger } from "../framework/Log"
import Service from "../framework/Service"

const log = getLogger("Clock")

/**
 * @class Clock
 * @extends Service
 * @description A service that provides clock functionality, periodically publishing the current epoch time.
 */
export default class Clock extends Service {
  /**
   * @property {NodeJS.Timeout | null} intervalId - The ID of the interval timer. This property is excluded from serialization.
   * @private
   */
  private intervalId: NodeJS.Timeout | null = null

  /**
   * @property {ClockConfig} config - The configuration for the clock service.
   */
  config = {
    intervalMs: 1000,
    start: false
  }

  /**
   * Creates an instance of Clock.
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
    log.info(`Clock.publishEpoch: ${epoch}`)
    return epoch
  }

  /**
   * Handles the tick event, invoking the publishEpoch method.
   */
  onTick(): void {
    this.invoke("publishEpoch")
  }

  stopService(): void {
    this.stopClock()
    super.stopService()
  }

  /**
   * Starts the clock timer.
   * @param {number} [intervalMs] - The interval in milliseconds. If not provided, the existing intervalMs from the config is used.
   * @example [ 1000 ]
   */
  public startClock(intervalMs?: number): void {
    this.config.start = true

    if (intervalMs) {
      this.config.intervalMs = intervalMs
    }

    // Ensure no other timer is running before starting a new one
    if (this.intervalId === null) {
      log.info(`Clock.startClock: Starting timer with interval ${this.config.intervalMs} ms`)
      this.intervalId = setInterval(() => this.onTick(), this.config.intervalMs)
    } else {
      log.warn("Clock.startClock: Timer is already running")
    }
  }

  /**
   * Stops the clock timer.
   */
  public stopClock(): void {
    this.config.start = false
    if (this.intervalId !== null) {
      log.info("Clock.stopClock: Stopping timer")
      clearInterval(this.intervalId)
      this.intervalId = null
    } else {
      log.warn("Clock.stopClock: Timer is not running")
    }
  }

  /**
   * Serializes the Clock instance to JSON.
   * Excludes intervalId from serialization.
   * @returns {object} The serialized Clock instance.
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      typeKey: this.typeKey,
      version: this.version,
      hostname: this.hostname,
      config: this.config,
      notifyList: this.notifyList
    }
  }
}
