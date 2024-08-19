const { type } = require("os")
const path = require("path")

function generateLaunchDescription() {
  const ld = {
    description:
      "A basic setup which does speech recognition, passes the text to ollama, then ollama sends the response to a speech synthesizer",
    version: "0.0.1",
    actions: []
  }

  // Create a node with parameters and remappings
  const ollama = {
    package: "ollama",
    name: "ollama",
    config: {
      installed: true,
      url: "http://localhost:11434",
      model: "llama3",
      maxHistory: 4,
      wakeWord: "wake",
      sleepWord: "sleep",
      prompt: "ButlerBot",
      defaultImagePrompt: "what is in this image?",
      stream: false
    },
    listeners: { publishText: [{ callbackMethod: "onText", callbackName: "gtts", topicMethod: "publishText" }] }
  }
  const vosk = {
    package: "pyvosk",
    name: "vosk",
    config: { mic: "1", listen: false, saveAudio: true, rate: 48000, language: "en-us" },
    listeners: { publishText: [{ callbackMethod: "onText", callbackName: "ollama", topicMethod: "publishText" }] }
  }
  const gtts = {
    package: "gtts",
    name: "gtts",
    config: { lang: "en" },
    listeners: {}
  }

  // Add the node to the launch description
  ld.actions.push(ollama)
  ld.actions.push(vosk)
  ld.actions.push(gtts)

  return ld
}

module.exports = { generateLaunchDescription }
