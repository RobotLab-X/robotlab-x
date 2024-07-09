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
    config: { autoLaunch: null, id: "icky-golem", logLevel: "info", port: 3001, connect: [] }
    // listeners: {
    //  {{listeners}}
    //}
  }
  const ui = {
    package: "robotlabxui",
    name: "ui",
    config: {}
    // listeners: {
    //  {{listeners}}
    //}
  }
  const ollama = {
    package: "ollama",
    name: "ollama",
    config: {
      installed: true,
      url: "http://fast:11434",
      model: "llama3",
      maxHistory: 10,
      wakeWord: "wake",
      sleepWord: "sleep",
      prompt: "PirateBot"
    }
    // listeners: {
    //  {{listeners}}
    //}
  }
  const uno = {
    package: "arduino",
    name: "uno",
    config: { intervalMs: 1000, port: "/dev/ttyACM3", connect: true }
    // listeners: {
    //  {{listeners}}
    //}
  }
  const s1 = {
    package: "servo",
    name: "s1",
    config: { autoDisable: true, controller: "uno", rest: 90, idleTimeout: 3000, speed: 50, pin: 9 }
    // listeners: {
    //  {{listeners}}
    //}
  }
  const vosk = {
    package: "pyvosk",
    name: "vosk",
    config: { mic: "4", listen: false, saveAudio: true, rate: null, language: "en-us" }
    // listeners: {
    //  {{listeners}}
    //}
  }
  const gtts = {
    package: "gtts",
    name: "gtts",
    config: { lang: "en" }
    // listeners: {
    //  {{listeners}}
    //}
  }
  const opencv = {
    package: "opencv",
    name: "opencv",
    config: { camera_index: "0" }
    // listeners: {
    //  {{listeners}}
    //}
  }

  // Add the node to the launch description
  ld.actions.push(runtime)
  ld.actions.push(ui)
  ld.actions.push(ollama)
  ld.actions.push(uno)
  ld.actions.push(s1)
  ld.actions.push(vosk)
  ld.actions.push(gtts)
  ld.actions.push(opencv)

  return ld
}

module.exports = { generateLaunchDescription }
