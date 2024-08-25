import fs from "fs"
import path from "path"
import Service from "../framework/Service"

/**
 * @class Log
 * @extends Service
 * @description A service which gathers and publishes logs.
 */
export default class Log extends Service {
  /**
   * @property {NodeJS.Timeout | null} intervalId - The ID of the interval timer. This property is excluded from serialization.
   * @private
   */
  private intervalId: NodeJS.Timeout | null = null

  /**
   * @property {object} config - The configuration for the log service.
   */
  config = {
    intervalMs: 1000
  }

  /**
   * @property {string[]} openLogFiles - List of currently open log files.
   * @private
   */
  private openLogFiles: string[] = []

  /**
   * @property {Map<string, fs.FSWatcher>} fileWatchers - A map of log file paths to their corresponding file watchers.
   * @private
   */
  private fileWatchers = new Map<string, fs.FSWatcher>()

  /**
   * Creates an instance of Log.
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

    // Open the default log file upon initialization
    const defaultLogFile = path.resolve("robotlab-x.log")
    this.openLogFile(defaultLogFile)
  }

  /**
   * Opens a log file and starts watching it for changes.
   * @param {string} filePath - The path to the log file.
   */
  public openLogFile(filePath: string): void {
    if (!this.openLogFiles.includes(filePath)) {
      const watcher = fs.watch(filePath, (eventType, filename) => {
        if (eventType === "change") {
          this.readLogFile(filePath)
        }
      })

      this.fileWatchers.set(filePath, watcher)
      this.openLogFiles.push(filePath)
      console.log(`Log.openLogFile: Opened log file ${filePath}`)
    } else {
      console.warn(`Log.openLogFile: Log file ${filePath} is already open`)
    }
  }

  /**
   * Reads a log file and processes its content.
   * @param {string} filePath - The path to the log file.
   */
  private readLogFile(filePath: string): void {
    fs.readFile(filePath, "utf8", (err, data) => {
      if (err) {
        console.error(`Log.readLogFile: Error reading log file ${filePath} - ${err.message}`)
      } else {
        console.log(`Log.readLogFile: Read log file ${filePath}`)
        // this.invoke("publishLogs", data.split("\n"))
        // this.publishLogs(data.split("\n"))
        this.collectLogs()
      }
    })
  }

  /**
   * Publishes a batch of logs.
   * @param {any[]} logs - The logs to publish.
   */
  public publishLogs(logs: any[]): any[] {
    console.log(`Log.publishLogs: Publishing logs - ${logs.length} entries`)
    return logs
  }

  startService(): void {
    super.startService()
    this.startLogging()
  }

  /**
   * Starts the log timer.
   * @param {number} [intervalMs] - The interval in milliseconds. If not provided, the existing intervalMs from the config is used.
   */
  public startLogging(intervalMs?: number): void {
    if (intervalMs) {
      this.config.intervalMs = intervalMs
    }

    if (this.intervalId === null) {
      console.log(`Log.startLogging: Starting timer with interval ${this.config.intervalMs} ms`)
      this.intervalId = setInterval(() => {
        // this.publishLogs(this.collectLogs())
        this.invoke("publishLogs", this.collectLogs())
      }, this.config.intervalMs)
    } else {
      console.warn("Log.startLogging: Timer is already running")
    }
  }

  /**
   * Stops the log timer.
   */
  public stopLogging(): void {
    if (this.intervalId !== null) {
      console.log("Log.stopLogging: Stopping log timer")
      clearInterval(this.intervalId)
      this.intervalId = null
    } else {
      console.warn("Log.stopLogging: log timer is not running")
    }
  }

  /**
   * Collects logs from open log files.
   * @returns {string[]} Array of log entries.
   */
  private collectLogs(): string[] {
    const allLogs: string[] = []

    this.openLogFiles.forEach((filePath) => {
      // Add logic to read recent logs from each open file
      // This is a placeholder to aggregate all logs
      allLogs.push(`Logs from ${filePath}`)
    })

    return allLogs
  }

  /**
   * Serializes the Log instance to JSON.
   * Excludes intervalId from serialization.
   * @returns {object} The serialized Log instance.
   */
  toJSON() {
    return {
      ...super.toJSON(),
      openLogFiles: this.openLogFiles
    }
  }

  /**
   * Stops the service and releases file watchers.
   */
  stopService(): void {
    this.fileWatchers.forEach((watcher) => watcher.close())
    this.fileWatchers.clear()
    this.openLogFiles = []
    this.stopLogging()
    super.stopService()
  }
}
