import RobotLabXRuntime from "../service/RobotLabXRuntime"
import { getLogger } from "./Log"

const os = require("os")
const { execSync } = require("child_process")

const log = getLogger("Service")

interface ExecException extends Error {
  stderr?: Buffer
  stdout?: Buffer
}

// FIXME - way to set RobotLabXRuntime python command to python or python3

export default class InstallerPython {
  private server: RobotLabXRuntime = RobotLabXRuntime.getInstance()

  useVenv = true
  pythonExe: string = "python"
  pythonExeVersion: string = null
  pipVersion: string = null

  ready = false

  optons = {
    cwd: "/path/to/directory"
  }

  public install() {
    this.info("Checking python version")
    this.getPythonVersion()
    this.getPipVersion()
    this.installVirtualEnvPackage()
    this.createVenv()
    this.createShell()
    this.activateVenv("venv")
    // pythonExe should be set and the version known
    if (this.useVenv) {
      this.createVenv()
    }
  }

  installVirtualEnvPackage() {}

  createShell() {}
  /**
   *
   * @returns true if all dependencies are installed and ready
   */
  isReady() {
    return this.ready
  }

  info(msg: string | null) {
    log.info(msg)
    this.server.invoke("publishInstallLog", `info: ${msg}`)
  }

  warn(msg: string | null) {
    log.warn(msg)
    this.server.invoke("publishInstallLog", `warn: ${msg}`)
  }

  error(msg: string | null) {
    log.error(msg)
    this.server.invoke("publishInstallLog", `error: ${msg}`)
  }

  public getPythonVersion() {
    let versionOutput = ""

    try {
      versionOutput = execSync("python --version", this.optons).toString()
      this.info(`python found ${versionOutput}`)
      this.pythonExe = "python"
    } catch (error) {
      this.info("python not found, trying python3")
      console.error(`exec error: ${error}`)

      try {
        versionOutput = execSync("python3 --version", this.optons).toString()
        this.info(`python3 found ${versionOutput}`)
        this.pythonExe = "python3"
      } catch (error) {
        this.info("giving up - send instructions to install python to user")
        console.error(`${error}`)
        return
      }
    }

    // Correcting the parsing logic
    const versionMatch = versionOutput.match(/Python (\d+\.\d+\.\d+)/)
    if (versionMatch) {
      this.info(`Parsed Version: ${versionMatch[1]}`)
      this.pythonExeVersion = versionMatch[1]
    } else {
      this.info("Python version could not be parsed.")
    }
  }

  public getPipVersion() {}

  // FIXME - promote to general utilities
  public compareVersions(v1: string, v2: string) {
    const parts1 = v1.split(".").map(Number)
    const parts2 = v2.split(".").map(Number)
    for (let i = 0; i < 3; i++) {
      if (parts1[i] > parts2[i]) return 1
      if (parts1[i] < parts2[i]) return -1
    }
    return 0
  }

  public provideInstallationSteps() {
    let instructions = ""
    switch (os.platform()) {
      case "win32":
        instructions =
          "Python is not installed or not found. For Windows, download Python from https://www.python.org/downloads/windows/ and follow the installation instructions."
        break
      case "darwin":
        instructions =
          "Python is not installed or not found. For macOS, install Python using Homebrew: brew install python"
        break
      case "linux":
        instructions =
          "Python is not installed or not found. For Linux, use your package manager to install Python. For example, on Ubuntu or Debian: sudo apt-get install python3"
        break
      default:
        instructions =
          "Unsupported operating system. Please visit https://www.python.org/downloads/ for installation instructions."
    }

    console.log(instructions)
    return instructions
  }

  public createVenv() {
    const venvPath = "venv" // Path where the virtual environment should be created
    try {
      let cmd = `${this.pythonExe} -m venv ${venvPath}`
      this.info(cmd)
      this.info(execSync(cmd, this.optons))
    } catch (error: unknown) {
      // TODO standard error format for robotlab-x
      this.error(`Failed to create a Python virtual environment.`)
      this.error(`${error}`)

      if (typeof error === "object" && error !== null) {
        const execError = error as ExecException
        this.error(`message: ${execError.message}`) // `message` is part of `Error`
        this.error(`stderr: ${execError.stderr?.toString()}`) // Convert Buffer to string if it exists
        this.error(`stdout: ${execError.stdout?.toString()}`) // Convert Buffer to string if it exists
      } else {
        console.error("An unexpected error occurred:", error)
      }
      return
    }
    this.info(`Virtual environment created at ${venvPath}`)
  }

  public getVenvActivationCommand(venvPath: string) {
    switch (os.platform()) {
      case "win32":
        return `${venvPath}\\Scripts\\activate`
      case "darwin":
      case "linux":
        return `source ${venvPath}/bin/activate`
      default:
        throw new Error("Unsupported platform")
    }
  }

  public activateVenv(venvPath: string) {
    const command = this.getVenvActivationCommand(venvPath)

    console.log("To activate the Python virtual environment, run the following command:")
    console.log(command)

    // Example of running a command using the venv's Python executable
    // Adjust the paths according to your setup
    const activate =
      os.platform() === "win32" ? `${venvPath}\\Scripts\\${this.pythonExe}` : `${venvPath}/bin/${this.pythonExe}`

    let stdout = null
    try {
      this.info(activate)
      this.info(execSync(activate, this.optons))
    } catch (error) {
      this.error(`Failed to run python command using the virtual environment.`)
      this.error(`${error}`)
      return
    }

    this.info(`Python version (from venv): ${stdout}`)
  }
}
