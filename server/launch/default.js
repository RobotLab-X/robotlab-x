const { type } = require("os")
const path = require("path")

function generateLaunchDescription() {
  // const ld = new LaunchDescription()
  const ld = {
    description: "Default launch description",
    version: "0.0.1",
    actions: []
  }

  // Create a node with parameters and remappings
  const runtime = {
    package: "robotlabxruntime",
    name: "runtime",
    config: { autoLaunch: true, id: "rlx", launchFile: "default.js", logLevel: "info", port: 3001, connect: [] },
    listeners: {}
  }

  const log = {
    package: "log",
    name: "log",
    config: { intervalMs: 1000 },
    listeners: {}
  }

  // Add the node to the launch description
  ld.actions.push(runtime)
  ld.actions.push(log)

  return ld
}

module.exports = { generateLaunchDescription }
