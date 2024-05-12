// import Service from "express/framework/Service"
// FIXME - aliases don't appear to be work, neither does root reference path
import { spawn } from "child_process"
import { LaunchAction } from "express/framework/LaunchDescription"
import fs from "fs"
import http from "http"
import https from "https"
import os from "os"
import path from "path"
import { WebSocket } from "ws"
import YAML from "yaml"
import Store from "../../express/Store"
import { CodecUtil } from "../framework/CodecUtil"
import InstallerPython from "../framework/InstallerPython"
import { getLogger } from "../framework/Log"
import NameGenerator from "../framework/NameGenerator"
import { Repo } from "../framework/Repo"
import Service from "../framework/Service"
import { HostData } from "../models/HostData"
import Message from "../models/Message"
import Package from "../models/Package"
import { ProcessData } from "../models/ProcessData"
import { ServiceTypeData } from "../models/ServiceTypeData"
// import LaunchDescription from "express/framework/LaunchDescription"
// const LaunchDescription = require("express/framework/LaunchDescription").default

const log = getLogger("RobotLabXRuntime")

interface Error {
  stack?: string | undefined
}
// import Service from "@framework/Service"
export default class RobotLabXRuntime extends Service {
  private static instance: RobotLabXRuntime

  protected dataDir = "./data"
  protected configDir = "./config"
  protected configName: string
  protected repo = new Repo()

  // must be pid or userdefined {pid/id}
  protected processes: { [id: string]: ProcessData } = {}

  // FIXME - how to organize fqdn, hostname, ip, mac, etc. user defined?
  //  hostname or userdefined ? {hostname}
  protected hosts: { [id: string]: HostData } = {}

  // FIXME - make a connection class
  protected connections: { [id: string]: any } = {}

  // static meta data from both registered services and
  // local packages
  protected types: { [id: string]: ServiceTypeData } = {}

  // OVERRIDES Service.ts
  config = {
    id: NameGenerator.getName(),
    port: 3001,
    registry: [] as string[]
  }

  constructor(
    public id: string,
    public name: string,
    public typeKey: string,
    public version: string,
    public hostname: string
  ) {
    super(id, name, typeKey, version, hostname) // Call the base class constructor if needed
  }

  save() {
    const filePath = path.join(this.configDir, this.configName, "runtime.yml")
    try {
      const yamlStr = YAML.stringify(this.config)
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, yamlStr, "utf8")
      console.log("Config saved to", filePath)
    } catch (error) {
      this.error(`Failed to save config: ${error}`)
    }
  }

  apply(config: any) {
    this.config = config
    this.save()
  }

  createMessage(inName: string, inMethod: string, inParams: any[]) {
    // ...inParams: any[]) {
    // TODO: consider a different way to pass inParams for a no arg method.
    // rather than an array with a single null element.
    const id = this.getId()

    // var msg = {
    //   msgId: new Date().getTime(),
    //   name: get().getFullName(inName),
    //   method: inMethod,
    //   sender: "runtime@" + id,
    //   sendingMethod: null
    // }
    let msg = new Message(inName, inMethod, inParams)
    msg.sender = `runtime@${id}`

    // msg.name = get().getFullName(inName)
    // msg.method = inMethod
    // msg.sender = "runtime@" + id

    // if (inParams || (inParams.length === 1 && inParams[0])) {
    //   msg["data"] = inParams
    // }
    return msg
  }

  /**
   * Connects this process to a remote process.
   * With HATEOS, it begins with a http request to get the remote id
   * then a websocket connection is established.
   * Next a series of messages are sent to the remote process for registration of
   * this service, process and host.
   * @param wsUrl
   */
  connect(wsUrl: string) {
    log.info(`=== connect ${wsUrl} ===`)
    log.info("connecting")

    const parsedUrl = new URL(wsUrl)

    // Correctly determine the HTTP protocol to use based on the WebSocket protocol
    const isSecure = parsedUrl.protocol === "wss:"
    const httpProtocol = isSecure ? https : http
    const fetchIdUrl = `${isSecure ? "https" : "http"}://${parsedUrl.hostname}:${parsedUrl.port}/api/v1/services/runtime/getId`
    let remoteId = null
    // Make the HTTP or HTTPS request based on the protocol
    log.info(`http getId to remote: ${fetchIdUrl}`)

    httpProtocol
      .get(fetchIdUrl, (res) => {
        let data = ""

        res.on("data", (chunk) => {
          data += chunk
        })

        res.on("end", () => {
          const remoteId = JSON.parse(data)
          // const remoteId = response.id

          if (remoteId) {
            const ws: WebSocket = new WebSocket(wsUrl)
            const that = this
            // Open connection
            ws.onopen = function open() {
              console.log("Connected to the server")
              // Send a message to the WebSocket server
              // get().subscribeTo("runtime", "getServiceNames")
              var msg = that.createMessage("runtime", "addListener", ["getServiceNames", "runtime@" + that.getId()])
              var json = JSON.stringify(msg)
              console.log("Sending addListener getServiceNames: ", json)
              ws.send(json)

              // register runtime which in a way is equivalent to a registering a process
              msg = that.createMessage("runtime", "register", [that])
              json = JSON.stringify(msg)
              console.log("Sending register: ", json)
              ws.send(json)
              // register the process
              msg = that.createMessage("runtime", "registerProcess", [that.getLocalProcessData()])
              json = JSON.stringify(msg)
              console.log("Sending register: ", json)
              ws.send(json)

              // register the host

              msg = that.createMessage("runtime", "registerHost", [that.getHost()])
              json = JSON.stringify(msg)
              console.log("Sending register: ", json)
              ws.send(json)

              // does url need to be unique ? e.g. connect(ws://localhost:3000/api/messages?id=happy-arduino&session_id=1234)
              Store.getInstance().addClientConnection(remoteId, ws)
              // sendTo("runtime", "register", service)
              that.invoke("broadcastState")
            }

            // Listen for messages from the server
            ws.onmessage = function (event) {
              console.log("Message from server: ", event.data)
            }

            // Handle any errors that occur.
            ws.onerror = function (error) {
              console.error("WebSocket Error: ", error)
            }

            // Handle WebSocket connection closed
            ws.onclose = function (event) {
              console.log("WebSocket connection closed: ", event)
            }
          } else {
            console.error("Failed to fetch remote ID")
          }
        })
      })
      .on("error", (e) => {
        console.error(`Got error: ${e.message}`)
      })
  }

  readConfig(serviceName: string, defaultConfig: any) {
    const filePath = path.join(this.configDir, this.configName, `${serviceName}.yml`)
    try {
      const file = fs.readFileSync(filePath, "utf8")
      const config = YAML.parse(file)
      return config
    } catch (error) {
      this.error(`Failed to load config: ${error}`)
      return defaultConfig
    }
  }

  static createInstance(configName: string): RobotLabXRuntime {
    if (!RobotLabXRuntime.instance) {
      RobotLabXRuntime.instance = new RobotLabXRuntime("TEMP", "runtime", "RobotLabXRuntime", "0.0.1", os.hostname())
      this.instance.configName = configName
    } else {
      log.error("RobotLabXRuntime instance already exists")
    }
    return RobotLabXRuntime.instance
  }

  getClientKeys() {
    return [...Store.getInstance().getClients().keys()]
  }

  static getInstance(): RobotLabXRuntime {
    return RobotLabXRuntime.instance
  }

  getLocalProcessData(): ProcessData {
    let pd: ProcessData = new ProcessData(this.getId(), process.pid, this.getHostname(), "node", process.version)
    return pd
  }

  // maybe purge is a good idea to purge the copy of the repo for an instance ?
  // vs release which only frees the service from memory
  releaseService() {
    super.releaseService()
  }

  startService(): void {
    log.info("starting runtime")

    this.repo.load()

    fs.mkdir(this.dataDir, { recursive: true }, (err) => {
      if (err) {
        log.error(`Error creating data directory: ${err}`)
      }
    })
    fs.mkdir(path.join(this.configDir, this.configName), { recursive: true }, (err) => {
      if (err) {
        log.error(`Error creating data directory: ${err}`)
      }
    })

    this.config = this.readConfig("runtime", this.config)
    log.info(`Runtime config loaded ${JSON.stringify(this.config)}`)
    this.id = this.config.id
    Store.createInstance(RobotLabXRuntime.instance)
    super.startService()
    log.info("starting runtime")
  }

  installInfo(msg: string) {
    log.info(msg)
    this.invoke("publishInstallLog", msg)
  }

  async start(launcher: string) {
    log.info(`Starting launcher: ${launcher}`)

    try {
      log.info(`cwd ${process.cwd()}`)
      // Dynamically import the Default configuration based on the launcher name
      const modulePath = `../../config/${launcher}` // Construct the module path dynamically
      const configModule = await import(modulePath)
      const DefaultConfig = configModule.default

      // Create an instance of the dynamically loaded configuration
      const configInstance = new DefaultConfig()

      // Process the configuration - this example just logs the loaded configuration
      log.info(`Loaded configuration with ${configInstance.getLaunchActions().length} actions.`)

      // You might want to do more here, such as applying the configuration or starting nodes
      configInstance.getLaunchActions().forEach((action: LaunchAction) => {
        log.info(`Starting ${action.package}/${action.executable} named ${action.name}`)
        this.startServiceType(action.name, action.executable)
      })
    } catch (error) {
      if (error instanceof Error) {
        log.error(`Error loading configuration for ${launcher}: ${error.message}`)
      } else {
        log.error(`An unknown error occurred while loading configuration for ${launcher}`)
      }
    }
  }

  // TODO - remove version
  startServiceType(serviceName: string, serviceType: string): Service {
    try {
      const check = this.getService(serviceName)
      if (check != null) {
        log.info(`service ${check.getName()}@${check.getId()} already exists`)
        return check
      }

      log.info(`starting service: ${serviceName}, type: ${serviceType} in ${process.cwd()}`)

      // repo should be immutable - make a copy to service/{name} if one doesn't already exist
      const targetDir = `./express/public/service/${serviceName}`

      this.repo.copyPackage(serviceName, serviceType)
      log.info(`successful ${targetDir}`)

      const pkgYmlFile = `${targetDir}/package.yml`

      // loading type info
      log.info(`loading type data from ${pkgYmlFile}`)
      const file = fs.readFileSync(pkgYmlFile, "utf8")
      const pkg: Package = YAML.parse(file)

      // validating and preprocessing package.yml
      if (pkg.cwd == null) {
        // default targetDir
        pkg.cwd = targetDir
      }

      let version = pkg.version
      log.info(`package.yml ${JSON.stringify(pkg)}`)

      // TODO - if service request to add a service
      // and mrl and process exists - then /runtime/start
      log.info(`package.platform: ${pkg.platform}, type: ${serviceType} in ${process.cwd()}`)

      let dependenciesMet = false

      let platformInfo = null

      // determine necessary platform python, node, docker, java
      // yes | no -> install -> yes | no
      if (pkg.platform === "python") {
        this.installInfo(`python required for ${serviceType}`)
        let installer = new InstallerPython()
        // default install venv and pip
        // check if min python version is correct
        platformInfo = installer.install(pkg)
        dependenciesMet = true
      } else {
        log.info(`platform [${pkg.platform}] not supported`)
      }

      // TODO - way to set cmd line args

      // resolve if package.yml dependencies are met

      // creating instance config from type if it does not exist

      // preparing to start the process

      // const script = "start.py"
      // register

      // TODO - only if you need a new process
      // TODO get package.yml from processModule - check if
      // dependencies are met
      // host check
      // platform check - python version, pip installed, venv etc.
      // pip libraries and versions installed

      log.info(`starting process ${targetDir}/${pkg.cmd} ${pkg.args}`)
      let service: Service = null
      // spawn the process if none node process
      if (pkg.platform === "node") {
        this.installInfo(`node process ${serviceName} ${serviceType} ${pkg.platform} ${pkg.platformVersion}`)
        service = this.repo.getService(this.getId(), serviceName, serviceType, version, this.getHostname())
        log.info(`service ${JSON.stringify(service)}`)
        this.installInfo(`platform is ok`)
        this.register(service)
        this.installInfo(`registered service ${serviceName}`)
      } else if (dependenciesMet) {
        log.info(`dependencies met for ${serviceName} ${serviceType} ${pkg.platform} ${pkg.platformVersion}`)
        // spawn the process
        log.info(`spawning process ${pkg.cmd} ${pkg.args} in ${targetDir}`)
        const childProcess = spawn(pkg.cmd, pkg.args, { cwd: targetDir, shell: true })

        childProcess.on("error", (err) => {
          log.error(`failed to start subprocess. ${err}`)
          // send message with error to UI
          return
        })

        if (childProcess.pid) {
          // register the service
          service = new Service(childProcess.pid.toString(), serviceName, serviceType, version, this.getHostname())
        } else {
          log.error("Process PID is undefined, indicating an issue with spawning the process.")
          return
        }

        // Stream stdout and stderr
        childProcess.stdout.on("data", (data) => {
          log.info(`STDOUT: ${data}`)
          // TODO more structured publishStdOutRecord
          // where record.level record.ts record.msg
          service.invoke("publishStdOut", data.toString())
        })

        childProcess.stderr.on("data", (data) => {
          log.error(`STDERR: ${data}`)
          service.invoke("publishStdOut", data.toString())
        })

        // Handle process exit
        childProcess.on("close", (code) => {
          log.info(`Subprocess exited with code ${code}`)
          // Optionally handle process cleanup or restart
        })

        // register the process
        let platformVersion = platformInfo?.platformVersion
        const pd: ProcessData = new ProcessData(
          serviceName,
          childProcess.pid.toString(),
          this.getHostname(),
          pkg.platform,
          platformVersion ? platformVersion : pkg.platformVersion // actual vs requested version
        )
        this.registerProcess(pd)

        // service = new Service(childProcess.pid.toString(), serviceName, serviceType, version, this.getHostname())
        // for unaliased ids for services - single process services will be serviceName@serviceName
        // FIXME MAKE A PROXY TYPE !!!
        service = new Service(this.getId(), serviceName, serviceType, version, this.getHostname())

        log.info(`process ${JSON.stringify(childProcess)}`)
      } else {
        log.error(`dependencies not met for ${serviceName} ${serviceType} ${pkg.platform} ${pkg.platformVersion}`)
        return null
      }

      // register and start the service
      this.register(service)
      return service
    } catch (e: unknown) {
      const error = e as Error

      // // Get the file and line number where the error occurred
      // const file = e.stack.split("\n")[1].match(/\((?<file>.+):\d+\)/)?.groups?.file
      // const lineNumber = e.stack.split("\n")[1].match(/\((?<file>.+):(?<lineNumber>\d+)\)/)?.groups?.lineNumber
      let errStr = `error: ${error} ${error.stack}`
      log.error(errStr)
      this.invoke("publishInstallLog", errStr)
    }
  }

  release(name: string): void {
    log.info(`Released service: ${name}`)
  }

  getUptime(): string {
    let uptime: string = super.getUptime()
    log.info(`Uptime: ${uptime}`)
    return uptime
  }

  getService(name: string): Service | null {
    const fullName = CodecUtil.getFullName(name)
    return Store.getInstance().getService(fullName)
  }

  registerConnection(connection: any) {
    log.info(`register connection: ${JSON.stringify(connection)}`)
    this.connections[`${connection.clientId}`] = connection
  }

  registerHost(host: HostData) {
    this.hosts[`${host.hostname}`] = host
  }

  registerProcess(process: ProcessData) {
    this.processes[`${process.id}@${process.hostname}`] = process
  }

  registerType(type: ServiceTypeData) {
    this.types[`${type.typeKey}@${type.version}`] = type
  }

  /**
   * Registering a service.  If its local to this process, most likely
   * it will be a service derived from Service.ts.  If its a remote service
   * it will be a proxy.  Which is defined by Service.ts
   *
   * All external processes must register. The "runtime" is equivalent to a
   * process.  If an external process does not register, a generated "runtime"/process
   * description will be created
   *
   * @param service
   * @returns
   */
  register(service: Service) {
    // log.info(`registering service: ${service.name} ${service.constructor.name}`)
    // log.error(`registering service: ${JSON.stringify(service)}`)
    log.error(`registering service: ${service.name}@${service.id}`)

    // if its a local service - then we understand the type and
    // it can be directly registered
    // if its a remote service - we need to get the type from the remote
    // and construct a proxy

    if (service.id != this.getId()) {
      // PROXY !!!
      log.info("service id is remote - create a proxy service")
      log.info(`${service}`)
      service = new Service(service.id, service.name, service.typeKey, service.version, service.hostname)
    }

    Store.getInstance().register(`${service.name}@${service.id}`, service)
    this.invoke("registered", service)

    return service
  }

  registered(service: Service): Service {
    return service
  }

  getRepo() {
    // const repoBasePath = path.join(__dirname, "../public/repo")
    // log.info(`getting repo with base path: ${repoBasePath}`)
    // const repoMap = this.repo.processRepoDirectory(repoBasePath)
    // // convert the Map to an Object to send as JSON
    // const repoObject = Object.fromEntries(repoMap)
    return this.repo.getRepo()
  }

  getHosts() {
    return this.hosts
  }

  getHost() {
    if (this.hostname == null) {
      return null
    }
    return this.hosts[this.hostname]
  }

  getProcesses() {
    return this.processes
  }

  // FIXME implement
  getConnections() {
    return this.connections
  }

  getRegistry(): Object {
    return Store.getInstance().getRegistry()
  }

  /**
   * Returns full name of all services
   * @returns Array of all registry service names
   */
  getServiceNames(): string[] {
    const localId = RobotLabXRuntime.instance.getId() // Assuming CodecUtil.getId() returns the local ID string
    const registry = Store.getInstance().getRegistry() // Assuming this returns a dictionary
    return Object.keys(registry)
  }

  /**
   * Returns only local services and short names
   * @returns Array of short names of local services
   */
  getLocalServiceNames(): string[] {
    const localId = RobotLabXRuntime.instance.getId() // Assuming CodecUtil.getId() returns the local ID string
    const registry = Store.getInstance().getRegistry() // Assuming this returns a dictionary

    return Object.keys(registry)
      .filter((key) => key.endsWith(`@${localId}`)) // Filter keys that end with the local ID
      .map((key) => key.split("@")[0]) // Extract the name part from each key
  }

  publishInstallLog(msg: string): string {
    log.info(`publishInstallLog: ${msg}`)
    return msg
  }
}
