import { getLogger } from "../framework/Log"
import Service from "../framework/Service"

const log = getLogger("TestService")

export default class TestService extends Service {
  public uniqueId = "WOOT!"

  constructor(
    public id: string,
    public name: string,
    public typeKey: string,
    public version: string,
    public hostname: string
  ) {
    super(id, name, typeKey, version, hostname) // Call the base class constructor if needed
  }

  onUptime(str: string): string {
    log.info(`WOOOHOOO !!! ${this.name}.onUptime called ${str}`)
    return str
  }
}
