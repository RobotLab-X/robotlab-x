const { contextBridge, ipcRenderer } = require("electron")

// Fetch version information from the main process
const versions = ipcRenderer.sendSync("get-versions")

contextBridge.exposeInMainWorld("electron", {
  playSound: (file: string) => ipcRenderer.send("play-sound", file),
  onPlaySound: (callback: (file: string) => void) => ipcRenderer.on("play-sound", (event, file) => callback(file)),
  getVersions: () => versions
})
