const { app, BrowserWindow, ipcMain, dialog } = require("electron")
const { spawn } = require("child_process")
const fs = require("fs")
const path = require("path")
const os = require("os")

let mainWindow
let robotlabxVersions = ["latest", "0.9.125", "0.9.124", "0.9.123"]
let robotlabxVersion = "0.9.125"
let selectedDirectory = null

const npmPath = path.join(__dirname, "node_modules", "npm", "bin", "npm-cli.js")
const nodePath = process.execPath
let cloneDir = null

// FIXME - this will need to change to be userDir or AppData dir
const pidDir = path.join(__dirname, "pids")

if (!fs.existsSync(pidDir)) {
  fs.mkdirSync(pidDir)
}

console.info(`PID directory: ${pidDir}`)

// Function to dynamically import ps-list and use it
async function getPsList() {
  const psList = await import("ps-list") // Dynamically import ps-list
  return psList.default() // Ensure we call the default export (which is a function)
}

app.on("ready", () => {
  console.info("App ready")
  mainWindow = new BrowserWindow({
    width: 800,
    height: 540,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    autoHideMenuBar: true,
    // frame: false,
    icon: path.join(__dirname, "icon.png")
  })

  mainWindow.loadFile("index.html")

  mainWindow.webContents.on("did-finish-load", () => {
    console.info("did-finish-load")
    mainWindow.webContents.send("set-version", robotlabxVersion)
    mainWindow.webContents.send("set-versions", robotlabxVersions)

    // Query system details
    const systemDetails = {
      architecture: os.arch(),
      platform: os.platform(),
      osVersion: os.version ? os.version() : "Unknown", // os.version() might not be available on all systems
      release: os.release(),
      type: os.type(),
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      cpuCores: os.cpus().length
    }

    console.info("system details", systemDetails)
    // Send system details to the renderer process
    mainWindow.webContents.send("system-details", systemDetails)

    // list node_modules
    console.info("node_modules", fs.readdirSync(path.join(__dirname, "node_modules")))
  })
})

ipcMain.on("choose-directory", (event) => {
  dialog
    .showOpenDialog(mainWindow, {
      properties: ["openDirectory"]
    })
    .then((result) => {
      if (!result.canceled && result.filePaths.length > 0) {
        selectedDirectory = result.filePaths[0]
        event.sender.send("directory-selected", selectedDirectory)
      } else {
        event.sender.send("install-error", "No directory selected")
      }
    })
    .catch((err) => {
      console.error("Error selecting directory:", err)
      event.sender.send("install-error", "Error selecting directory")
    })
})

ipcMain.on("install-package", (event, { installDir }) => {
  console.log(`Cloning RobotLab-X repository to ${installDir}`)

  let tag = robotlabxVersion
  cloneDir = path.join(installDir, `robotlab-x-${tag}`)

  const cloneProcess = spawn("git", ["clone", "--depth", "1", "https://github.com/RobotLab-X/robotlab-x.git", cloneDir])

  cloneProcess.stdout.on("data", (data) => {
    event.sender.send("install-output", `STDOUT: ${data}`)
  })

  cloneProcess.stderr.on("data", (data) => {
    event.sender.send("install-output", `STDERR: ${data}`)
  })

  cloneProcess.on("close", (code) => {
    if (code === 0) {
      event.sender.send("install-output", "Git clone completed successfully!\n")

      console.info(`npm install in ${cloneDir} with node ${nodePath} and npm ${npmPath}`)

      const npmInstallProcess = spawn(nodePath, [npmPath, "run", "install-all"], {
        cwd: cloneDir,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
      })

      npmInstallProcess.stdout.on("data", (data) => {
        event.sender.send("install-output", `NPM STDOUT: ${data}`)
        if (data.includes("Building fresh packages")) {
          event.sender.send("install-output", `CLIENT INSTALL STDOUT: This may take a while...`)
        }
      })

      npmInstallProcess.stderr.on("data", (data) => {
        event.sender.send("install-output", `NPM STDERR: ${data}`)
      })

      npmInstallProcess.on("close", (npmCode) => {
        if (npmCode === 0) {
          event.sender.send("install-output", "NPM install completed successfully!\n")

          // client build and install
          const clientBuildProcess = spawn(nodePath, [npmPath, "run", "build-client"], {
            cwd: cloneDir,
            env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
          })

          clientBuildProcess.stdout.on("data", (data) => {
            event.sender.send("install-output", `CLIENT BUILD STDOUT: ${data}`)
            if (data.includes("production build")) {
              event.sender.send("install-output", `CLIENT INSTALL STDOUT: This may take a while...`)
            }
          })

          clientBuildProcess.stderr.on("data", (data) => {
            event.sender.send("install-output", `CLIENT BUILD STDERR: ${data}`)
          })

          clientBuildProcess.on("close", (clientBuildCode) => {
            if (clientBuildCode === 0) {
              event.sender.send("install-output", "CLIENT BUILD completed successfully!\n")

              const clientInstallProcess = spawn(nodePath, [npmPath, "run", "install-client"], {
                cwd: cloneDir,
                env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
              })

              clientInstallProcess.stdout.on("data", (data) => {
                event.sender.send("install-output", `CLIENT INSTALL STDOUT: ${data}`)
              })

              clientInstallProcess.stderr.on("data", (data) => {
                event.sender.send("install-output", `CLIENT INSTALL STDERR: ${data}`)
              })

              clientInstallProcess.on("close", (clientInstallCode) => {
                if (clientInstallCode === 0) {
                  event.sender.send("install-output", "CLIENT INSTALL completed successfully!\n")
                  // install completed
                  event.sender.send("install-complete")
                } else {
                  event.sender.send("install-output", `CLIENT INSTALL failed with code ${clientInstallCode}\n`)
                  event.sender.send("install-error", `CLIENT INSTALL failed with code ${clientInstallCode}`)
                }
              })
            } else {
              event.sender.send("install-output", `CLIENT BUILD failed with code ${clientBuildCode}\n`)
              event.sender.send("install-error", `CLIENT BUILD failed with code ${clientBuildCode}`)
            }
          })
        } else {
          event.sender.send("install-output", `NPM install failed with code ${npmCode}\n`)
          event.sender.send("install-error", `NPM install failed with code ${npmCode}`)
        }
      })
    } else {
      event.sender.send("install-output", `Git clone failed with code ${code}\n`)
      event.sender.send("install-error", `Git clone failed with code ${code}`)
    }
  })
})

ipcMain.on("start-application", (event) => {
  console.log("Start button pressed, starting RobotLab-X...")
  spawnChildProcess()
  checkAliveProcesses()
})

// Function to check if child processes are still alive
async function checkAliveProcesses() {
  try {
    // Get all the PID files from the directory
    const pidFiles = fs.readdirSync(pidDir)

    // Get a list of all running processes
    const processes = await getPsList() // This should return an array

    pidFiles.forEach((pidFile) => {
      const pid = parseInt(pidFile.replace(".pid", ""), 10)

      // Check if the process is still alive
      const isAlive = processes.some((proc) => proc.pid === pid)

      if (isAlive) {
        console.log(`Child process with PID ${pid} is still alive.`)
      } else {
        console.log(`Child process with PID ${pid} is no longer running. Removing PID file.`)
        fs.unlinkSync(path.join(pidDir, pidFile)) // Remove the PID file if the process is dead
      }
    })
  } catch (error) {
    console.error("Error checking processes:", error)
  }
}

// Function to spawn a detached child process and save its PID
function spawnChildProcess() {
  const child = spawn(nodePath, [npmPath, "run", "electron-dev"], {
    cwd: path.join(cloneDir, "server"),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    detached: true,
    stdio: "ignore"
  })

  // Save the child's PID in a file named after its PID
  const pidFile = path.join(pidDir, `${child.pid}.pid`)
  fs.writeFileSync(pidFile, String(child.pid))

  // Detach the child so it runs independently
  child.unref()

  console.log(`Child process spawned with PID: ${child.pid}`)
}
