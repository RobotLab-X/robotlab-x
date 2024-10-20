const { type } = require("os")
const path = require("path")

function generateLaunchDescription() {
  const ld = {
    description: "Arduino and servo example",
    version: "0.0.1",
    actions: []
  }

  const arduino = {
    package: "arduino",
    name: "arduino",
    config: { port: "/dev/ttyACM70", connect: true },
    listeners: {}
  }
  const s1 = {
    package: "servo",
    name: "s1",
    config: {
      autoDisable: true,
      controller: "arduino",
      enabled: true,
      rest: 90,
      idleTimeout: 3000,
      speed: 50,
      pin: 9,
      min: 30,
      max: 147
    },
    listeners: {
      publishServoMoveTo: [
        { topicMethod: "publishServoMoveTo", callbackName: "arduino", callbackMethod: "onServoMoveTo" }
      ]
    }
  }

  // Add the node to the launch description
  ld.actions.push(arduino)
  ld.actions.push(s1)

  return ld
}

module.exports = { generateLaunchDescription }
