import fs from "fs"
import path from "path"
import winston from "winston"

// Define custom levels and their corresponding colors
const logLevels = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    verbose: 3,
    debug: 4,
    silly: 5
  },
  colors: {
    error: "red",
    warn: "yellow",
    info: "green",
    verbose: "cyan",
    debug: "blue",
    silly: "grey"
  }
}

function formatModuleName(moduleName: string) {
  if (moduleName.length > 8) {
    return moduleName.substring(0, 8) // Truncate to 8 characters
  } else {
    return moduleName.padEnd(8, " ") // Pad with spaces to make it 8 characters long
  }
}

const textFormat = winston.format.printf(({ level, message, module }) => {
  const formattedModule = formatModuleName(module)
  return `${level}[${formattedModule}]: ${message}`
})

// Lazy initialization for logFilePath
export const getLogFilePath = () => {
  let root = process.env.ROOT_DIR || process.cwd()
  let logFilePath: string | null = null
  logFilePath = path.join(root, "robotlab-x.log")
  if (fs.existsSync(logFilePath)) {
    console.log(`${logFilePath} exists. truncating...`)
    fs.writeFileSync(logFilePath, "")
  }
  return logFilePath
}

// Custom format to rename fields and use millisecond epoch timestamp
const customJsonFormat = winston.format.combine(
  winston.format.timestamp({
    format: () => Date.now().toString() // Use millisecond epoch time
  }),
  winston.format((info) => {
    info.ts = info.timestamp // Rename 'timestamp' to 'ts'
    delete info.timestamp // Remove original 'timestamp' field
    info.msg = info.message // Rename 'message' to 'msg'
    delete info.message // Remove original 'message' field
    return info
  })(),
  winston.format.json()
)

// Create a logger instance with JSON format as default
const log = winston.createLogger({
  levels: logLevels.levels,
  format: customJsonFormat,
  transports: [
    new winston.transports.Console({
      level: "info"
    }),
    new winston.transports.File({
      filename: getLogFilePath(),
      level: "info"
    })
  ]
})

// Set colors for each level
winston.addColors(logLevels.colors)

// Function to get a child logger with a module name
export function getLogger(moduleName: string): winston.Logger {
  return log.child({ module: moduleName })
}

// Function to change the logging format
export function setLogFormat(format: "json" | "text") {
  const newFormat =
    format === "json"
      ? customJsonFormat // Use custom JSON format with renamed fields
      : winston.format.combine(winston.format.timestamp(), textFormat)
  log.transports.forEach((transport) => {
    transport.format = newFormat
  })
}

export { log }
