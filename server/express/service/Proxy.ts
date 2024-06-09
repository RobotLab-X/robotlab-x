import fs from "fs"
import path from "path"
import { PythonShell } from "python-shell"
import semver from "semver"
import { CodecUtil } from "../framework/CodecUtil"
import InstallerPython from "../framework/InstallerPython"
import { getLogger } from "../framework/Log"
import Service from "../framework/Service"
import Message from "../models/Message"
import RobotLabXRuntime from "./RobotLabXRuntime"

const log = getLogger("Proxy")

/**
 * TODO - check out inprocess python calls - https://www.npmjs.com/package/node-calls-python
 *
 * General Proxy Service - a service that proxies all calls to another process id.
 * By itself its not very useful, but it allows message routing
 * to and from the target service.
 *
 * "Also" responsible for installing out of process - proxied services locally
 */
export default class Proxy extends Service {
  /**
   * Very important sub type of a Proxy
   * This is the type of the service that the proxy is proxying
   *
   */
  public proxyTypeKey: string = null

  // @deprecated - use PythonShell
  installer: InstallerPython = null

  /**
   * Many "most?" proxies will be proxies for python services
   * This is the version of python available on the host system
   */
  public pythonVersion: string = null

  public pythonVersionOk: boolean = false

  /**
   * Many "most?" proxies will be proxies for python services
   * This is the version of pip available on the host system
   */
  public pipVersion: string = null

  public pipVersionOk: boolean = false

  public venvOk: boolean = false

  public venvPath: string = null

  /**
   * Method intercepts are methods that are handled by the proxy
   * directly.  This is a way to handle UI or other data that
   * is not available until "after" the proxied service is installed
   * and  started and connected.
   */
  methodIntercepts: any = {
    addListener: "invokeMsg",
    checkPythonVersion: "invokeMsg",
    checkPipVersion: "invokeMsg",
    installVirtualEnv: "invokeMsg",
    broadcastState: "invokeMsg"
  }

  constructor(
    public id: string,
    public name: string,
    public typeKey: string,
    public version: string,
    public hostname: string
  ) {
    super(id, name, typeKey, version, hostname)
  }

  startService(): void {
    // log.info(`Starting OakD service`)
    super.startService()
    // FIXME - make an interface for installers
    // if pkg.platform === "python" then make a python installer
    this.installer = new InstallerPython(this)
    // platformInfo = installer.install(this.pkg)
    const runtime: RobotLabXRuntime = RobotLabXRuntime.getInstance()

    runtime.registerConnection(
      this.fullname,
      this.id,
      "waiting for client",
      "inbound",
      null /* ws not ready yet - client not attached */
    )
  }

  /**
   * Requesting to send a message to a remote process
   * @param msg
   */
  public sendRemote(msg: Message): void {
    // initially we'll get a barrage of messages from the UI after the
    // service is first created - these are important, but cannot be
    // handled until the remote process is brought up

    // onces the remote process with the client is brought up, we might
    // need to grab and modify the connection details and routes in Runtime

    // default is runtime's sendRemote
    // RobotLabXRuntime.getInstance().sendRemote(msg)

    log.warn(`sendRemote ${this.fullname} got msg ${JSON.stringify(msg)}`)

    if (msg.method in this.methodIntercepts) {
      // TODO - extend to any method not just invokeMsg
      this.invokeMsg(msg)
    }

    // if (msg.method === "checkPythonVersion") {
    //   this.checkPythonVersion()
    // } else if (msg.method === "checkPipVersion") {
    //   this.checkPipVersion()
    // } else if (msg.method === "addListener") {
    //   this.invokeMsg(msg)
    //   // this.checkPipVersion()
    // }
  }

  /**
   * Invoke on a Proxy has a very different meaning than invoke on a "local" Service.
   * This Proxy is local and can assist in routing messages to a remote service or installing
   * a client service on the same host.  However, since its process id is different, it cannot
   * use Service.invoke.
   *
   * @param methodName
   * @param args
   * @returns
   */
  invoke(methodName: string, ...args: any[]): any {
    log.warn(`proxy invoke ${this.fullname}.${methodName}`)
    // determine if we want to invoke this on ourselves (proxy)
    // or relay it to the remote service

    // maybe all "invoked" messages are executed here and
    // simply re-written as a message to the remote service

    log.warn(`invoke ${this.fullname}.${methodName}`)
    let msg = new Message(this.name, methodName, args)
    msg.sender = this.fullname
    return this.invokeMsg(msg)
  }

  /**
   * Invoke a message on the remote service
   * Overloaded from Service, because for a proxy it means something different
   * @param msg
   */
  public invokeMsg(msg: Message): any {
    log.warn(`proxy invokeMsg ${this.fullname}.${msg.method}`)
    const msgFullName = CodecUtil.getFullName(msg.name)
    let ret: any = null

    if (msg.data && msg.data.length > 0) {
      // log.info(`--> ${msg.sender} --> ${msg.name}.${msg.method}(${JSON.stringify(msg.data)})`)
      log.info(`--> ${msg.sender} --> ${msg.name}.${msg.method}(...)`)
    } else {
      log.info(`--> ${msg.sender} --> ${msg.name}.${msg.method}()`)
    }

    // ==== LOCAL/REMOTE(ISH) ====
    // FIXME - check if blocking or non-blocking
    // is this the service to invoke the method on ?
    // if (fullName === msgFullName) {
    log.info(`(invoke) ${msgFullName}.${msg.method} from ${msg.sender}.${msg.method}`)
    let obj: any = this // cast away typescript

    if (!msg.method) {
      // ui error - user should be informed
      console.error(`method ${msg.method} not found`)
      return null
    }

    // invoke locally
    log.debug(`invoking ${this.name}.${msg.method}`)
    try {
      if (msg.data && msg.data.length > 0) {
        ret = obj[msg.method](...msg.data)
      } else {
        ret = obj[msg.method]()
      }
    } catch (e) {
      log.error(`failed to invoke ${this.name}.${msg.method} because ${e}`)
    }

    // normalize undefined to null
    if (ret === undefined) {
      ret = null
    }

    log.warn(`ret ${JSON.stringify(ret)}`)

    // TODO - process subscription
    if (this.notifyList[msg.method]) {
      log.warn("subscriber exists")
      this.notifyList[msg.method].forEach((listener: any) => {
        let subMsg = new Message(listener.callbackName, listener.callbackMethod, [ret])
        subMsg.sender = this.fullname
        // log.info(`<- notify ${listener.callbackName}.${listener.callbackMethod}`)
        RobotLabXRuntime.getInstance().sendRemote(subMsg)
        // this.invokeMsg(subMsg)
      })
    } else {
      log.warn("no subscriber")
    }
    return ret
    // }
  }

  toJSON() {
    return {
      ...super.toJSON(),
      proxyTypeKey: this.proxyTypeKey,
      pythonVersion: this.pythonVersion,
      pythonVersionOk: this.pythonVersionOk,
      pipVersionOk: this.pipVersionOk,
      pipVersion: this.pipVersion,
      venvOk: this.venvOk,
      venvPath: this.venvPath,
      installer: this.installer.toJSON()
    }
  }

  checkPythonVersion(requiredVersion: string = "3.6.0") {
    try {
      // Get the default Python version
      const versionString = PythonShell.getVersionSync()
      this.info(`Raw Python Version: ${versionString}`)

      // Parse the version string to get the semantic version
      const versionMatch = versionString.match(/Python (\d+\.\d+\.\d+)/)
      if (!versionMatch) {
        this.error("Unable to parse Python version")
        return
      }

      const currentVersion = versionMatch[1]
      this.info(`Parsed Python Version: ${currentVersion}`)

      // Compare the current version with the required version
      if (semver.gte(currentVersion, requiredVersion)) {
        this.info(`Current Python version (${currentVersion}) is >= required version (${requiredVersion})`)
        this.pythonVersion = currentVersion
        this.pythonVersionOk = true
        this.info(`Worky !`)
        this.invoke("broadcastState")
      } else {
        this.error(`Current Python version (${currentVersion}) is < required version (${requiredVersion})`)
        this.pythonVersion = currentVersion
        this.pythonVersionOk = false
        this.invoke("broadcastState")
      }
    } catch (err: any) {
      console.error("Error:", err)
      this.error(err.message)
    }
  }

  normalizeVersion(version: string) {
    const parts = version.split(".")
    while (parts.length < 3) {
      parts.push("0")
    }
    return parts.join(".")
  }

  /**
   * Check the pip version - part of necessary preparations
   * to install a python client
   */
  checkPipVersion(requiredVersion = "21.0.0") {
    try {
      // Python command to get the pip version
      const pythonCommand = "import pip; print(pip.__version__)"

      // Run the Python command to get pip version
      PythonShell.runString(pythonCommand, null)
        .then((results) => {
          const versionString = results[0]
          this.info(`Raw pip Version: ${versionString}`)

          // Normalize the version string to get the semantic version
          const currentVersion = this.normalizeVersion(versionString.trim())
          this.info(`Normalized pip Version: ${currentVersion}`)

          // Compare the current version with the required version
          if (semver.gte(currentVersion, requiredVersion)) {
            this.info(`Current pip version (${currentVersion}) is >= required version (${requiredVersion})`)
            this.info(`Worky again here too !`)
            this.pipVersion = currentVersion
            this.pipVersionOk = true
            this.invoke("broadcastState")
          } else {
            this.error(`Current pip version (${currentVersion}) is < required version (${requiredVersion})`)
            this.pipVersion = currentVersion
            this.pipVersionOk = false
            this.invoke("broadcastState")
          }
        })
        .catch((err) => {
          this.error(`Error: ${err.message}`)
        })
    } catch (err: any) {
      this.error(`Error: ${err.message}`)
    }
  }

  installVirtualEnv(envName = "venv", envPath = this.pkg.cwd) {
    return new Promise((resolve, reject) => {
      // Full path to the virtual environment
      const fullPath = path.join(envPath, envName)
      this.info(`Creating virtual environment in '${fullPath}`)

      // Python script to create the virtual environment
      const pythonScript = `
import subprocess
import sys
result = subprocess.run([sys.executable, '-m', 'venv', '${fullPath}'], capture_output=True)
print(result.stdout.decode())
print(result.stderr.decode(), file=sys.stderr)
    `

      // Run the Python script to create the virtual environment
      PythonShell.runString(pythonScript, null)
        .then(() => {
          // Check if the virtual environment was created successfully
          const activateScript = path.join(fullPath, "bin", "activate") // On Windows: 'Scripts' instead of 'bin'
          if (fs.existsSync(activateScript)) {
            this.venvOk = true
            this.info(`Virtual environment '${envName}' created successfully at ${fullPath}`)
            resolve(`Virtual environment '${envName}' created successfully at ${fullPath}`)

            // So do not rely on the UI send order ...
            // the asyncio of express will switch on a long running task
            // So, if the ui does sendTo("installVirtualEnv") then sendTo("broadcastState")
            // the broadcastState will be processed first .. that's why we broadcast here

            this.invoke("broadcastState")
          } else {
            this.venvOk = false
            this.error(`Virtual environment '${envName}' creation failed`)
            this.invoke("broadcastState")
            reject(`Virtual environment '${envName}' creation failed`)
          }
        })
        .catch((err) => {
          this.venvOk = false
          this.error(`Error: ${err.message}`)
          this.invoke("broadcastState")
          reject(`Error: ${err.message}`)
        })
    })
  }

  installPipRequirements(envName = "venv", envPath = this.pkg.cwd, requirementsFile = "requirements.txt") {
    return new Promise((resolve, reject) => {
      // Full path to the virtual environment
      const fullPath = path.join(envPath, envName)
      // Path to the requirements file
      const requirementsPath = path.join(envPath, requirementsFile)

      // Validate that the requirements file exists
      if (!fs.existsSync(requirementsPath)) {
        this.error(`Requirements file '${requirementsFile}' not found at ${envPath}`)
        this.invoke("broadcastState")
        return reject(`Requirements file '${requirementsFile}' not found at ${envPath}`)
      }

      // Command to install pip requirements
      const pythonCommand = `
import subprocess
import sys
result = subprocess.run([sys.executable, '-m', 'pip', 'install', '-r', '${requirementsPath}'], capture_output=True, text=True)
print(result.stdout)
print(result.stderr, file=sys.stderr)
      `

      // Run the Python command to install the requirements
      const options = { pythonPath: path.join(fullPath, process.platform === "win32" ? "Scripts" : "bin", "python") }
      PythonShell.runString(pythonCommand, options)
        .then((results) => {
          this.info(`Pip requirements installed successfully: ${results}`)
          this.invoke("broadcastState")
          resolve(`Pip requirements installed successfully`)
        })
        .catch((err) => {
          this.error(`Error installing pip requirements: ${err.message}`)
          this.invoke("broadcastState")
          reject(`Error installing pip requirements: ${err.message}`)
        })
    })
  }
}
