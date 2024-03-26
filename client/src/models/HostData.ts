export class HostData {
  public hostname: string | null = null
  public platform: string | null = null
  public architecture: string | null = null
  public numberOfCPUs: number | null = null
  public networkInterfaces: {} | null = null
  public uptime: number | null = null
  public freeMemory: number | null = null
  public totalMemory: number | null = null
  public loadAverage: number[] | null = null
  public currentUser: {} | null = null

  public static getLocalHostData(os: any): HostData {
    return {
      hostname: os.hostname(),
      platform: os.platform(),
      architecture: os.arch(),
      numberOfCPUs: os.cpus().length,
      networkInterfaces: os.networkInterfaces(),
      uptime: os.uptime(),
      freeMemory: os.freemem(),
      totalMemory: os.totalmem(),
      loadAverage: os.loadavg(),
      currentUser: os.userInfo()
    }
  }
}
