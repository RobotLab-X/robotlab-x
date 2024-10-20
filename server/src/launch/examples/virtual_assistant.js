const { type } = require("os")
const path = require("path")

function generateLaunchDescription() {
  const ld = {
    description: "Generated launch description",
    version: "0.0.1",
    actions: []
  }

  // Create a node with parameters and remappings
  const mouth = {
    package: "polly",
    name: "mouth",
    config: {
      voice: "Brian",
      secretAccessKey: "XXXXXXXXXXXXXXXXXXXXXXXX",
      secretId: "XXXXXXXXXXXX",
      format: "mp3"
    },
    listeners: {
      publishPlayAudioFile: [
        { topicMethod: "publishPlayAudioFile", callbackName: "audio", callbackMethod: "onPlayAudioFile" }
      ]
    }
  }
  const audio = {
    package: "audioplayer",
    name: "audio",
    config: {},
    listeners: {}
  }
  const ear = {
    package: "pyvosk",
    name: "ear",
    config: { mic: "1", listen: false, saveAudio: true, rate: 48000, language: "en-us" },
    listeners: { publishText: [{ callbackMethod: "onText", callbackName: "brain", topicMethod: "publishText" }] }
  }
  const brain = {
    package: "ollama",
    name: "brain",
    config: {
      installed: true,
      url: "http://localhost:11434",
      model: "llama3:latest",
      maxHistory: 4,
      wakeWord: "wake",
      sleepWord: "sleep",
      prompt: "ButlerBot",
      defaultImagePrompt: "what is in this image?"
    },
    listeners: { publishText: [{ topicMethod: "publishText", callbackName: "mouth", callbackMethod: "onText" }] }
  }

  // Add the node to the launch description
  ld.actions.push(mouth)
  ld.actions.push(audio)
  ld.actions.push(ear)
  ld.actions.push(brain)

  return ld
}

module.exports = { generateLaunchDescription }
