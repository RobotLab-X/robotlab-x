const { type } = require("os")
const path = require("path")

function generateLaunchDescription() {
  const ld = {
    description:
      "A opencv service to capture images and publish them to a ollama service.  The ollama service will then use the image to generate a response.",
    version: "0.0.1",
    actions: []
  }

  // Create a node with parameters and remappings
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
    config: { camera_index: "0", debounce: 24, capture: true },
    listeners: {
      publishInputBase64: [{ callbackMethod: "onImage", callbackName: "llava", topicMethod: "publishInputBase64" }]
    }
  }

  // Add the node to the launch description
  ld.actions.push(llava)
  ld.actions.push(cv1)

  return ld
}

module.exports = { generateLaunchDescription }
