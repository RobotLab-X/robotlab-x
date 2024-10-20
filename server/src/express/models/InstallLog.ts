export default class InstallLog {
  public ts: number = new Date().getTime()
  public level: string | null = null
  public msg: string | null = null

  constructor(level: string | null = null, msg: string | null = null) {
    this.ts = new Date().getTime()
    this.level = level
    this.msg = msg
  }
}
