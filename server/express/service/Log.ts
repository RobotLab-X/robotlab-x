import fs from "fs"
import path from "path"
import Service from "../framework/Service"

/**
 * @class Log
 * @extends Service
 * @description A service which gathers and publishes logs.
 */
export default class Log extends Service {
  private intervalId: NodeJS.Timeout | null = null
  config = {
    intervalMs: 10000
  }
  private openLogFiles: string[] = []
  private fileWatchers = new Map<string, fs.FSWatcher>()
  private logStorage: Record<string, object[]> = {}

  constructor(
    public id: string,
    public name: string,
    public typeKey: string,
    public version: string,
    public hostname: string
  ) {
    super(id, name, typeKey, version, hostname)
    const defaultLogFile = path.resolve("robotlab-x.log")
    this.openLogFile(defaultLogFile)
  }

  public openLogFile(filePath: string): void {
    if (!this.openLogFiles.includes(filePath)) {
      const watcher = fs.watch(filePath, (eventType, filename) => {
        if (eventType === "change") {
          this.readLogFile(filePath)
        }
      })

      this.fileWatchers.set(filePath, watcher)
      this.openLogFiles.push(filePath)
      this.logStorage[filePath] = [] // Initialize log storage for this file
      console.log(`Log.openLogFile: Opened log file ${filePath}`)
    } else {
      console.warn(`Log.openLogFile: Log file ${filePath} is already open`)
    }
  }

  private readLogFile(filePath: string): void {
    fs.readFile(filePath, "utf8", (err, data) => {
      if (err) {
        console.error(`Log.readLogFile: Error reading log file ${filePath} - ${err.message}`)
      } else {
        console.log(`Log.readLogFile: Read log file ${filePath}`)
        // Parse JSON log entries and store them
        try {
          const logs = data
            .split("\n")
            .filter((line) => line.trim() !== "")
            .map((line) => JSON.parse(line)) // Parse each line as JSON
          this.logStorage[filePath].push(...logs)
        } catch (parseError) {
          console.error(`Log.readLogFile: Failed to parse JSON log `)
        }
      }
    })
  }

  public publishLogs(logs: object[]): object[] {
    console.log(`Log.publishLogs: Publishing logs - ${logs.length} entries`)
    return logs
  }

  startService(): void {
    super.startService()
    this.startLogging()
  }

  public startLogging(intervalMs?: number): void {
    if (intervalMs) {
      this.config.intervalMs = intervalMs
    }

    if (this.intervalId === null) {
      console.log(`Log.startLogging: Starting timer with interval ${this.config.intervalMs} ms`)
      this.intervalId = setInterval(() => {
        const collectedLogs = this.collectLogs()
        if (collectedLogs.length > 0) {
          this.invoke("publishLogs", collectedLogs)
        }
      }, this.config.intervalMs)
    } else {
      console.warn("Log.startLogging: Timer is already running")
    }
  }

  public stopLogging(): void {
    if (this.intervalId !== null) {
      console.log("Log.stopLogging: Stopping log timer")
      clearInterval(this.intervalId)
      this.intervalId = null
    } else {
      console.warn("Log.stopLogging: Log timer is not running")
    }
  }

  private collectLogs(): object[] {
    const allLogs: object[] = []

    for (const [filePath, logs] of Object.entries(this.logStorage)) {
      allLogs.push(...logs)
      this.logStorage[filePath] = [] // Clear logs after collecting
    }

    return allLogs
  }

  toJSON() {
    return {
      ...super.toJSON(),
      openLogFiles: this.openLogFiles
    }
  }

  stopService(): void {
    this.fileWatchers.forEach((watcher) => watcher.close())
    this.fileWatchers.clear()
    this.openLogFiles = []
    this.logStorage = {} // Clear in-memory log storage
    this.stopLogging()
    super.stopService()
  }
}
