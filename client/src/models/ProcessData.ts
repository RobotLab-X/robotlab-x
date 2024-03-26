export class ProcessData {
  public id: string | null = null
  public pid: number | null = null
  public host: string | null = null
  // normalize to node, chrome, electron, python, java, go etc. 1 level deep from service
  public platform: string | null = null
  public platformVersion: string | null = null
  public shell?: string
  // public memory: number | null = null
  public uptime: number | null = null
  public status: string | null = null
  public restarts: number | null = null
  public process: any = null

  public constructor(
    id: string,
    pid: any,
    host: string | null,
    platform: string | null,
    platformVersion: string | null
  ) {
    this.host = host
    this.id = id
    this.pid = pid
    this.platform = platform
    this.platformVersion = platformVersion
  }
}
