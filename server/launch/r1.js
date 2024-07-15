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
    config: { autoLaunch: null, id: "rxl-1", logLevel: "info", port: 3001, connect: [] },
    listeners: {}
  }
  const ui = {
    package: "robotlabxui",
    name: "ui",
    config: {},
    listeners: {}
  }
  const clk1 = {
    package: "clock",
    name: "clk1",
    config: { intervalMs: 1000, start: false },
    listeners: {}
  }
  const left = {
    package: "arduino",
    name: "left",
    config: { port: "/dev/ttyACM70", connect: true },
    listeners: {}
  }
  const neck = {
    package: "servo",
    name: "neck",
    config: {
      autoDisable: true,
      controller: "left",
      enabled: true,
      rest: 90,
      idleTimeout: 3000,
      speed: 50,
      pin: 12,
      min: 26,
      max: 154
    },
    listeners: {
      publishServoMoveTo: [{ topicMethod: "publishServoMoveTo", callbackName: "left", callbackMethod: "onServoMoveTo" }]
    }
  }
  const llama3 = {
    package: "ollama",
    name: "llama3",
    config: {
      installed: true,
      url: "http://fast:11434",
      model: "llama3",
      maxHistory: 10,
      wakeWord: "wake",
      sleepWord: "sleep",
      prompt: "SarcasticBot"
    },
    listeners: { publishText: [{ topicMethod: "publishText", callbackName: "gtts", callbackMethod: "onText" }] }
  }
  const gtts = {
    package: "gtts",
    name: "gtts",
    config: { lang: "en" },
    listeners: {}
  }

  // Add the node to the launch description
  ld.actions.push(runtime)
  ld.actions.push(ui)
  ld.actions.push(clk1)
  ld.actions.push(left)
  ld.actions.push(neck)
  ld.actions.push(llama3)
  ld.actions.push(gtts)

  return ld
}

module.exports = { generateLaunchDescription }
