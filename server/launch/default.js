const { type } = require("os")
const path = require("path")

function generateLaunchDescription() {
  // const ld = new LaunchDescription()
  const ld = {
    description: "Generated launch description",
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

  // Add the node to the launch description
  ld.actions.push(runtime)

  return ld
}

module.exports = { generateLaunchDescription }
