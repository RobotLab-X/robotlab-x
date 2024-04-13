// import Service from "express/framework/Service"
// FIXME - aliases don't appear to be work, neither does root reference path
import Service from "../framework/Service"
import { HostData } from "../models/HostData"
import { ProcessData } from "../models/ProcessData"
import { ServiceTypeData } from "../models/ServiceTypeData"
// import Store from "../framework/Store"
import path from "path"
import Store from "../../express/Store"
import { Repo } from "../framework/Repo"

// import Service from "@framework/Service"
export default class RobotLabXRuntime extends Service {
  private static instance: RobotLabXRuntime

  static createInstance(id: string, hostname: string): RobotLabXRuntime {
    if (!RobotLabXRuntime.instance) {
      RobotLabXRuntime.instance = new RobotLabXRuntime(id, "runtime", "RobotLabXRuntime", "0.0.1", hostname)
    } else {
      console.error("RobotLabXRuntime instance already exists")
    }
    return RobotLabXRuntime.instance
  }

  static getInstance(): RobotLabXRuntime {
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

  getLocalProcessData(): ProcessData {
    let pd: ProcessData = new ProcessData(this.getId(), process.pid, this.getHostname(), "node", process.version)
    return pd
  }

  // TODO - remove version
  start(name: string, type: string, version: string): void {
    console.log(`Started service: ${name}, Type: ${type}, Version: ${version}`)
    super.startService() // Optionally call a method from the base class
  }

  release(name: string): void {
    console.log(`Released service: ${name}`)
  }

  getUptime(): string {
    let uptime: string = super.getUptime()
    console.log(`Uptime: ${uptime}`)
    return uptime
  }

  getService(name: string): Service | null {
    return null
  }

  registerHost(host: HostData) {
    this.hosts[`${host.hostname}`] = host
  }

  registerProcess(process: ProcessData) {
    this.processes[`${process.id}@${process.host}`] = process
  }

  registerType(type: ServiceTypeData) {
    this.types[`${type.typeKey}@${type.version}`] = type
  }

  register(service: Service) {
    console.log(`== registering service: ${typeof service} ==`)
    Store.getInstance().register(`${service.name}@${service.id}`, service)
  }

  getRepo() {
    const repoBasePath = path.join(__dirname, "../public/repo")
    console.log(`======== repo base path: ${repoBasePath} ========`)
    const repo = new Repo()
    const repoMap = repo.processRepoDirectory(repoBasePath)
    // convert the Map to an Object to send as JSON
    const repoObject = Object.fromEntries(repoMap)
    return repoObject
  }

  getHost() {
    if (this.hostname == null) {
      return null
    }
    return this.hosts[this.hostname]
  }

  getRegistry(): Object {
    return Store.getInstance().getRegistry()
  }

  getServiceNames(): string[] {
    const localId = RobotLabXRuntime.instance.getId() // Assuming CodecUtil.getId() returns the local ID string
    const registry = Store.getInstance().getRegistry() // Assuming this returns a dictionary

    return Object.keys(registry)
      .filter((key) => key.endsWith(`@${localId}`)) // Filter keys that end with the local ID
      .map((key) => key.split("@")[0]) // Extract the name part from each key
  }

  publishInstallLog(msg: string): string {
    return msg
  }
}
