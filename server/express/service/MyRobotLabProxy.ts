import { getLogger } from "../framework/Log"
import Service from "../framework/Service"

const log = getLogger("MyRobotLabProxy")

/**
 * MyRobotLabProxy is a proxy for a MyRobotLab service
 * It should only be used as a placeholder which contains
 * the very basics of a service definition (id, name, typeKey, version, hostname)
 */
export default class MyRobotLabProxy extends Service {
  // MRL Service definition
  public service: any = null

  public connectorName: string = null
  public connectorId: string = null
  // the mrl type of this proxy
  public proxyTypeKey: string = null

  constructor(
    public id: string,
    public name: string,
    public typeKey: string,
    public version: string,
    public hostname: string
  ) {
    super(id, name, typeKey, version, hostname)
  }

  toJSON() {
    return {
      ...super.toJSON(),
      proxyTypeKey: this.proxyTypeKey,
      connectorName: this.connectorName,
      connectorId: this.connectorId
    }
  }
}
