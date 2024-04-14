// Service.ts
export default class Service {
  protected startTime: Date | null = null

  id: string | null = null
  name: string | null = null
  typeKey: string | null = null
  version: string | null = null
  hostname: string | null = null

  public constructor(id: string, name: string, typeKey: string, version: string, hostname: string | null = null) {
    this.id = id
    this.name = name
    this.typeKey = typeKey
    this.version = version
    this.hostname = hostname
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

  // maybe purge is a good idea to purge the copy of the repo for an instance ?
  // vs release which only frees the service from memory
  releaseService() {
    console.info(`========= released service ${this.getName()} ===========`)
  }

  isReady(): boolean {
    return this.startTime !== null
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

  public getId() {
    return this.id
  }

  public getName() {
    return this.name
  }

  public getHostname(): string | null {
    return this.hostname
  }

  public addListener(method: string, name: string) {
    console.info(`added listener for ${name} on method ${method}`)
    // Add listener code here
  }

  public removeListener(method: string, name: string) {
    console.info(`removed listener for ${name} on method ${method}`)
    // Remove listener code here
  }

  public invokeOn(block: boolean, obj: any, methodName: string, ...args: any[]) {
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
}
