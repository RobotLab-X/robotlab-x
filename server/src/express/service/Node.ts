import { getLogger } from "../framework/LocalLog"
import Service from "../framework/Service"

const log = getLogger("Node")

/**
 * @class Node
 * @extends Service
 * @description A service that provides node functionality and a programming interface to the RobotLab-X runtime.
 */
export default class Node extends Service {
  /**
   * @property {NodeConfig} config - The configuration for the node service.
   */
  config = {}

  /**
   * Creates an instance of Node.
   * @param {string} id - The unique identifier for the service.
   * @param {string} name - The name of the service.
   * @param {string} typeKey - The type key of the service.
   * @param {string} version - The version of the service.
   * @param {string} hostname - The hostname of the service.
   */
  constructor(
    public id: string,
    public name: string,
    public typeKey: string,
    public version: string,
    public hostname: string
  ) {
    super(id, name, typeKey, version, hostname)
  }

  stopService(): void {
    super.stopService()
  }

  /**
   * Serializes the Node instance to JSON.
   * Excludes intervalId from serialization.
   * @returns {object} The serialized Node instance.
   */
  toJSON() {
    return {
      ...super.toJSON()
    }
  }
}
