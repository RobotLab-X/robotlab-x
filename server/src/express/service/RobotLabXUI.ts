import { getLogger } from "../framework/LocalLog"
import Service from "../framework/Service"
import Message from "../models/Message"
import RobotLabXRuntime from "./RobotLabXRuntime"

const log = getLogger("RobotLabXUI")

/**
 * This is a form of proxy, because the real service
 * is in the browser or electron.
 *
 * @class RobotLabXUI
 * @extends Service
 * @description Proxy for the RobotLabXUI service.
 */

export default class RobotLabXUI extends Service {
  /**
   * @property {RobotLabXUI} config - The configuration for the clock service.
   */
  config = {
    dashboards: { default: { runtime: { x: "0", y: "0", w: "4", h: "3" } } }
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

  // THIS IS A PROXY - it is not a realservice
  public startService(): void {
    super.startService()
    // subscribe to runtime of ui
    // this.subscribeTo(this.fullname, "broadcastState")
    const runtime: RobotLabXRuntime = RobotLabXRuntime.getInstance()

    // Proxy will register connection, so when actual
    // service connects, this proxy will route messages correctly
    runtime.registerConnection(
      this.fullname,
      this.id,
      "waiting for client",
      "inbound",
      null /* ws not ready yet - client not attached */
    )
  }

  /**
   * Overriding sendRemote - all UIs are remote proxies,
   * however the funtionality of interest besides displaying is
   * configuration, which a RobotLabXUI does not have. The
   * proxy is the only way to send/save/apply configuration to this UI.
   *
   * So, we intercept the these messages here.
   *
   * @param msg
   */
  public sendRemote(msg: Message): void {
    log.warn(`sendRemote ${this.fullname}.${msg.method}`)

    // the real ui doesn't have any permenant state, so we
    // send the proxies state information to the ui

    // the UI listens to the proxy like it would any other service
    // and updates its state accordingly

    if (msg.method === "broadcastState") {
      msg.method = "onBroadcastState"
      msg.data = [this]
    }

    super.sendRemote(msg)
  }

  /**
   * Serializes the RobotLabXUI instance to JSON.
   * @returns {object} The serialized RobotLabXUI instance.
   */
  toJSON() {
    return {
      ...super.toJSON()
    }
  }
}
