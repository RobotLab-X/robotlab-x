// import Service from "express/framework/Service"
// FIXME - aliases don't appear to be work, neither does root reference path
import { spawn } from "child_process"
import { LaunchAction } from "express/framework/LaunchDescription"
import fs from "fs"
import http from "http"
import https from "https"
import os from "os"
import path from "path"
import { v4 as uuidv4 } from "uuid"
import { WebSocket } from "ws"
import YAML from "yaml"
import Main from "../../electron/ElectronStarter"
import Store from "../../express/Store"
import { CodecUtil } from "../framework/CodecUtil"
import { getLogger } from "../framework/Log"
import NameGenerator from "../framework/NameGenerator"
import { Repo } from "../framework/Repo"
import Service from "../framework/Service"
import { HostData } from "../models/HostData"
import Message from "../models/Message"
import Package from "../models/Package"
import { ProcessData } from "../models/ProcessData"
import RouteEntry from "../models/RouteEntry"
import { ServiceTypeData } from "../models/ServiceTypeData"
// import LaunchDescription from "express/framework/LaunchDescription"
// const LaunchDescription = require("express/framework/LaunchDescription").default

const log = getLogger("RobotLabXRuntime")

interface Registry {
  [key: string]: Service
}

interface Error {
  stack?: string | undefined
}
// import Service from "@framework/Service"
export default class RobotLabXRuntime extends Service {
  private static instance: RobotLabXRuntime

  // NON SERIALIZABLE MAP OF CONNECTIONS
  private connectionImpl: Map<string, WebSocket> = new Map()

  protected dataDir = "./data"
  protected configDir = "./config"
  protected configName: string
  protected repo = new Repo()

  protected debug = true

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

  /**
   * routeTable - a map of process ids to their immediate connections
   * id's to connection clientIds (should be array of uuids ?)
   *
   *
   * currently:
   *
   * destination id -> gateway id (client id)
   *
   * Can find a connection to a connected process by looking up the distantly remote process id
   *
   */
  protected routeTable: { [id: string]: RouteEntry } = {}

  // OVERRIDES Service.ts
  config = {
    id: NameGenerator.getName(),
    logLevel: "info",
    port: 3001,
    registry: [] as string[],
    // list of processes to connect to
    connect: [] as string[]
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
      log.info("Config saved to", filePath)
    } catch (error) {
      this.error(`Failed to save config: ${error}`)
    }
  }

  // FIXME - define route
  addRoute(remoteId: string, gatewayId: string, gateway: string) {
    // if (remoteId === "rlx1") {
    //   log.error(`WRONG ROUTE !!!!!! ============================================  ${remoteId} ${gatewayId} ${gateway}`)
    // }
    log.error(`addRoute remoteId:${remoteId} gatewayId:${gatewayId} gateway:${gateway}`)
    if (!remoteId || !gatewayId || !gateway) {
      log.error(`addRoute failed - missing parameter remoteId: ${remoteId} gatewayId: ${gatewayId} gateway: ${gateway}`)
      return
    }
    this.routeTable[remoteId] = new RouteEntry(remoteId, gatewayId, gateway)
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
    // RELATED TO HATEOS - VERY TOP OF THE QUERY SYSTEM IS ASK FOR REMOTE PROCESS ID
    const fetchIdUrl = `${isSecure ? "https" : "http"}://${parsedUrl.hostname}:${parsedUrl.port}/api/v1/services/runtime/getId`
    // Make the HTTP or HTTPS request based on the protocol
    log.info(`http getId to remote: ${fetchIdUrl}`)
    const that = this

    // synchronous http call to get the remote process's "id"
    // beginning of the HATEOS chain
    // critical for msg routing
    httpProtocol
      .get(fetchIdUrl, (res) => {
        let data = ""

        res.on("data", (chunk) => {
          data += chunk
        })

        res.on("end", () => {
          const connectedId = JSON.parse(data)
          log.info(`remoteId: ${connectedId}`)

          if (connectedId) {
            const ws: WebSocket = new WebSocket(wsUrl)

            // Open connection
            ws.onopen = function open() {
              log.info("Connected to the server")

              // does url need to be unique ? e.g. connect(ws://localhost:3000/api/messages?id=happy-arduino&session_id=1234)
              that.registerConnection(that.fullname, connectedId, wsUrl, "outbound", ws)

              const remoteRuntime = `runtime@${connectedId}`

              // TODO - use "synchronous service call"
              var msg = that.createMessage(remoteRuntime, "addListener", ["getRegistry", "runtime@" + that.getId()])
              var json = JSON.stringify(msg)
              log.info("Sending addListener getRegistry: ", json)
              ws.send(json)

              var msg = that.createMessage(remoteRuntime, "getRegistry", [])
              var json = JSON.stringify(msg)
              log.info("Sending getRegistry: ", json)
              ws.send(json)

              // register the process - this one is critical ! doesn't matter if a service is registered, but a process is needed
              // to provide routing information
              msg = that.createMessage(remoteRuntime, "registerProcess", [that.getLocalProcessData()])
              json = JSON.stringify(msg)
              log.info("Sending registerProcess: ", json)
              ws.send(json)

              // Registering self to remote begin ====================================
              const registry = that.getRegistry()
              Object.entries(registry).forEach(([key, service]) => {
                // TODO - filter based on requirements
                // maybe only runtime, maybe only local services, maybe only services with a specific type
                msg = that.createMessage(remoteRuntime, "register", [service])
                json = JSON.stringify(msg)
                log.info("Sending register: ", json)
                ws.send(json)
              })

              // register the host
              msg = that.createMessage(remoteRuntime, "registerHost", [that.getHost()])
              json = JSON.stringify(msg)
              log.info("Sending registerHost: ", json)
              ws.send(json)
              // Registering self to remote end ====================================

              // that.addClientConnection(remoteId, wsUrl, ws)
              that.invoke("broadcastState")
            }

            // Listen for messages from the server
            // onmessage - client
            ws.onmessage = function (event) {
              log.info("Message from server: ", event.data)
              try {
                let json: string = event.data.toString()
                const msg: Message = JSON.parse(json)
                // THIS IS A PROCESS BOUNDARY
                // required to put in the boundary connection details
                // FIXME - addRoute should probably be here .. its currently in invokeMsg
                // DYNAMIC ROUTING - if a "sender" is found in the message
                // add it to the routeTable with this connection
                msg.gatewayId = connectedId
                msg.gateway = that.fullname

                // if msg.sender is remote but not from this connection
                // need to add a new route entry
                log.error(
                  `client dynamic add route: ${msg.sender} sender id: ${CodecUtil.getId(msg.sender)} remoteId: ${connectedId} that.fullname: ${that.fullname}`
                )
                if (msg.sender && CodecUtil.getId(msg.sender) !== connectedId) {
                  log.error(`NEW ROUTE !!!!!!  ${msg.sender} ${connectedId} ${that.fullname}`)
                  that.addRoute(CodecUtil.getId(msg.sender), connectedId, that.fullname)
                }

                let ret: any = Store.getInstance().handleMessage(msg)
              } catch (e) {
                // ui error - user should be informed
                console.error("parsing message error")
                console.error(e)
              }
            }

            // Handle any errors that occur.
            ws.onerror = function (error) {
              console.error("WebSocket Error: ", error)
            }

            // Handle WebSocket connection closed
            ws.onclose = function (event) {
              log.info("WebSocket connection closed: ", event)
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

  saveServiceConfig(serviceName: string, config: any) {
    const filePath = path.join(this.configDir, this.configName, `${serviceName}.yml`)
    try {
      const yamlStr = YAML.stringify(config)
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, yamlStr, "utf8")
      log.info("Config saved to", filePath)
    } catch (error) {
      this.error(`Failed to save config: ${error}`)
    }
  }

  static createInstance(configDir: string, configName: string): RobotLabXRuntime {
    // chicken and egg problem - can't use readConfig before an instance is created
    // but need config to construct instance

    let config = {
      id: NameGenerator.getName(),
      logLevel: "info",
      port: 3001,
      registry: [] as string[],
      // list of processes to connect to
      connect: [] as string[]
    }

    const filePath = path.join(configDir, configName, `runtime.yml`)
    try {
      const file = fs.readFileSync(filePath, "utf8")
      config = YAML.parse(file)
    } catch (error) {
      log.info(`Failed to load runtime.yml config using default: ${config}`)
    }

    if (!RobotLabXRuntime.instance) {
      RobotLabXRuntime.instance = new RobotLabXRuntime(config.id, "runtime", "RobotLabXRuntime", "0.0.1", os.hostname())
      this.instance.configName = configName
    } else {
      log.error("RobotLabXRuntime instance already exists")
    }
    return RobotLabXRuntime.instance
  }

  getClientKeys() {
    return [...this.getClients().keys()]
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

      let dependenciesMet = true

      let platformInfo = null

      log.info(`starting process ${targetDir}/${pkg.cmd} ${pkg.args}`)
      let service: Service = null
      // FIXME "all" types of platform have a corresponding node service ..
      // the service may be used as an install wizard, connecting service, or some other wizard
      // spawn the process if none node process .. this should be fixed ASAP
      if (pkg.platform === "node" || pkg.platform === "myrobotlab") {
        this.installInfo(`node process ${serviceName} ${serviceType} ${pkg.platform} ${pkg.platformVersion}`)
        service = this.repo.getService(this.getId(), serviceName, serviceType, version, this.getHostname())
        log.info(`service ${JSON.stringify(service)}`)
        this.installInfo(`platform is ok`)
        this.register(service)
        this.installInfo(`registered service ${serviceName}`)
      } else if (dependenciesMet) {
        // FIXME - REMOVE ALL BELOW - because starting a new process should ALWAYS
        // be in the context of the node service ..
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
        let platformVersion = "0.0.0" // platformInfo?.platformVersion
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
   * Initial callback for a new process to register itself
   * after an addListener message is sent to the remote process
   * then a getRegistry message is sent to the remote process
   * @param data
   */
  onRegistry(registry: Registry) {
    log.error(`=============onRegistry: ${JSON.stringify(registry)}`)

    for (const [key, service] of Object.entries(registry)) {
      this.register(service)
    }
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
    const key = `${service.name}@${service.id}`
    if (Store.getInstance().getService(key) != null && this.id === service.id) {
      // if another services registers "us" - it will destroy our service
      // with a unecessary proxy - otherwise a new register or an updated proxy is fine
      log.info(`service ${service.name}@${service.id} already exists`)
      return service
    }

    Store.getInstance().register(`${service.name}@${service.id}`, service)
    this.invoke("registered", service)

    // FIXME you got things registering to getRegistry
    // but they should be registering to registered
    this.invoke("getRegistry")

    return service
  }

  registered(service: Service): Service {
    return service
  }

  setConfigName(configName: string) {
    this.configName = configName
  }

  getRepo() {
    // const repoBasePath = path.join(__dirname, "../public/repo")
    // log.info(`getting repo with base path: ${repoBasePath}`)
    // const repoMap = this.repo.processRepoDirectory(repoBasePath)
    // // convert the Map to an Object to send as JSON
    // const repoObject = Object.fromEntries(repoMap)
    return this.repo.getRepo()
  }

  getConfigList() {
    return ["default", "worky1", "worky2", "worky3", "worky4"]
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

  /**
   * Get the immediate connection that the
   * destination id can be routed to
   *
   * @param id - destination id
   * @returns viable connection to destination process
   */
  getRouteClient(id: string) {
    // TODO "default" route
    // const gatewayId = routeTable[id]?.gatewayId ?? "defaultClientId";
    if (!(id in this.routeTable)) {
      log.error(`no route to ${id} in keyset ${Object.keys(this.routeTable)}`)
      return null
    }
    // FIXME make class schema for RouteEntry
    const routeEntry: any = this.routeTable[id]
    let conn: any = this.getGatewayConnection(routeEntry.gatewayId)
    return conn
  }

  setDebug(debug: boolean) {
    log.info(`setting debug: ${debug}`)
    this.debug = debug
    // TODO change winston's log level
    /// log.setLevel(debug ? "debug" : "info")

    if (debug) {
      Main.mainWindow.webContents.openDevTools()
    } else {
      Main.mainWindow.webContents.closeDevTools()
    }
  }

  /**
   * For outbound client connections
   * <--- I am connecting to someone (outbound connection)
   * @param gatewayId
   * @param ws
   * FIXME - gatewayFullname: String,
   */
  registerConnection(gateway: string, gatewayId: string, url: string, inboundOutbound: string, ws: WebSocket) {
    log.error(`registering connection gatewayId:${gatewayId} url:${url} i/o:${inboundOutbound}`)
    // new connection, new route
    this.addRoute(gatewayId, gatewayId, gateway)

    this.connectionImpl.set(gatewayId, ws)
    // ws.getRemoteAddress() etc.
    // Note - ws is not added here because its not serializable
    const connection = {
      gatewayId: gatewayId,
      ts: new Date().getTime(),
      uuid: uuidv4(),
      url: url,
      type: "websocket",
      encoding: "json",
      gateway: gateway,
      direction: inboundOutbound
    }
    this.connections[`${gatewayId}`] = connection
  }

  removeConnection(gatewayId: string) {
    log.error(`removing connection ${gatewayId}`)
    // TODO - lots of possiblities with this
    // "disabling" remote services and wait for reconnection
    // removing services, etc.
    if (!this.connectionImpl.has(gatewayId)) {
      log.error(`client ${gatewayId} not found`)
      return
    }

    this.connectionImpl.delete(gatewayId)
    delete this.connections[`${gatewayId}`]
  }

  public getGatewayConnection(gatewayId: string): WebSocket | undefined {
    return this.connectionImpl.get(gatewayId)
  }

  public getClients(): Map<string, WebSocket> {
    return this.connectionImpl
  }

  // FIXME - there is probably no Use Case for this - remove
  // Deprecated if not used
  public broadcastJsonMessage(message: string): void {
    // Iterate over the set of clients and send the message to each
    this.connectionImpl.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message)
      }
    })
  }

  // Deprecated if not used
  public broadcast(message: Message): void {
    let json = JSON.stringify(message)
    this.broadcastJsonMessage(json)
  }

  public getGateway(remoteId: string): Service {
    // log.error(`getGateway remoteId:${remoteId}`)
    let entry: RouteEntry = this.routeTable[remoteId]
    // if (!entry) {
    //   // spin through
    //   log.error(`no route to ${remoteId}`)
    //   return null
    // }

    // TODO - manage a "default" route

    return this.getService(entry.gateway)
  }

  public getRouteId(remoteId: string): string {
    // this is a local gateway id
    // this is the id of the gateway that will route to the remoteId
    return this.routeTable[remoteId].gatewayId
  }

  /**
   * Requesting to send a message to a remote process
   * @param msg
   */
  public sendRemote(gatewayRouteId: string, msg: Message): void {
    // We should be the correct gateway to route this incoming message
    // it "may" be the process (gatewayRouteId) were are connected directly to
    // or it gatewayRouteId may be a gateway to msg.id remote process
    let ws: any = this.connectionImpl.get(gatewayRouteId)
    // we'll do the appropriate encoding based on the connection
    let json = JSON.stringify(msg)
    // and send it to the locally connected process for it to route
    ws.send(json)
  }
}
