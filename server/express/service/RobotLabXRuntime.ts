// import Service from "express/framework/Service"
// FIXME - aliases don't appear to be work, neither does root reference path
import Service from "../framework/Service"
// import Service from "@framework/Service"
export default class RobotLabXRuntime extends Service {
  private static instance: RobotLabXRuntime

  public static createInstance(id: string, hostname: string): RobotLabXRuntime {
    if (!RobotLabXRuntime.instance) {
      RobotLabXRuntime.instance = new RobotLabXRuntime(id, "runtime", "RobotLabXRuntime", "0.0.1", hostname)
    } else {
      console.error("RobotLabXRuntime instance already exists")
    }
    return RobotLabXRuntime.instance
  }

  public static getInstance(): RobotLabXRuntime {
    return RobotLabXRuntime.instance
  }

  constructor(
    public id: string,
    public name: string,
    public type: string,
    public version: string,
    public hostname: string
  ) {
    super(id, name, type, version, hostname) // Call the base class constructor if needed
  }

  start(name: string, type: string, version: string): void {
    console.log(`Started service: ${name}, Type: ${type}, Version: ${version}`)
    super.startService() // Optionally call a method from the base class
  }

  release(name: string): void {
    console.log(`Released service: ${name}`)
  }

  getUptime(): string {
    return super.getUptime()
  }

  getService(name: string): Service | null {
    return null
  }
}
