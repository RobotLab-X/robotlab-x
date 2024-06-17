const { config } = require("process")
const LaunchDescription = require("../../express/framework/LaunchDescription")
const { type } = require("os")
const path = require("path")

function generateLaunchDescription() {
  const ld = new LaunchDescription()

  // Create a node with parameters and remappings
{{launchActions}}

  // Add the node to the launch description
{{addNodes}}

  return ld
}

module.exports = { generateLaunchDescription }
