// Require the base LaunchDescription class using CommonJS syntax
const { config } = require("process")
const LaunchDescription = require("../../express/framework/LaunchDescription")
const { type } = require("os")

class Default extends LaunchDescription {
  constructor() {
    super([
      {
        package: "clock", // Repository package? or TypeKey?
        name: "clock01",
        config: { intervalMs: 1000 },
        output: "screen"
      },
      {
        package: "clock", // Repository package? or TypeKey?
        name: "clock01",
        config: { intervalMs: 1000 },
        output: "screen"
      }
    ])
  }
}

// Export the class using module.exports for CommonJS compatibility
module.exports = Default
