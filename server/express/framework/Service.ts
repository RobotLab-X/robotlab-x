// Service.ts
export default class Service {
  protected startTime: Date | null = null

  constructor(
    public name: string,
    public type: string,
    public version: string
  ) {
    // Initialize service with basic details
  }

  // Example of a shared method
  startService() {
    this.startTime = new Date()
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
