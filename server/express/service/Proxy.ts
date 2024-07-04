import { spawn } from "child_process"

import fs from "fs"
import path from "path"
import { PythonShell } from "python-shell"
import semver from "semver"
import Main from "../../electron/ElectronStarter"
import { CodecUtil } from "../framework/CodecUtil"
import { getLogger } from "../framework/Log"
import { Repo } from "../framework/Repo"
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

  public requirementsOk: boolean = false

  public clientInstalledOk: boolean = false

  public clientConnectionState: string = "disconnected" // connected, disconnected, connecting enum

  public clientConnected: boolean = false

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
    super.startService()
    log.info(`proxy starting service ${this.name} ${this.typeKey} ${this.version}`)
    this.ready = false // not ready until connected
    const runtime: RobotLabXRuntime = RobotLabXRuntime.getInstance()

    runtime.registerConnection(
      this.fullname,
      this.id,
      "waiting for client",
      "inbound",
      null /* ws not ready yet - client not attached */
    )

    // if this proxy is installed,
    // then we should be able to start the client
    if (this.pkg.installed) {
      log.info(`proxy starting client ${this.name} ${this.typeKey} ${this.version}`)
      this.startProxy()
    }
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

    // Initially before a client has been installed or connected all messages
    // are intercepted and handled by this stub/proxy
    // Once the client is installed and connected, the messages will be
    // sent via connection to the client

    // Very cool switch - if i have an active connection to the client,
    // then we switch from sending messages to the proxy stub to sending
    // messages to the client
    let ws: any = RobotLabXRuntime.getInstance().getConnectionImpl(this.id)

    if (!ws) {
      this.clientConnectionState = "disconnected"
      // TODO - extend to any method not just invokeMsg
      this.invokeMsg(msg)
    } else {
      // We should be the correct gateway to route this incoming message
      // it "may" be the process (gatewayRouteId) were are connected directly to
      // or it gatewayRouteId may be a gateway to msg.id remote process
      if (this.clientConnectionState === "disconnected") {
        // we send all our notifyList to the client, when it first
        // connects, so it can re-establish all the listeners
        for (let key in this.notifyList) {
          const ne = this.notifyList[key]
          ne.forEach((notifyEntry: any) => {
            let notifyMsg = new Message(this.name, "addListener", [
              key,
              notifyEntry.callbackName,
              notifyEntry.callbackMethod
            ])
            notifyMsg.sender = this.fullname
            ws.send(JSON.stringify(notifyMsg))
          })

          this.clientConnectionState = "connected"
        }
      }

      // we'll do the appropriate encoding based on the connection
      let json = JSON.stringify(msg)
      // and send it to the locally connected process for it to route
      ws.send(json)
    }
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
    log.info(`proxy (invoke) ${msgFullName}.${msg.method} from ${msg.sender}.${msg.method}`)
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
      requirementsOk: this.requirementsOk,
      clientInstalledOk: this.clientInstalledOk,
      clientConnected: this.clientConnected
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
            this.info(`More Worky !`)
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

  installVirtualEnv(envName = ".venv", envPath = this.pkg.cwd) {
    return new Promise((resolve, reject) => {
      // Full path to the virtual environment
      this.info(`envPath '${envPath}`)
      const fullPath = path.join(envPath, envName)
      this.info(`Creating virtual environment in '${fullPath}`)

      // Python script to create the virtual environment
      const pythonScript = `
import subprocess
import sys
result = subprocess.run([sys.executable, '-m', 'venv', r'${fullPath}'], capture_output=True)
print(result.stdout.decode())
print(result.stderr.decode(), file=sys.stderr)
    `

      // Run the Python script to create the virtual environment
      PythonShell.runString(pythonScript, null)
        .then(() => {
          // Check if the virtual environment was created successfully
          const activateScript = path.join(fullPath, process.platform === "win32" ? "Scripts" : "bin", "activate") // On Windows: 'Scripts' instead of 'bin'
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

  installPipRequirements(packages = {}, envName = ".venv", envPath = this.pkg.cwd): Promise<string> {
    return new Promise((resolve, reject) => {
      const packageList = ["install"]
      Object.entries(packages).map(([pkg, version]) => packageList.push(`${pkg}${version}`))

      const fullPath = path.join(envPath, envName)
      const pipPath = path.join(fullPath, process.platform === "win32" ? "Scripts" : "bin", "pip")

      const command = pipPath
      const args = packageList

      this.info(`${pipPath} ${args.join(" ")}`)
      const pipProcess = spawn(command, args)

      pipProcess.stdout.on("data", (data: Buffer) => {
        this.info(`stdout: ${data.toString()}`)
        if (
          data.toString().includes("Successfully installed") ||
          data.toString().includes("Requirement already satisfied")
        ) {
          this.requirementsOk = true
          this.invoke("broadcastState")
        }
      })

      pipProcess.stderr.on("data", (data: Buffer) => {
        const str = data.toString()
        // this.error(`stderr: ${data.toString()}`)
        if (str.startsWith("ERROR:")) {
          this.error(str)
        } else if (str.startsWith("WARN:")) {
          this.warn(str)
        } else {
          this.info(str)
        }
      })

      pipProcess.on("close", (code: number) => {
        if (code === 0) {
          resolve(`Package ${args} installed successfully.`)
        } else {
          reject(`pip install process exited with code ${code}`)
        }
      })

      pipProcess.on("error", (error: Error) => {
        this.error(`Error: ${error.message}`)
        reject(`Error: ${error.message}`)
      })
    })
  }
  // FIXME - startProxy
  startProxy(packages = {}, envName = ".venv", envPath = this.pkg.cwd): Promise<string> {
    return new Promise((resolve, reject) => {
      // python has specific path to the executable resolved by this Proxy service - with full path
      // but pkg cmd should be generalized .. how to reconcile ?

      // THIS MUST BE FIXED !!!

      const searchReplace: Record<string, string> = {
        "{{name}}": this.name,
        "{{id}}": this.id,
        // this is runtimes serviceUrl - should proxy open a new one ?
        "{{serviceUrl}}": Main.serviceUrl
      }

      const args: string[] = []

      for (let arg of this.pkg.args) {
        const keys: string[] = Object.keys(searchReplace)

        for (let key of keys) {
          arg = arg.replace(key, searchReplace[key])
        }

        args.push(arg)
      }

      const fullPath = path.join(envPath, envName)
      const pipPath = path.join(fullPath, process.platform === "win32" ? "Scripts" : "bin", "python")
      const command = pipPath

      this.info(`${pipPath} ${args.join(" ")}`)
      const pipProcess = spawn(command, args, { cwd: this.pkg.cwd })

      pipProcess.stdout.on("data", (data: Buffer) => {
        this.info(`stdout: ${data.toString()}`)
      })

      pipProcess.stderr.on("data", (data: Buffer) => {
        const str = data.toString()
        // this.error(`stderr: ${data.toString()}`)
        if (str.startsWith("ERROR:")) {
          this.error(str)
        } else if (str.startsWith("WARN:")) {
          this.warn(str)
        } else {
          this.info(str)
          // Check if the client has connected
          // This comes in on stderr because its "logging" from the client
          if (str.includes("Service started")) {
            this.clientConnected = true
            this.invoke("broadcastState")
          }
        }
      })

      pipProcess.on("close", (code: number) => {
        if (code === 0) {
          resolve(`Package ${args} installed successfully.`)
        } else {
          reject(`pip install process exited with code ${code}`)
        }
      })

      pipProcess.on("error", (error: Error) => {
        this.error(`Error: ${error.message}`)
        reject(`Error: ${error.message}`)
      })
    })
  }

  async installRepoRequirement(typeKey: string, envName = ".venv", envPath = this.pkg.cwd): Promise<string> {
    this.info(`Installing repo package ${typeKey}`)
    const rlx_pkg = CodecUtil.getPipPackageName(typeKey)

    const fullPath = path.join(envPath, envName)
    const clientPath = path.join(`${Main.expressRoot}`, "repo", typeKey.toLowerCase(), rlx_pkg)
    this.info(`Installing client ${clientPath} to ${fullPath}`)

    return new Promise<string>((resolve, reject) => {
      const args = ["install", "-e", clientPath]
      const pipPath = path.join(fullPath, process.platform === "win32" ? "Scripts" : "bin", "pip")
      const command = pipPath

      this.info(`${pipPath} ${args.join(" ")}`)
      const pipProcess = spawn(command, args)

      let stdoutData = ""
      let stderrData = ""

      pipProcess.stdout.on("data", (data: Buffer) => {
        const output = data.toString()
        stdoutData += output
        this.info(`stdout: ${output}`)
      })

      pipProcess.stderr.on("data", (data: Buffer) => {
        const output = data.toString()
        stderrData += output
        if (output.startsWith("ERROR:")) {
          this.error(output)
        } else if (output.startsWith("WARN:")) {
          this.warn(output)
        } else {
          this.info(output)
        }
      })

      pipProcess.on("close", (code: number) => {
        if (code === 0 && stdoutData.includes("Successfully installed")) {
          this.clientInstalledOk = true
          this.invoke("broadcastState")
          resolve(`Package ${args.join(" ")} installed successfully.`)
        } else {
          reject(`pip install process exited with code ${code}. Stderr: ${stderrData}`)
        }
      })

      pipProcess.on("error", (error: Error) => {
        this.error(`Error: ${error.message}`)
        reject(`Error: ${error.message}`)
      })
    })
  }

  async installRepoRequirements(envName = ".venv", envPath = this.pkg.cwd): Promise<string[]> {
    this.info(`This service requires the following repo packages: ${this.pkg.repoRequirements}`)

    const results: string[] = []
    for (const typeKey of this.pkg.repoRequirements) {
      try {
        const result = await this.installRepoRequirement(typeKey, envName, envPath)
        results.push(result)
      } catch (error) {
        this.error(`One or more packages failed to install: ${error}`)
        throw error
      }
    }

    this.info(`All packages installed successfully: ${results.join(", ")}`)

    // FIXME - Repo should be a singleton, and "installing"
    // should be a method on the repo - add timestamp, version, etc
    // Repo.getInstance().savePackage(this.pkg)
    this.error(`saving package ${this.pkg.typeKey}`)
    this.pkg.installed = true
    const repo = new Repo()
    repo.savePackage(this.pkg)
    this.error(`saved package ${this.pkg.typeKey}`)

    return results
  }
}
