export class ServiceData {
  id: string | null = null
  name: string | null = null
  typeKey: string | null = null
  version: string | null = null
  hostname: string | null = null

  public constructor(
    id: string,
    name: string,
    typeKey: string,
    version: string,
    hostname: string | null
  ) {
    this.id = id
    this.name = name
    this.typeKey = typeKey
    this.version = version
    this.hostname = hostname
  }
}
