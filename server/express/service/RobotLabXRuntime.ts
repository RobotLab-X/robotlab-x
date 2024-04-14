// import Service from "express/framework/Service"
// FIXME - aliases don't appear to be work, neither does root reference path
import { spawn } from "child_process"
import fs from "fs"
import path from "path"
import YAML from "yaml"
import Store from "../../express/Store"
import { CodecUtil } from "../framework/CodecUtil"
import { Repo } from "../framework/Repo"
import Service from "../framework/Service"
import { HostData } from "../models/HostData"
import { ProcessData } from "../models/ProcessData"
import { ServiceTypeData } from "../models/ServiceTypeData"

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

  // maybe purge is a good idea to purge the copy of the repo for an instance ?
  // vs release which only frees the service from memory
  releaseService() {
    super.releaseService()
  }

  // TODO - remove version
  start(serviceName: string, serviceType: string): any {
    try {
      let version = "0.0.1"
      console.log(`Started service: ${serviceName}, Type: ${serviceType}`)

      console.info(process.cwd())

      // repo should be immutable - make a copy to service/{name} if one doesn't already exist
      const pkgPath = `./express/public/service/${serviceName}`
      const repo = new Repo()
      const successful = repo.copyPackage(serviceName, serviceType, version)
      console.info(`successful ${successful}`)

      const pkgYmlFile = `${pkgPath}/package.yml`

      // loading type info
      console.info(`loading type data from ${pkgYmlFile}`)
      const file = fs.readFileSync(pkgYmlFile, "utf8")
      const pkg = YAML.parse(file)
      console.info(`package.yml ${pkg}`)

      // TODO - if service request to add a service
      // and mrl and process exists - then /runtime/start

      // determine necessary platform python, node, docker, java
      // yes | no -> install -> yes | no

      // TODO - way to set cmd line args

      console.info(`python package ${pkg}`)

      // resolve if package.yml dependencies are met

      console.info(`yaml ${JSON.stringify(pkg)}`)

      // creating instance config from type if it does not exist

      // preparing to start the process

      // const script = "start.py"
      // register

      // TODO - only if you need a new process
      // TODO get package.yml from processModule - check if
      // dependencies are met
      // host check
      // platform check - python version, pip installed, venv etc.
      // pip libraries and versions installed
      let runtime = RobotLabXRuntime.getInstance()

      const pd: ProcessData = new ProcessData(
        serviceName,
        "123456", // process.pid,
        runtime.getHostname(),
        "python",
        "3.8.5"
      )
      runtime.registerProcess(pd)

      console.info(`starting process ${pkgPath}/${pkg.cmd} ${pkg.args}`)

      // spawn the process
      const childProcess = spawn(pkg.cmd, pkg.args, { cwd: pkgPath })

      childProcess.on("error", (err) => {
        console.error(`failed to start subprocess. ${err}`)
        // send message with error to UI
      })

      if (childProcess.pid) {
        // register the service
        const service: Service = new Service(
          childProcess.pid.toString(),
          serviceName,
          serviceType,
          version,
          runtime.getHostname()
        )

        // TODO register the service
        runtime.register(service)
      }

      console.info(`process ${JSON.stringify(childProcess)}`)
      return childProcess
    } catch (e) {
      console.error(e)
    }
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
    const fullName = CodecUtil.getFullName(name)
    return Store.getInstance().getService(fullName)
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
