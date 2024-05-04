import { getLogger } from "../framework/Log"
import Service from "../framework/Service"

const log = getLogger("Clock")

export default class Clock extends Service {
  // Class properties
  private intervalId: NodeJS.Timeout | null = null
  private intervalMs: number = 1000

  constructor(
    public id: string,
    public name: string,
    public typeKey: string,
    public version: string,
    public hostname: string
  ) {
    super(id, name, typeKey, version, hostname) // Call the base class constructor if needed
  }

  publishEpoch(): number {
    const epoch = Date.now()
    log.info(`Clock.publishEpoch: ${epoch}`)
    return epoch
  }

  onTick(): void {
    this.invoke("publishEpoch")
  }

  // Method to start the clock timer
  public startClock(intervalMs?: number): void {
    if (intervalMs) {
      this.intervalMs = intervalMs
    }

    // Ensure no other timer is running before starting a new one
    if (this.intervalId === null) {
      log.info(`Clock.startClock: Starting timer with interval ${this.intervalMs} ms`)
      this.intervalId = setInterval(() => this.onTick(), this.intervalMs)
    } else {
      log.warn("Clock.startClock: Timer is already running")
    }
  }

  // Method to stop the clock timer
  public stopClock(): void {
    if (this.intervalId !== null) {
      log.info("Clock.stopClock: Stopping timer")
      clearInterval(this.intervalId)
      this.intervalId = null
    } else {
      log.warn("Clock.stopClock: Timer is not running")
    }
  }

  // Not sure if this is the best way to exclude members from serialization
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      typeKey: this.typeKey,
      version: this.version,
      hostname: this.hostname,
      intervalMs: this.intervalMs
    }
  }
}
