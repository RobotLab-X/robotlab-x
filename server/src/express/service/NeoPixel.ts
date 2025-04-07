import { getLogger } from "../framework/LocalLog"
import Service from "../framework/Service"
import RobotLabXRuntime from "./RobotLabXRuntime"

const log = getLogger("NeoPixel")

/**
 * @class NeoPixel
 * @extends Service
 * @description A service that provides neopixel functionality, periodically publishing the current epoch time.
 */
export default class NeoPixel extends Service {
  /**
   * @property {NodeJS.Timeout | null} intervalId - The ID of the interval timer. This property is excluded from serialization.
   * @private
   */
  private intervalId: NodeJS.Timeout | null = null

  /**
   * @property {NeoPixelConfig} config - The configuration for the neopixel service.
   */
  config = {
    controller: "",
    pin: ""
  }

  /**
   * Creates an instance of NeoPixel.
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

  /**
   * Get the current set of possible controllers
   * @returns names of the controllers
   */
  getServoControllers(): string[] {
    return RobotLabXRuntime.getInstance().getServicesFromInterface("onServoMoveTo")
  }

  /**
   * Serializes the NeoPixel instance to JSON.
   * Excludes intervalId from serialization.
   * @returns {object} The serialized NeoPixel instance.
   */
  toJSON() {
    return {
      ...super.toJSON()
    }
  }
}
