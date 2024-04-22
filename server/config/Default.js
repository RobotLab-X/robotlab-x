// Require the base LaunchDescription class using CommonJS syntax
const LaunchDescription = require("../express/framework/LaunchDescription")

class Default extends LaunchDescription {
  constructor() {
    super([
      {
        package: "MyRobotLabConnector", // Repository package?
        executable: "MyRobotLabConnector",
        name: "mrl1",
        parameters: { some_param: 42 },
        output: "screen"
      },
      {
        package: "example_package",
        executable: "example_node_b",
        name: "example_node_b",
        output: "screen"
      }
    ])
  }
}

// Export the class using module.exports for CommonJS compatibility
module.exports = Default
