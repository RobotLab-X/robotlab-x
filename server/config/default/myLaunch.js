const { config } = require("process")
const LaunchDescription = require("../../express/framework/LaunchDescription")
const { type } = require("os")
const path = require("path")

function generateLaunchDescription() {
  const ld = new LaunchDescription()

  // Define the path to the parameters file
  const configFile = path.join(__dirname, "my_params.yaml")

  // Create a node with parameters and remappings
  const clock01 = {
    package: "clock",
    config: { intervalMs: 1000 },
    name: "clock01",
    listeners: {
      publishEpoch: [
        {
          callback: "onEpoch",
          listener: "python"
        }
      ]
    },
    remappings: [["/original_topic", "/new_topic"]]
  }

  const clock02 = {
    package: "clock",
    config: { intervalMs: 1000 },
    name: "clock02",
    listeners: {
      publishEpoch: [
        {
          callback: "onEpoch",
          listener: "python"
        }
      ]
    },
    remappings: [["/original_topic", "/new_topic"]]
  }

  // Add the node to the launch description
  ld.addNode(clock01)
  ld.addNode(clock02)

  return ld
}

module.exports = { generateLaunchDescription }
