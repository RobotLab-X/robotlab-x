// import Service from "express/framework/Service"
// FIXME - aliases don't appear to be work, neither does root reference path
import { HostData } from "express/models/HostData"
import { ProcessData } from "express/models/ProcessData"
import { ServiceTypeData } from "express/models/ServiceTypeData"
import Service from "../framework/Service"
import Store from "../framework/Store"

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

  // servo@raspi4  - {serviceName}@{processName}
  // protected registry: { [id: string]: Service } = {}

  // must be pid or userdefined {pid/id}
  protected processes: { [id: string]: ProcessData } = {}

  // FIXME - how to organize fqdn, hostname, ip, mac, etc. user defined?
  //  hostname or userdefined ? {hostname}
  protected hosts: { [id: string]: HostData } = {}

  // static meta data from both registered services and
  // local packages
  protected types: { [id: string]: ServiceTypeData } = {}

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

  public registerHost(host: HostData) {
    this.hosts[`${host.hostname}`] = host
  }

  public registerProcess(process: ProcessData) {
    this.processes[`${process.id}@${process.host}`] = process
  }

  public registerType(type: ServiceTypeData) {
    this.types[`${type.typeKey}@${type.version}`] = type
  }

  public register(service: Service) {
    Store.getInstance().register(`${service.name}@${service.id}`, service)
  }

  public getHost() {
    if (this.hostname == null) {
      return null
    }
    return this.hosts[this.hostname]
  }

  public getRegistry(): Object {
    return Store.getInstance().getRegistry()
  }
}
