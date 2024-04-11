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
  }

  isReady(): boolean {
    return this.startTime !== null
  }

  // Example of calculating uptime
  getUptime(): string {
    if (!this.startTime) {
      return "Service not started"
    }
    const now = new Date()
    const uptime = now.getTime() - this.startTime.getTime()
    return `Uptime: ${uptime / 1000} seconds`
  }
}
