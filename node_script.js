const path = require("path")

// Build the correct path using __dirname
const resolvedPath = path.join(__dirname, "RobotLabXRuntime.js")
console.info("Resolved Path:", resolvedPath)

// Require the module using the resolved path
const RobotLabXRuntime = require(resolvedPath).default

console.info("RobotLabXRuntime loaded:", RobotLabXRuntime)
console.info(RobotLabXRuntime.getInstance().getServiceNames())

const runtime = RobotLabXRuntime.getInstance()
console.info(runtime.getUptime())
console.info(process.cwd())

const n1 = runtime.getService("n1")
n1.scanDirectory()
// console.info(n1.config)
