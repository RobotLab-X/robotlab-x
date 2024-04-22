export default class Status {
  public id: string | null = null
  public name: string | null = null
  public level: string | null = null // 'debug', 'info', 'warn', 'error'
  public key: string | null = null
  public detail: string | null = null
  public source: string | null = null

  constructor(level: string, detail: string, source: string | null = null) {
    this.level = level
    this.detail = detail
  }
}
