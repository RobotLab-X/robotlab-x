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
    installed: false
  }

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

  capture(): void {
    PythonShell.run("express/public/repo/OpenCV/start.py", null).then((messages) => {
      console.log("finished")
    })
  }

  install(): void {}
}
