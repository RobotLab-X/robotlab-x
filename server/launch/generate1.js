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
  const llava = {
    package: "ollama",
    name: "llava",
    config: {
      installed: true,
      url: "http://fast:11434",
      model: "llava:latest",
      maxHistory: 4,
      wakeWord: "wake",
      sleepWord: "sleep",
      prompt: "ButlerBot",
      defaultImagePrompt: "what is in this image?"
    },
    listeners: {}
  }
  const cv1 = {
    package: "opencv",
    name: "cv1",
    config: { camera_index: "0", debounce: 8 },
    listeners: {}
  }

  // Add the node to the launch description
  ld.actions.push(runtime)
  ld.actions.push(ui)
  ld.actions.push(llava)
  ld.actions.push(cv1)

  return ld
}

module.exports = { generateLaunchDescription }
