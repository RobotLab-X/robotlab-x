import RobotLabXRuntime from "../service/RobotLabXRuntime"

const os = require("os")
const { exec } = require("child_process")

export default class InstallerPython {
  private server: RobotLabXRuntime = RobotLabXRuntime.getInstance()

  public install() {
    this.info("Checking python version")
    this.checkPythonVersion()
  }

  info(info: string) {
    this.server.invoke("publishInstallLog", info)
  }

  public checkPythonVersion() {
    exec("python --version", (error: Error | null, stdout: string, stderr: string) => {
      this.info(`error: ${error} stdout: ${stdout} stderr: ${stderr}`)
      if (error) {
        this.info("python not found trying python3")
        console.error(`exec error: ${error}`)
        exec("python3 --version", (error: Error | null, stdout: string, stderr: string) => {
          this.info(`error: ${error} stdout: ${stdout} stderr: ${stderr}`)
          if (error) {
            this.info("giving up - send instructions to install python to user")
            console.error(`exec error: ${error}`)
            return
          }
        })
      }

      // Python writes the version info to stderr if called with 'python --version'
      // On some systems, it might be written to stdout
      const versionOutput = stderr || stdout
      this.info(`python Version: ${versionOutput}`)
      console.info(`python Version: ${versionOutput}`)

      // You can parse the version number if needed
      const versionMatch = versionOutput.match(/Python (\d+\.\d+\.\d+)/)
      if (versionMatch) {
        console.log(`parsed Version: ${versionMatch[1]}`)
      } else {
        console.log("python version could not be parsed.")
      }
    })
  }

  public checkPythonInstallation(requiredVersion = "3.8.0") {
    exec("python --version", (error: Error | null, stdout: string, stderr: string) => {
      // Python version command output might be in stderr or stdout
      const versionOutput = stdout || stderr
      const versionMatch = versionOutput.match(/Python (\d+\.\d+\.\d+)/)
      const currentVersion = versionMatch ? versionMatch[1] : null

      if (error || !currentVersion) {
        return this.provideInstallationSteps()
      }

      console.log(`Found Python version: ${currentVersion}`)
      if (this.compareVersions(currentVersion, requiredVersion) < 0) {
        console.log(`Python version ${requiredVersion} or newer is required.`)
        this.provideInstallationSteps()
      } else {
        console.log("Python version meets the requirement.")
      }
    })
  }

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
    const venvPath = "my_venv" // Path where the virtual environment should be created

    exec(`python -m venv ${venvPath}`, (error: Error | null) => {
      if (error) {
        console.error("Failed to create a Python virtual environment.")
        return
      }
      console.log(`Virtual environment created at ${venvPath}`)
    })
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
    const pythonExecutable = os.platform() === "win32" ? `${venvPath}\\Scripts\\python` : `${venvPath}/bin/python`

    exec(`${pythonExecutable} --version`, (error: Error | null, stdout: string, stderr: string) => {
      if (error) {
        console.error("Failed to run python command using the virtual environment.")
        return
      }
      console.log(`Python version (from venv): ${stdout || stderr}`)
    })
  }
}
