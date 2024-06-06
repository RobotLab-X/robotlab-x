import { PythonShell } from "python-shell"
import { getLogger } from "../framework/Log"
import Service from "../framework/Service"

const log = getLogger("OpenCV")

/**
 * @class OpenCV
 * @extends Service
 * @description A service that provides python functionality, periodically publishing the current epoch time.
 */
export default class OpenCV extends Service {
  /**
   * @property {OpenCVConfig} config - The configuration for the python service.
   */
  config = {
    installed: false,
    capture: false
  }

  private shell: PythonShell = null

  /**
   * Creates an instance of OpenCV.
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

  startService(): void {
    super.startService()
    if (!this.config.installed) {
      this.install()
    }
  }

  addFilter(name: string, type: string): void {}

  // TODO handle messages to user
  async capture(): Promise<void> {
    log.info("Starting Python shell")
    if (this.shell) {
      log.info("Capture already started.")
      return
    }
    try {
      this.shell = new PythonShell("express/public/repo/OpenCV/start.py", null)
      this.shell.on("message", (message) => {
        log.info(message)
      })
      this.shell.on("error", (err) => {
        log.error(err)
      })
      this.shell.on("close", () => {
        log.info("Python shell closed")
        this.shell = null
      })
    } catch (error) {
      log.error("Error starting PythonShell:", error)
    }
  }

  stopCapture(): void {
    log.info("Stopping Python shell")
    if (!this.shell) {
      log.info("Capture already stopped.")
      return
    }
    if (this.shell) {
      this.shell.end(function (err, code, signal) {
        if (err) throw err
        log.info(`The exit code was: ${code}`)
        log.info(`The exit signal was: ${signal}`)
        log.info("finished")
      })

      this.shell.kill("SIGTERM")
      this.shell = null
    } else {
      console.warn("No active Python shell to stop.")
    }
  }

  install(): void {}

  /**
   * Serializes the OpenCV instance to JSON.
   * Excludes non serializable properties.
   * FIXME - add ...this.super.toJSON()
   * @returns {object} The serialized OpenCV instance.
   */
  // toJSON() {
  //   return {
  //     id: this.id,
  //     name: this.name,
  //     fullname: this.fullname,
  //     typeKey: this.typeKey,
  //     version: this.version,
  //     hostname: this.hostname,
  //     config: this.config,
  //     notifyList: this.notifyList
  //   }
  // }
}
