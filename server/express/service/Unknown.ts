import { getLogger } from "../framework/LocalLog"
import Service from "../framework/Service"

const log = getLogger("Unknown")

/**
 * This is a placeholder for an unknown service
 * The requested typeKey might be available in requestedTypeKey
 */
export default class Unknown extends Service {
  constructor(
    public id: string,
    public name: string,
    public typeKey: string,
    public version: string,
    public hostname: string
  ) {
    super(id, name, typeKey, version, hostname) // Call the base class constructor if needed
  }

  /**
   * The requested type which the local repo could not find.
   */
  public requestTypeKey: string = ""
}
