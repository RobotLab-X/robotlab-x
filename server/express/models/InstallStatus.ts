export class InstallStatus {
  public ts: number = new Date().getTime()
  public ready: boolean = false
  // list of dependency steps
  public steps: string[] = []
  public type: string | null = null
}
