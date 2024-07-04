import { getLogger } from "../framework/Log"
import Service from "../framework/Service"

const log = getLogger("RobotLabXUI")

/**
 * This is a form of proxy, because the real service
 * is in the browser.
 *
 * @class RobotLabXUI
 * @extends Service
 * @description Placeholder for the RobotLabXUI service.
 */

export default class RobotLabXUI extends Service {
  /**
   * @property {RobotLabXUI} config - The configuration for the clock service.
   */
  config = {
    dashboards: { default: { runtime: { x: "0", y: "0", w: "4", h: "3" } } },
    start: false
  }

  /**
   * Creates an instance of RobotLabXUI.
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
    this.installed = true
  }

  /**
   * Serializes the RobotLabXUI instance to JSON.
   * Excludes intervalId from serialization.
   * @returns {object} The serialized RobotLabXUI instance.
   */
  toJSON() {
    return {
      ...super.toJSON()
    }
  }
}
