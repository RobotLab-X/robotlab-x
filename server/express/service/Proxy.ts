import { getLogger } from "../framework/Log"
import Service from "../framework/Service"

const log = getLogger("Proxy")

/**
 * General Proxy Service - a service that proxies all calls to another process id.
 * By itself its not very useful, but it allows message routing
 * to and from the target service.
 *
 * It might be usefule for external process install and starting
 *
 */
export default class Proxy extends Service {
  public proxyTypeKey: string = null

  config: any = {}

  constructor(
    public id: string,
    public name: string,
    public typeKey: string,
    public version: string,
    public hostname: string
  ) {
    super(id, name, typeKey, version, hostname) // Call the base class constructor if needed
  }

  toJSON() {
    return {
      ...super.toJSON(),
      proxyTypeKey: this.proxyTypeKey
    }
  }
}
