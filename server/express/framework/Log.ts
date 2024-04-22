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

const logFormat = winston.format.printf(({ level, message, module }) => {
  const formattedModule = formatModuleName(module)
  return `${level}[${formattedModule}]: ${message}`
})

// Create a logger instance
const log = winston.createLogger({
  levels: logLevels.levels,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.combine(winston.format.colorize(), winston.format.simple()),
        logFormat
      ),
      // format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
      level: "info" // default level for the console transport
    })
    // new winston.transports.File({
    //   filename: "app.log",
    //   level: "info" // default level for the file transport
    // })
  ]
})

// Set colors for each level
winston.addColors(logLevels.colors)

// Function to get a child logger with a module name
export function getLogger(moduleName: string): winston.Logger {
  return log.child({ module: moduleName })
}

export { log }