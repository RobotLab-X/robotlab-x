import { SubscriptionListener } from "../models/SubscriptionListener"
import { CodecUtil } from "./CodecUtil"

export default class Service {
  protected startTime: Date | null = null

  id: string | null = null
  name: string | null = null
  typeKey: string | null = null
  version: string | null = null
  hostname: string | null = null

  notifyList = new Map<string, SubscriptionListener[]>()

  constructor(id: string, name: string, typeKey: string, version: string, hostname: string | null = null) {
    this.id = id
    this.name = name
    this.typeKey = typeKey
    this.version = version
    this.hostname = hostname
  }

  addListener(method: string, remoteName: string, remoteMethod: string) {
    if (remoteMethod === null) {
      remoteMethod = CodecUtil.getCallbackTopicName(method)
    }
    console.info(`adding listener ${this.name}.${method} --> ${remoteName}.${method}`)
    if (!this.notifyList.has(method)) {
      this.notifyList.set(method, [])
    }
    for (const listener of this.notifyList.get(method) || []) {
      if (listener.callbackName === remoteName && listener.callbackMethod === remoteMethod) {
        console.info(`listener on ${method} for -> ${remoteName}.${method} already exists`)
        return
      }
    }
    this.notifyList.get(method).push(new SubscriptionListener(method, remoteName, remoteMethod))
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
    return this.invokeOn(true, this, methodName, ...args)
  }

  invokeOn(block: boolean, obj: any, methodName: string, ...args: any[]): any {
    let ret: any = null

    if (args && args.length > 0) {
      ret = obj[methodName](...args)
    } else {
      ret = obj[methodName]()
    }

    // normalize undefined to null
    if (ret === undefined) {
      ret = null
    }

    // TODO - process subscription

    return ret
  }

  isReady(): boolean {
    return this.startTime !== null
  }

  // maybe purge is a good idea to purge the copy of the repo for an instance ?
  // vs release which only frees the service from memory
  releaseService() {
    console.info(`========= released service ${this.getName()} ===========`)
  }

  removeListener(method: string, remoteName: string, remoteMethod: string) {
    if (remoteMethod === null) {
      remoteMethod = CodecUtil.getCallbackTopicName(method)
    }

    console.info(`removing listener ${this.name}.${method} --> ${remoteName}.${method}`)
    if (!this.notifyList.has(method)) {
      return
    }

    this.notifyList.get(method).forEach((listener, index) => {
      if (listener.callbackName === remoteName && listener.callbackMethod === remoteMethod) {
        this.notifyList.get(method)?.splice(index, 1)
        return
      }
    })
  }

  // Example of a shared method
  startService() {
    this.startTime = new Date()
    console.info(`========= started service ${this.getUptime()} ===========`)
  }

  stopService() {
    this.startTime = null
    console.info(`========= stopped service ${this.getName()} ===========`)
  }
}
