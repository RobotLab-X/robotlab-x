const { type } = require("os")
const path = require("path")

function generateLaunchDescription() {
  // const ld = new LaunchDescription()
  const ld = {
    description: "Generated {{safeName}}",
    version: "0.0.1",
    actions: []
  }

  // Create a node with parameters and remappings
{{launchActions}}

  // Add the node to the launch description
{{addNodes}}

  return ld
}

module.exports = { generateLaunchDescription }
