import InstallStatus from "express/models/InstallStatus"
import Package from "express/models/Package"
import fs from "fs"
import YAML from "yaml"
import Gateway from "../interfaces/Gateway"
import InstallLog from "../models/InstallLog"
import Message from "../models/Message"
import Status from "../models/Status"
import { SubscriptionListener } from "../models/SubscriptionListener"
import RobotLabXRuntime from "../service/RobotLabXRuntime"
import { CodecUtil } from "./CodecUtil"
import { getLogger } from "./Log"

const log = getLogger("Service")

export default class Service implements Gateway {
  protected startTime: number | null = null

  id: string | null = null
  name: string | null = null
  typeKey: string | null = null
  version: string | null = null
  hostname: string | null = null
  fullname: string | null = null

  // notifyList = new Map<string, SubscriptionListener[]>()
  notifyList = {} as any

  pkg: Package | null = null

  config: any = {}

  constructor(id: string, name: string, typeKey: string, version: string, hostname: string | null = null) {
    this.id = id
    this.name = name
    this.typeKey = typeKey
    this.version = version
    this.hostname = hostname
    this.fullname = `${this.name}@${this.id}`
  }

  addListener(method: string, remoteName: string, remoteMethod: string) {
    if (remoteMethod === null || remoteMethod === "" || remoteMethod === undefined) {
      remoteMethod = CodecUtil.getCallbackTopicName(method)
    }

    // log.info(`== addListener ${this.name}.${method} --> ${remoteName}.${remoteMethod}`)

    if (!(method in this.notifyList)) {
      this.notifyList[method] = []
    }
    const listeners = this.notifyList[method] || []
    for (const listener of listeners) {
      if (listener.callbackName === remoteName && listener.callbackMethod === remoteMethod) {
        log.info(`listener on ${method} for -> ${remoteName}.${remoteMethod} already exists`)
        return listener
      }
    }
    // this.notifyList.get(method).push(new SubscriptionListener(method, remoteName, remoteMethod))
    const listener = new SubscriptionListener(method, remoteName, remoteMethod)
    this.notifyList[method].push(listener)
    return listener
  }

  getPackage() {
    try {
      log.info(`${this.name} getting package`)
      const targetDir = `./express/public/service/${this.name}`

      // RobotLabXRuntime.getInstance().getRepo().copyPackage(serviceName, serviceType)
      // this.repo.copyPackage(serviceName, serviceType)
      log.info(`successful ${targetDir}`)

      const pkgYmlFile = `${targetDir}/package.yml`

      // loading type info
      log.info(`loading type data from ${pkgYmlFile}`)

      const file = fs.readFileSync(pkgYmlFile, "utf8")
      this.pkg = YAML.parse(file)
    } catch (e) {
      log.error(`failed to load package ${e}`)
    }
  }

  /**
   * Broadcasts the current state of the service
   * @returns returns self
   */
  broadcastState() {
    return this
  }

  getConfig() {
    return this.config
  }

  applyConfig(config: any) {
    this.config = config
  }

  saveConfig() {
    RobotLabXRuntime.getInstance().saveServiceConfig(this.name, this.config)
  }

  getNotifyList() {
    return this.notifyList
  }

  getHostname(): string | null {
    return this.hostname
  }

  getId() {
    return this.id
  }

  getName() {
    return this.name
  }

  // Example of calculating uptime
  getUptime(): string {
    if (!this.startTime) {
      return "service not started"
    }
    const now = new Date()
    const uptime = now.getTime() - this.startTime
    return `uptime: ${uptime / 1000} seconds`
  }

  getFullName(): string {
    return CodecUtil.getFullName(this.name)
  }

  invoke(methodName: string, ...args: any[]): any {
    let msg = new Message(this.name, methodName, args)
    return this.invokeMsg(msg)
  }

  invokeMsg(msg: Message): any {
    const fullName = this.getFullName()
    const msgFullName = CodecUtil.getFullName(msg.name)
    const msgId = CodecUtil.getId(msgFullName)
    const senderId = CodecUtil.getId(msg.sender)
    const runtime = RobotLabXRuntime.getInstance()
    // this process's id
    const id = runtime.getId()
    let ret: any = null

    // FIXME - building dynamic routes based on "registration"
    // however this filter could be opened up to any id from sender that is not the same as the current id
    // It should be done this way, and all external service connections should be registered with
    // generated uuids, for sender process remoteIds

    // TODO add if method === "register" regardless of sender
    // adding routes must be done at the gateway it came in on
    if (msg.gateway) {
      // if (msg.method === "register") {
      // log.info(`registering ===> ${msg.data[0].id} ${msg.gatewayId} =======================`)
      runtime.addRoute(msgId, msg.gatewayId, msg.gateway)
    }

    // log.error(`invokeMsg msgId ${msgId} id ${id} msgFullName ${msgFullName} fullName ${fullName}`)
    // ==== REMOTE ====
    // FIXME - check if blocking or non-blocking
    // use gateway to send message to remote service
    if (msgId !== id) {
      // send message to remote service
      // log.info(`sending message to ${msgFullName}.${msg.method}`)
      // this.gateway.send(msg)
      const json = JSON.stringify(msg)
      log.info(`<-- ${msgFullName}.${msg.method} <-- ${msg.sender}.${msg.method} ${JSON.stringify(msg.data)}`)
      // FIXME bork'd - need state information regarding connectivity of process/service, and its an "array" of connections
      log.info(`connectionImpl / connections ${[...runtime.getClients().keys()]} `)

      // fine the gateway for the message's remoteId
      let gateway: Gateway = runtime.getGateway(msgId)
      if (!gateway) {
        log.error(`NO GATEWAY for remoteId ${msgId}`)
        return null
      }

      // find the local process id for the message to be routed through
      const gatewayRouteId = runtime.getRouteId(msgId)

      // TODO - implement synchronous blocking
      let blockingObject = gateway.sendRemote(gatewayRouteId, msg)

      // TODO - implement synchronous blocking
      return blockingObject
    }

    // ==== LOCAL PROCESS DIFFERENT SERVICE ====
    // get the service - asynchronous buffered or synchronous non-buffered
    // default synchronous non-buffered
    if (msgFullName !== fullName) {
      let service = runtime.getService(msgFullName)
      if (service === null) {
        log.error(`service ${msgFullName} not found`)
        return null
      } else {
        // relay to correct service
        // service.send(msg)
        return service.invokeMsg(msg)
      }
    }

    // ==== LOCAL ====
    // FIXME - check if blocking or non-blocking
    // is this the service to invoke the method on ?
    if (fullName === msgFullName) {
      let obj: any = this // cast away typescript

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

      // TODO - process subscription
      if (this.notifyList[msg.method]) {
        this.notifyList[msg.method].forEach((listener: any) => {
          let subMsg = new Message(listener.callbackName, listener.callbackMethod, [ret])
          subMsg.sender = this.getFullName()
          // log.info(`<- notify ${listener.callbackName}.${listener.callbackMethod}`)
          this.invokeMsg(subMsg)
        })
      }
      return ret
    }
  }

  isReady(): boolean {
    return this.startTime !== null
  }

  publishStdOut(msg: string): string {
    log.info(`stdout: ${msg}`)
    return msg
  }

  // maybe purge is a good idea to purge the copy of the repo for an instance ?
  // vs release which only frees the service from memory
  releaseService() {
    log.info(`========= released service ${this.getName()} ===========`)
  }

  removeListener(method: string, remoteName: string, remoteMethod: string) {
    // log.warn(`removeListener ${method} ${remoteName} ${remoteMethod}`)

    if (remoteMethod === null || remoteMethod === undefined) {
      // log.info(`remoteMethod is null, setting to ${CodecUtil.getCallbackTopicName(method)}`)
      remoteMethod = CodecUtil.getCallbackTopicName(method)
    }

    // log.info(`== removeListener ${this.name}.${method} --> ${remoteName}.${remoteMethod}`)

    if (!this.notifyList || !this.notifyList.hasOwnProperty(method)) {
      // log.error("no listeners for method " + method)
      return
    }

    this.notifyList[method].forEach((listener: any, index: any) => {
      // log.info(
      //   `checking listener ${listener.callbackName}.${listener.callbackMethod} for ${remoteName}.${remoteMethod}`
      // )
      if (listener.callbackName === remoteName && listener.callbackMethod === remoteMethod) {
        this.notifyList[method].splice(index, 1)
        //        log.info(`removed listener on ${method} for -> ${remoteName}.${remoteMethod}`)
        return
      }
    })

    //log.error("no listeners for method " + method)
  }

  publishStatus(status: Status) {
    return status
  }

  installError(msg: string) {
    log.error(msg)
    const err = new InstallLog("error", msg)
    this.invoke("publishInstallLog", err)
  }

  installInfo(msg: string) {
    log.info(msg)
    const il = new InstallLog("info", msg)
    this.invoke("publishInstallLog", il)
  }

  /**
   * A generalized install log entry for installing components or images.
   * Comes with a timestamp, a level (info, warn, error), and a message.
   * @param installLog
   * @returns
   */
  publishInstallLog(installLog: InstallLog) {
    return installLog
  }

  /**
   * A generalized install status to determine if dependencies have
   * successfully been installed, and details of problems.
   *
   * @param status
   * @returns
   */
  publishInstallStatus(status: InstallStatus) {
    return status
  }

  // Example of a shared method
  startService() {
    this.startTime = new Date().getTime()
    log.info(`========= started service ${this.name} ===========`)
    this.getPackage()
  }

  stopService() {
    this.startTime = null
    log.info(`========= stopped service ${this.name} ===========`)
  }

  info(msg: string | null) {
    this.invoke("publishStatus", new Status("info", msg, this.name))
  }

  warn(msg: string | null) {
    this.invoke("publishStatus", new Status("warn", msg, this.name))
  }

  error(msg: string | null) {
    this.invoke("publishStatus", new Status("error", msg, this.name))
  }

  /**
   * Requesting to send a message to a remote process
   * @param msg
   */
  public sendRemote(gatewayRouteId: string, msg: Message): void {
    // default is runtime's sendRemote
    RobotLabXRuntime.getInstance().sendRemote(gatewayRouteId, msg)
  }
}
