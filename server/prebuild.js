const fs = require("fs")
const path = require("path")

const version = (process.env.VERSION || "0.0.0").trim()

// Load the package.json
const packageJsonPath = path.join(__dirname, "package.json")
let package = fs.readFileSync(packageJsonPath, "utf8")
package = package.replace(/0\.0\.0/g, version)

// Write the updated package.json back to disk
fs.writeFileSync(packageJsonPath, package, "utf8")

console.log(`Updated executableName to RobotLab-X-${version}`)
