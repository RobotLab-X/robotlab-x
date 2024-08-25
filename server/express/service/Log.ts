import fs from "fs"
import path from "path"
import Service from "../framework/Service"

interface LogEntry {
  ts: number // Timestamp property for sorting
  [key: string]: any // Other properties of the log entry
}

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
  private unifiedLog: LogEntry[] = [] // Unified sorted log
  private lastPublishedIndex: number = 0 // Track the last published log index
  private lastReadPosition: number = 0 // Track the last read position in the file

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
      console.log(`Log.openLogFile: Opened log file ${filePath}`)
    } else {
      console.warn(`Log.openLogFile: Log file ${filePath} is already open`)
    }
  }

  private readLogFile(filePath: string): void {
    fs.readFile(filePath, "utf8", (err, data) => {
      if (err) {
        console.error(`Log.readLogFile: Error reading log file ${filePath} - ${err.message}`)
        return
      }

      console.log(`Log.readLogFile: Read log file ${filePath}`)
      const lines = data.split("\n")
      const newLines = lines.slice(this.lastReadPosition)

      if (newLines.length === 0) return

      try {
        const newLogs = newLines.filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as LogEntry)

        // Merge new logs into the unified log and sort
        this.unifiedLog.push(...newLogs)
        this.unifiedLog.sort((a, b) => a.ts - b.ts)

        // Update last read position to the end of the file
        this.lastReadPosition = lines.length
      } catch (parseError) {
        console.error(`Log.readLogFile: Failed to parse JSON log - `)
      }
    })
  }

  public publishLogs(): LogEntry[] {
    const newLogs = this.unifiedLog.slice(this.lastPublishedIndex)
    this.lastPublishedIndex = this.unifiedLog.length
    console.log(`Log.publishLogs: Publishing ${newLogs.length} new log entries`)
    return newLogs
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
        const newLogs = this.publishLogs()
        if (newLogs.length > 0) {
          this.invoke("publishLogs", newLogs)
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

  toJSON() {
    return {
      ...super.toJSON(),
      openLogFiles: this.openLogFiles,
      unifiedLog: this.unifiedLog
    }
  }

  broadcastState() {
    console.error(`broadcastState - record count ${this.unifiedLog.length}`)
    return this
  }

  stopService(): void {
    this.fileWatchers.forEach((watcher) => watcher.close())
    this.fileWatchers.clear()
    this.openLogFiles = []
    this.unifiedLog = [] // Clear unified log
    this.lastPublishedIndex = 0
    this.lastReadPosition = 0 // Reset read position
    this.stopLogging()
    super.stopService()
  }
}
