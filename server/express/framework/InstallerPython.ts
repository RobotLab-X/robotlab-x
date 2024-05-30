import Service from "express/framework/Service"
import Package from "express/models/Package"
import { getLogger } from "./Log"

const os = require("os")
const { execSync } = require("child_process")

const log = getLogger("InstallerPython")

interface ExecException extends Error {
  stderr?: Buffer
  stdout?: Buffer
}

// FIXME - way to set RobotLabXRuntime python command to python or python3

export default class InstallerPython {
  private server: Service = null

  useVenv = true
  pythonCmd: string = "python"
  installedPythonVersion: string = null
  requestedPythonVersion: string = null
  installedPipeVersion: string = null
  isPythonInstalled = false
  isPythonInstalledCheckDone = false
  isInstalledPythonVersionValid = false
  isInstalledPythonVersionValidCheckDone = false
  isPipInstalled = false
  installedPipVersion: string = null
  isPipInstalledCheckDone = false
  requestedPipVersion: string = null
  isInstalledPipVersionValid = false
  isInstalledPipVersionValidCheckDone = false
  pipVersion: string = null
  ready = false
  options = {}
  pkg: Package = null

  constructor(public service: Service) {
    this.server = service
  }

  public install(pkg: Package): any {
    this.info(`Installer processing package ${pkg.title} ${pkg.typeKey} ${pkg.version}`)
    this.info("Checking python version")
    this.pkg = pkg
    this.options = { cwd: pkg.cwd }
    let platformInfo = { platform: "python", platformVersion: "unknown" }
    platformInfo.platformVersion = this.getPythonVersion()
    this.getPipVersion()
    this.createVenv()
    this.installRequirements()
    this.createShell()
    this.activateVenv("venv")
    // pythonCmd should be set and the version known
    if (this.useVenv) {
      this.createVenv()
    }
    // return a more meaningful object if failure
    // shows which dependency failed to install
    return platformInfo
  }

  installRequirements() {
    if (this.pkg.requirements) {
      this.info("Installing requirements")
      const cmd = `${this.pythonCmd} -m pip install -r ${this.pkg.requirements}`
      this.info(cmd)
      this.info(execSync(cmd, this.options))
    }
  }

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

  public getPythonVersion(): string {
    let versionOutput = "unknown"

    try {
      this.info(`trying python using options ${JSON.stringify(this.options)}`)
      const cmd = `${this.pythonCmd} --version`
      versionOutput = execSync(cmd, this.options).toString()
      this.info(`python found ${versionOutput}`)
      this.pythonCmd = "python"
    } catch (error) {
      this.info("python not found, trying python3")
      log.error(`exec error: ${error}`)

      try {
        const cmd = "python3 --version"
        this.info(cmd)
        versionOutput = execSync(cmd, this.options).toString()
        this.info(`python3 found ${versionOutput}`)
        this.pythonCmd = "python3"
      } catch (innerError) {
        this.info("giving up - send instructions to install python to user")
        this.error(
          "Python is required but not installed. Download it from <a target='_blank' href='https://python.org/downloads'>https://python.org/downloads</a> and follow the installation steps for your operating system. Make sure to add Python to your system's PATH."
        )
        log.error(`${innerError}`)
        throw new Error(
          `Failed to find Python interpreter. Please ensure Python is installed. Inner error: ${innerError}`
        )
        // TODO - provide instructions for installing Python
      }
    }

    // Correcting the parsing logic
    const versionMatch = versionOutput.match(/Python (\d+\.\d+\.\d+)/)
    if (versionMatch) {
      this.info(`Parsed Version: ${versionMatch[1]}`)
      this.installedPythonVersion = versionMatch[1]
    } else {
      this.info("Python version could not be parsed.")
    }
    return this.installedPythonVersion
  }

  public getPipVersion() {
    let versionOutput = ""

    try {
      // Check if pip is available with Python
      this.info(`Checking pip version using ${this.pythonCmd}`)
      versionOutput = execSync(`${this.pythonCmd} -m pip --version`, this.options).toString()
      this.info(`pip found: ${versionOutput}`)
    } catch (error) {
      this.info("pip not found or not installed correctly.")
      this.info(
        'pip is required but not installed. If Python is installed, run "python -m ensurepip" to install pip, or follow the instructions at https://pip.pypa.io/en/stable/installation/.'
      )
      log.error(`exec error: ${error}`)
      throw new Error(`Failed to find pip. Please ensure pip is installed. Error details: ${error}`)
    }

    return versionOutput
  }

  // FIXME - promote to general utilities
  compareVersions(version: string, requiredVersion: string): boolean {
    const normalizeVersion = (ver: string) => {
      const parts = ver.split(".").map(Number)
      while (parts.length < 3) {
        parts.push(0)
      }
      return parts
    }

    const [vMajor, vMinor, vPatch] = normalizeVersion(version)
    const [rMajor, rMinor, rPatch] = normalizeVersion(requiredVersion)

    if (vMajor > rMajor) return true
    if (vMajor < rMajor) return false

    if (vMinor > rMinor) return true
    if (vMinor < rMinor) return false

    if (vPatch > rPatch) return true
    if (vPatch < rPatch) return false

    return true // versions are equal
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
      let cmd = `${this.pythonCmd} -m venv ${venvPath}`
      this.info(cmd)
      this.info(execSync(cmd, this.options))
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
        log.error("An unexpected error occurred:", error)
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
      os.platform() === "win32" ? `${venvPath}\\Scripts\\${this.pythonCmd}` : `${venvPath}/bin/${this.pythonCmd}`

    let stdout = null
    try {
      this.info(activate)
      this.info(execSync(activate, this.options))
    } catch (error) {
      this.error(`Failed to run python command using the virtual environment.`)
      this.error(`${error}`)
      return
    }

    this.info(`Python version (from venv): ${stdout}`)
  }

  public checkPythonVersion(requestedPythonVersion: string): boolean {
    this.installedPythonVersion = this.getPythonVersion()
    if (this.installedPythonVersion !== null) {
      this.isPythonInstalled = true
    } else {
      this.isPythonInstalled = false
      this.isInstalledPythonVersionValid = false
      this.error("Python is not installed")
      this.service.invoke("broadcastState")
      return false
    }
    this.requestedPythonVersion = requestedPythonVersion
    const valid = this.compareVersions(this.installedPythonVersion, requestedPythonVersion)
    if (valid) {
      this.isInstalledPythonVersionValid = true
      this.info(`Python version ${this.installedPythonVersion} is valid for required version ${requestedPythonVersion}`)
    } else {
      this.isInstalledPythonVersionValid = false
      this.error(
        `Python version ${this.installedPythonVersion} is not valid for required version ${requestedPythonVersion}`
      )
    }
    this.service.invoke("broadcastState")
    return valid
  }

  public checkPipVersion(requestedPipVersion: string): boolean {
    this.installedPipVersion = this.getPipVersion()
    if (this.installedPipVersion !== null) {
      this.isPipInstalled = true
    } else {
      this.isPipInstalled = false
      this.isInstalledPipVersionValid = false
      this.error("Pip is not installed")
      this.service.invoke("broadcastState")
      return false
    }
    this.requestedPipVersion = requestedPipVersion
    const valid = this.compareVersions(this.installedPipVersion, requestedPipVersion)
    if (valid) {
      this.isInstalledPipVersionValid = true
      this.info(`Pip version ${this.installedPipVersion} is valid for required version ${requestedPipVersion}`)
    } else {
      this.isInstalledPipVersionValid = false
      this.error(`Pip version ${this.installedPipVersion} is not valid for required version ${requestedPipVersion}`)
    }
    this.service.invoke("broadcastState")
    return valid
  }

  toJSON() {
    return {
      useVenv: this.useVenv,
      pythonCmd: this.pythonCmd,
      installedPythonVersion: this.installedPythonVersion,
      requestedPythonVersion: this.requestedPythonVersion,
      installedPipeVersion: this.installedPipeVersion,
      isPythonInstalled: this.isPythonInstalled,
      isPythonInstalledCheckDone: this.isPythonInstalledCheckDone,
      isInstalledPythonVersionValid: this.isInstalledPythonVersionValid,
      isInstalledPythonVersionValidCheckDone: this.isInstalledPythonVersionValidCheckDone,
      isPipInstalled: this.isPipInstalled,
      installedPipVersion: this.installedPipVersion,
      isPipInstalledCheckDone: this.isPipInstalledCheckDone,
      requestedPipVersion: this.requestedPipVersion,
      isInstalledPipVersionValid: this.isInstalledPipVersionValid,
      isInstalledPipVersionValidCheckDone: this.isInstalledPipVersionValidCheckDone,
      pipVersion: this.pipVersion,
      ready: this.ready,
      options: this.options,
      pkg: this.pkg
    }
  }
}
