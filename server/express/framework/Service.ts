import Store from "../Store"
import Message from "../models/Message"
import { SubscriptionListener } from "../models/SubscriptionListener"
import { CodecUtil } from "./CodecUtil"
import { getLogger } from "./Log"

const log = getLogger("Service")

export default class Service {
  protected startTime: Date | null = null

  id: string | null = null
  name: string | null = null
  typeKey: string | null = null
  version: string | null = null
  hostname: string | null = null

  // notifyList = new Map<string, SubscriptionListener[]>()
  notifyList = {} as any

  config: any = {}

  constructor(id: string, name: string, typeKey: string, version: string, hostname: string | null = null) {
    this.id = id
    this.name = name
    this.typeKey = typeKey
    this.version = version
    this.hostname = hostname
  }

  addListener(method: string, remoteName: string, remoteMethod: string) {
    if (remoteMethod === null || remoteMethod === "" || remoteMethod === undefined) {
      remoteMethod = CodecUtil.getCallbackTopicName(method)
    }
    log.info(`adding listener ${this.name}.${method} --> ${remoteName}.${method}`)
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
    const uptime = now.getTime() - this.startTime.getTime()
    return `uptime: ${uptime / 1000} seconds`
  }

  invoke(methodName: string, ...args: any[]): any {
    let msg = new Message(this.name, methodName, args)
    return this.invokeMsg(msg)
  }

  getFullName(): string {
    return CodecUtil.getFullName(this.name)
  }

  invokeMsg(msg: Message) {
    const fullName = this.getFullName()
    const msgFullName = CodecUtil.getFullName(msg.name)
    const msgId = CodecUtil.getId(msgFullName)
    const id = this.getId()
    let ret: any = null

    // ==== REMOTE ====
    // FIXME - check if blocking or non-blocking
    // use gateway to send message to remote service
    if (msgId !== id) {
      // send message to remote service
      // log.info(`sending message to ${msgFullName}.${msg.method}`)
      // this.gateway.send(msg)
      log.info(`<--- ${msgFullName}.${msg.method} <-- ${this.name}.${msg.method}`)
      log.info(`clients ${[...Store.getInstance().getClients().keys()]} `)
      Store.getInstance().getClient(msgId)?.send(JSON.stringify(msg))
      // FIXME !! - need to implement gateway
      return null
    }

    // ==== LOCAL PROCESS DIFFERENT SERVICE ====
    // get the service - asynchronous buffered or synchronous non-buffered
    // default synchronous non-buffered
    if (msgFullName !== fullName) {
      let service = Store.getInstance().getService(msgFullName)
      if (service === null) {
        console.error(`service ${msgFullName} not found`)
        return null
      } else {
        // relay to correct service
        // service.send(msg)
        service.invokeMsg(msg)
      }

      // invoke the method on the service
      // log.info(`sending message to ${msgFullName}.${msg.method}`)
      // return service.invokeMsgOn(this, msg)
      return null
    }

    // ==== LOCAL ====
    // FIXME - check if blocking or non-blocking
    // is this the service to invoke the method on ?
    if (fullName === msgFullName) {
      let obj: any = this // cast away typescript

      // invoke locally
      log.info(`invoking ${this.name}.${msg.method}`)
      try {
        if (msg.data && msg.data.length > 0) {
          ret = obj[msg.method](...msg.data)
        } else {
          ret = obj[msg.method]()
        }
      } catch (e) {
        console.error(`failed to invoke ${this.name}.${msg.method} ${e}`)
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
          log.info(`---> notify ${listener.callbackName}.${listener.callbackMethod}`)
          this.invokeMsg(subMsg)
        })
      }
      return ret
    }
  }

  isReady(): boolean {
    return this.startTime !== null
  }

  // maybe purge is a good idea to purge the copy of the repo for an instance ?
  // vs release which only frees the service from memory
  releaseService() {
    log.info(`========= released service ${this.getName()} ===========`)
  }

  removeListener(method: string, remoteName: string, remoteMethod: string) {
    if (remoteMethod === null) {
      remoteMethod = CodecUtil.getCallbackTopicName(method)
    }

    log.info(`removing listener ${this.name}.${method} --> ${remoteName}.${method}`)
    if (!this.notifyList.has(method)) {
      return
    }

    this.notifyList.get(method).forEach((listener: any, index: any) => {
      if (listener.callbackName === remoteName && listener.callbackMethod === remoteMethod) {
        this.notifyList.get(method)?.splice(index, 1)
        return
      }
    })
  }

  // Example of a shared method
  startService() {
    this.startTime = new Date()
    log.info(`========= started service ${this.name} ===========`)
  }

  stopService() {
    this.startTime = null
    log.info(`========= stopped service ${this.name} ===========`)
  }
}
