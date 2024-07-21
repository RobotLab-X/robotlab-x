const { type } = require("os")
const path = require("path")

function generateLaunchDescription() {
  const ld = {
    description: "Very simple clock example, starts the clock and publishes the current epoch time.",
    version: "0.0.1",
    actions: []
  }

  // Create a node with parameters and remappings
  const runtime = {
    package: "robotlabxruntime",
    name: "runtime",
    config: { autoLaunch: null, id: "rxl-2", logLevel: "info", port: 3001, connect: [] },
    listeners: {}
  }
  const clock01 = {
    package: "clock",
    name: "clock01",
    config: { intervalMs: 1000, start: true },
    listeners: {}
  }

  // Add the node to the launch description
  ld.actions.push(runtime)
  ld.actions.push(clock01)

  return ld
}

module.exports = { generateLaunchDescription }