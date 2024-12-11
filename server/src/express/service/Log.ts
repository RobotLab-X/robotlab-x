import fs from "fs"
import path from "path"
import Service from "../framework/Service"

interface LogEntry {
  ts: number // Timestamp property for sorting
  index: number // Index to track order of logs
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
    intervalMs: 5000
  }
  private openLogFiles: string[] = []
  private fileReadPositions = new Map<string, number>() // Track last read position per file
  private unifiedLog: LogEntry[] = [] // Unified sorted log
  private lastPublishedIndex: number = 0 // Index to track the last published log
  private unifiedLogsPublished: number = 0 // Track the number of unified logs published

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
      this.openLogFiles.push(filePath)
      this.fileReadPositions.set(filePath, 0) // Initialize read position for the file
      console.log(`Log.openLogFile: Opened log file ${filePath}`)
    } else {
      console.warn(`Log.openLogFile: Log file ${filePath} is already open`)
    }
  }

  private async readNewLogsFromFile(filePath: string): Promise<LogEntry[]> {
    const lastReadPosition = this.fileReadPositions.get(filePath) || 0
    const stats = fs.statSync(filePath)
    const currentSize = stats.size

    // If no new data, return early
    if (currentSize <= lastReadPosition) {
      return []
    }

    const readStream = fs.createReadStream(filePath, {
      encoding: "utf8",
      start: lastReadPosition,
      end: currentSize - 1 // Read till the end of the current file size
    })

    let fileData = ""
    const newLogs: LogEntry[] = []

    return new Promise<LogEntry[]>((resolve) => {
      readStream.on("data", (chunk) => {
        fileData += chunk
      })

      readStream.on("end", () => {
        const lines = fileData.split("\n")

        for (const line of lines) {
          if (line.trim() === "") continue // Skip empty lines

          try {
            const logEntry = JSON.parse(line)
            logEntry.index = this.unifiedLog.length // Assign an index to each log entry
            newLogs.push(logEntry)
          } catch (parseError: any) {
            console.error(`Log.readNewLogsFromFile: Failed to parse JSON log - Error: ${parseError.message}`)
          }
        }

        // Update last read position to the end of the current size
        this.fileReadPositions.set(filePath, currentSize)
        resolve(newLogs)
      })

      readStream.on("error", (err: any) => {
        console.error(`Log.readNewLogsFromFile: Error reading log file ${filePath} - ${err.message}`)
        resolve([]) // Resolve with an empty array on error
      })
    })
  }

  private async getNewLogs(): Promise<LogEntry[]> {
    const logReadPromises = this.openLogFiles.map((filePath) => this.readNewLogsFromFile(filePath))
    const newLogsArray = await Promise.all(logReadPromises)

    // Flatten the array of arrays into a single array of log entries
    const newLogs = newLogsArray.flat()
    if (newLogs.length > 0) {
      this.unifiedLog.push(...newLogs)
      this.unifiedLog.sort((a, b) => a.ts - b.ts)

      // Ensure unifiedLog does not exceed 500 entries
      if (this.unifiedLog.length > 500) {
        const excessLogs = this.unifiedLog.length - 500
        this.unifiedLog.splice(0, excessLogs) // Remove the oldest logs

        // Adjust the lastPublishedIndex to ensure it aligns with the current log window
        this.lastPublishedIndex = Math.max(0, this.lastPublishedIndex - excessLogs)

        // console.debug(`Removed ${excessLogs} oldest logs to maintain a 500-log window`)
      }
    }

    const newPublishedLogs = this.unifiedLog.slice(this.lastPublishedIndex)
    this.lastPublishedIndex = this.unifiedLog.length // Update last published index
    return newPublishedLogs
  }

  public publishLogs(logs: LogEntry[]): LogEntry[] {
    this.unifiedLogsPublished += logs.length
    // console.debug(`Log.publishLogs: Publishing ${logs.length} new log entries - ${this.unifiedLogsPublished} total`)
    return logs // Simply return the logs to be sent to the client
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
      this.intervalId = setInterval(async () => {
        const newLogs = await this.getNewLogs()
        if (newLogs.length > 0) {
          this.invoke("publishLogs", newLogs)
        }
      }, this.config.intervalMs)
    } else {
      console.warn("Log.startLogging: Timer is already running")
    }
  }

  /**
   * Stops the log timer.
   * @returns {void}
   */
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
    return this
  }

  stopService(): void {
    this.openLogFiles.forEach((filePath) => {
      this.fileReadPositions.delete(filePath) // Clear read positions
    })
    this.openLogFiles = []
    this.unifiedLog = [] // Clear unified log
    this.lastPublishedIndex = 0
    this.stopLogging()
    super.stopService()
  }
}
