// Service.ts
// FIXME  !!! - needs to be normalized with express Service.ts
export default class Service {
  protected startTime: number | null = null

  id: string | null = null
  name: string | null = null
  typeKey: string | null = null
  version: string | null = null
  hostname: string | null = null
  fullname: string | null = null
  config = {}

  public constructor(id: string, name: string, typeKey: string, version: string, hostname: string | null = null) {
    this.id = id
    this.name = name
    this.typeKey = typeKey
    this.version = version
    this.hostname = hostname
    this.fullname = `${this.name}@${this.id}`
  }
  // Example of a shared method
  startService() {
    this.startTime = new Date().getTime()
  }

  // Example of calculating uptime
  getUptime(): string {
    if (!this.startTime) {
      return "Service not started"
    }
    const now = new Date()
    const uptime = now.getTime() - this.startTime
    return `Uptime: ${uptime / 1000} seconds`
  }
}
