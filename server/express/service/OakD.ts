import InstallerPython from "../framework/InstallerPython"
import { getLogger } from "../framework/Log"
import Service from "../framework/Service"

const log = getLogger("OakD")

export default class OakD extends Service {
  config = {
    installed: false
  }

  installer: InstallerPython = null

  pythonVersion: string = null

  constructor(
    public id: string,
    public name: string,
    public typeKey: string,
    public version: string,
    public hostname: string
  ) {
    super(id, name, typeKey, version, hostname) // Call the base class constructor if needed
  }

  startService(): void {
    // log.info(`Starting OakD service`)
    super.startService()
    this.installer = new InstallerPython(this)
    // platformInfo = installer.install(this.pkg)
  }

  checkPythonVersion(): any {
    this.installer.checkPythonVersion("3.6")
  }

  checkPipVersion(): any {
    this.installer.checkPipVersion("19.0")
  }

  // Not sure if this is the best way to exclude members from serialization
  // toJSON() {
  //   return {
  //     id: this.id,
  //     name: this.name,
  //     typeKey: this.typeKey,
  //     version: this.version,
  //     hostname: this.hostname,
  //     config: this.config
  //   }
  // }
}
