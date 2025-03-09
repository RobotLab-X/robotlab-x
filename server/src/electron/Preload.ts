const { contextBridge, ipcRenderer } = require("electron")

// Fetch version information from the main process
const versions = ipcRenderer.sendSync("get-versions")

contextBridge.exposeInMainWorld("electron", {
  // playSound: for AudioPlayer --to electron --> to --> hidden
  playSound: (serviceName: string, file: string) => ipcRenderer.send("play-sound", serviceName, file),
  // onPlaySound: for hidden
  onPlaySound: (callback: (serviceName: string, file: string) => void) =>
    ipcRenderer.on("play-sound", (event, serviceName, file) => callback(serviceName, file)),
  getVersions: () => versions,
  // back to--> electron ElectronStarter.ipcMain.on("audio-finished", ....
  audioStarted: (serviceName: string, file: string) => ipcRenderer.send("audio-started", serviceName, file),
  audioFinished: (serviceName: string, file: string) => ipcRenderer.send("audio-finished", serviceName, file)
})
