import path from "path"
// import { send } from "process"
import Main from "../../electron/Main"
import Gateway from "../interfaces/Gateway"
import InstallStatus from "../models/InstallStatus"
import Message from "../models/Message"
import Package from "../models/Package"
import Status from "../models/Status"
import { SubscriptionListener } from "../models/SubscriptionListener"
import RobotLabXRuntime from "../service/RobotLabXRuntime"
import { CodecUtil } from "./CodecUtil"
import { getLogger } from "./LocalLog"

const log = getLogger("Service")

interface NotifyList {
  [key: string]: SubscriptionListener[]
}

export default class Service implements Gateway {
  protected startTime: number | null = null

  id: string | null = null
  name: string | null = null
  typeKey: string | null = null
  version: string | null = null
  hostname: string | null = null
  fullname: string | null = null

  // User "owned" data path for resources for the service
  dataPath: string | null = null

  notifyList: NotifyList = {}

  pkg: Package | null = null

  ready: boolean = false

  installed: boolean = false

  config: any = {}

  constructor(id: string, name: string, typeKey: string, version: string, hostname: string | null = null) {
    this.id = id
    this.name = name
    this.typeKey = typeKey
    this.version = version
    this.hostname = hostname
    this.fullname = `${this.name}@${this.id}`
    // FIXME should be publicRoot/data
    const main = Main.getInstance()
    this.dataPath = path.join(main.publicRoot, `service/${this.name}`)
  }

  getSubscribersForMethod(method: string): SubscriptionListener[] {
    let ret: string[] = []
    const listeners: SubscriptionListener[] = this.notifyList[method]
    if (listeners) {
      listeners.forEach((listener: SubscriptionListener) => {
        ret.push(listener.callbackName)
      })
    }
    log.error(`getSubscribersForMethod ${method} ${ret}`)
    return []
  }

  sendTo(name: string, method: string, data: any[]) {
    log.info(`sendTo ${name} ${method} ${data}`)
    let msg = new Message(name, method, data)
    msg.sender = this.fullname
    this.invokeMsg(msg)
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

  subscribeTo(name: string, method: string) {
    log.info(`subscribeTo ${name} ${method}`)
    // ensure remoteName is a fullname
    if (!name.includes("@")) {
      name = CodecUtil.getFullName(name)
    }

    // FIXME- merge more args
    var args = Array.prototype.slice.call(arguments, 1)
    const msg = this.createMessage(name, "addListener", [method, name])
    this.invokeMsg(msg)
    // this.sendRemote(msg)
    // send(msg)
  }

  addListener(method: string, remoteName: string, remoteMethod: string) {
    // ensure remoteName is a fullname
    if (!remoteName.includes("@")) {
      remoteName = CodecUtil.getFullName(remoteName)
    }

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
        // log.info(`listener on ${method} for -> ${remoteName}.${remoteMethod} already exists`)
        return listener
      }
    }

    const listener = new SubscriptionListener(method, remoteName, remoteMethod)
    this.notifyList[method].push(listener)
    return listener
  }

  /**
   * Broadcasts the current state of the service
   * @returns returns self
   */
  broadcastState() {
    return this
  }

  getConfig(): any {
    return this.config
  }

  applyConfig(config: any) {
    log.info(`applyConfig ${this.name} ${JSON.stringify(config)}`)
    this.config = config
  }

  applyConfigValue(key: string, value: any) {
    this.config[key] = value
    this.invoke("broadcastState")
  }

  // TODO - handle ad hoc config file
  applyFileConfig(filename: string = null) {
    RobotLabXRuntime.getInstance().applyServiceFileConfig(this.name)
    this.invoke("broadcastState")
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

  /**
   * Reflectively returns the names of methods in the class.
   * @param filters Optional array of filter criteria to return methods that start with any of the filters. If null or empty, returns all methods.
   * @returns Array of method names.
   */
  public getMethods(filters: string[] | null = null): string[] {
    const prototype = Object.getPrototypeOf(this)
    const methodNames = Object.getOwnPropertyNames(prototype)
      .filter((name) => typeof (this as any)[name] === "function" && name !== "constructor")
      .filter((name) => {
        if (!filters || filters.length === 0) {
          return true
        }
        return filters.some((filter) => name.startsWith(filter))
      })
      .sort()
    return methodNames
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

  invoke(methodName: string, ...args: any[]): any {
    let msg = new Message(this.name, methodName, args)
    msg.sender = this.fullname
    return this.invokeMsg(msg)
  }

  invokeMsg(msg: Message): any {
    try {
      const fullName = this.fullname //this.getFullName()
      const msgFullName = CodecUtil.getFullName(msg.name)
      const msgId = CodecUtil.getId(msgFullName)
      const senderId = CodecUtil.getId(msg.sender)
      const runtime = RobotLabXRuntime.getInstance()
      // this process's id
      const id = runtime.getId()
      let ret: any = null

      if (msg.method !== "publishLogs" && msg.method !== "onLogs") {
        if (msg.data && msg.data.length > 0) {
          // log.info(`--> ${msg.sender} --> ${msg.name}.${msg.method}(${JSON.stringify(msg.data)})`)
          if (msg.method === "addListener" || msg.method === "removeListener") {
            log.info(`--> ${msg.sender} --> ${msg.name}.${msg.method}(${JSON.stringify(msg.data)})`)
          } else {
            log.info(`--> ${msg.sender} --> ${msg.name}.${msg.method}(...)`)
          }
        } else {
          log.info(`--> ${msg.sender} --> ${msg.name}.${msg.method}()`)
        }
      }

      // FIXME - building dynamic routes based on "registration"
      // however this filter could be opened up to any id from sender that is not the same as the current id
      // It should be done this way, and all external service connections should be registered with
      // generated uuids, for sender process remoteIds

      // log.error(`invokeMsg msgId ${msgId} id ${id} msgFullName ${msgFullName} fullName ${fullName}`)
      // ==== REMOTE ====
      // FIXME - check if blocking or non-blocking
      // use gateway to send message to remote service
      if (msgId !== id) {
        // log.info(`remote message ${msgFullName}.${msg.method} from ${msg.sender}.${msg.method}`)
        // dynamically add route to gateway
        if (msg.gateway) {
          runtime.addRoute(msgId, msg.gatewayId, msg.gateway)
        }

        // send message to remote service
        // log.info(`sending message to ${msgFullName}.${msg.method}`)
        // this.gateway.send(msg)
        // const json = JSON.stringify(msg)
        if (msg.method !== "publishLogs" && msg.method !== "onLogs") {
          log.info(`<-- ${msgFullName}.${msg.method} <-- ${msg.sender}.${msg.method}`)
        }
        // FIXME bork'd - need state information regarding connectivity of process/service, and its an "array" of connections
        // log.info(`connectionImpl / connections ${[...runtime.getClients().keys()]} `)

        // fine the gateway for the message's remoteId
        let gateway: Gateway = runtime.getGateway(msgId)
        if (!gateway) {
          log.error(`NO GATEWAY for remoteId ${msgId}`)
          return null
        }

        // log.info(`gateway ${gateway.fullname} handling msg for id ${msgId}`)

        // TODO - implement synchronous blocking
        let blockingObject = gateway.sendRemote(msg)

        // TODO - implement synchronous blocking
        return blockingObject
      }

      // ==== LOCAL PROCESS DIFFERENT SERVICE ====
      // get the service - asynchronous buffered or synchronous non-buffered
      // default synchronous non-buffered
      if (msgFullName !== fullName) {
        log.info(
          `message to different service ${msgFullName} !== ${fullName} ${msgFullName}.${msg.method} from ${msg.sender}.${msg.method}`
        )
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
        // log.info(`(invoke) ${msgFullName}.${msg.method} from ${msg.sender}.${msg.method}`)
        let obj: any = this // cast away typescript

        if (!msg.method) {
          // ui error - user should be informed
          console.error(`method ${msg.method} not found`)
          return null
        }

        // invoke locally
        log.debug(`invoking ${this.name}.${msg.method}`)
        try {
          // if (!obj) {
          //   throw new Error(`obj is undefined in ${this.name}`)
          // }

          // if (!msg.method) {
          //   throw new Error(`msg.method is undefined or null in ${this.name}`)
          // }

          // if (typeof obj[msg.method] !== "function") {
          //   throw new Error(`Method '${msg.method}' is not a function on ${this.name}`)
          // }

          // log.info("=== obj:", obj)
          // // log.info("=== Methods on obj:", Object.keys(obj))

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
            subMsg.sender = this.fullname
            // log.info(`<- notify ${listener.callbackName}.${listener.callbackMethod}`)
            this.invokeMsg(subMsg)
          })
        }
        return ret
      }
    } catch (e) {
      // ui error - user should be informed
      log.error(`general catch failed to invoke ${this.name}.${msg.method} because ${e}`)
      if (e instanceof Error) {
        log.error(e.stack)
      } else {
        log.error("Caught an unknown error type:", e)
      }
    }
    return null
  }

  isReady(): boolean {
    return this.ready
  }

  publishStdOut(msg: string): string {
    log.info(`stdout: ${msg}`)
    return msg
  }

  // maybe purge is a good idea to purge the copy of the repo for an instance ?
  // vs release which only frees the service from memory
  releaseService() {
    log.info(`========= released service ${this.getName()} ===========`)
    RobotLabXRuntime.getInstance().release(this.fullname)
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
    if (status.level === "error") {
      log.error(status.detail)
    } else if (status.level === "warn") {
      log.warn(status.detail)
    } else {
      log.info(status.detail)
    }
    return status
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
    this.ready = true
    log.info(`========= started service ${this.name} ===========`)
  }

  stopService() {
    this.startTime = null
    this.ready = false
    log.info(`========= stopped service ${this.name} ===========`)
  }

  info(msg: string | null) {
    log.info(msg)
    this.invoke("publishStatus", new Status("info", msg, this.name))
  }

  warn(msg: string | null) {
    log.warn(msg)
    this.invoke("publishStatus", new Status("warn", msg, this.name))
  }

  error(msg: string | null) {
    log.error(msg)
    this.invoke("publishStatus", new Status("error", msg, this.name))
  }

  /**
   * Requesting to send a message to a remote process
   * @param msg
   */
  public sendRemote(msg: Message): void {
    // default is runtime's sendRemote
    RobotLabXRuntime.getInstance().sendRemote(msg)
  }

  public setInstalled(installed: boolean) {
    this.installed = installed
  }

  public save() {
    this.saveConfig()
  }

  toJSON() {
    return {
      config: this.config,
      fullname: this.fullname,
      hostname: this.hostname,
      id: this.id,
      installed: this.installed,
      name: this.name,
      notifyList: this.notifyList,
      pkg: this.pkg,
      ready: this.ready,
      typeKey: this.typeKey,
      version: this.version,
      startTime: this.startTime
    }
  }
}
