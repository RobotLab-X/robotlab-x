// import Service from "express/framework/Service"
// FIXME - aliases don't appear to be work, neither does root reference path
import { spawn } from "child_process"
import fs from "fs"
import path from "path"
import YAML from "yaml"
import Store from "../../express/Store"
import { CodecUtil } from "../framework/CodecUtil"
import { getLogger } from "../framework/Log"
import { Repo } from "../framework/Repo"
import Service from "../framework/Service"
import { HostData } from "../models/HostData"
import Package from "../models/Package"
import { ProcessData } from "../models/ProcessData"
import { ServiceTypeData } from "../models/ServiceTypeData"
import TestNodeService from "./TestNodeService"

const log = getLogger("RobotLabXRuntime")

// import Service from "@framework/Service"
export default class RobotLabXRuntime extends Service {
  private static instance: RobotLabXRuntime

  static createInstance(id: string, hostname: string): RobotLabXRuntime {
    if (!RobotLabXRuntime.instance) {
      RobotLabXRuntime.instance = new RobotLabXRuntime(id, "runtime", "RobotLabXRuntime", "0.0.1", hostname)
    } else {
      log.error("RobotLabXRuntime instance already exists")
    }
    return RobotLabXRuntime.instance
  }

  getClientKeys() {
    return [...Store.getInstance().getClients().keys()]
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
  start(serviceName: string, serviceType: string): Service {
    try {
      const check = this.getService(serviceName)
      if (check != null) {
        log.info(`service ${check.getName()}@${check.getId()} already exists`)
        return check
      }

      log.info(`starting service: ${serviceName}, type: ${serviceType} in ${process.cwd()}`)

      // repo should be immutable - make a copy to service/{name} if one doesn't already exist
      const pkgPath = `./express/public/service/${serviceName}`
      const repo = new Repo()
      const successful = repo.copyPackage(serviceName, serviceType)
      log.info(`successful ${successful}`)

      const pkgYmlFile = `${pkgPath}/package.yml`

      // loading type info
      log.info(`loading type data from ${pkgYmlFile}`)
      const file = fs.readFileSync(pkgYmlFile, "utf8")
      const pkg: Package = YAML.parse(file)
      let version = pkg.version
      log.info(`package.yml ${JSON.stringify(pkg)}`)

      // TODO - if service request to add a service
      // and mrl and process exists - then /runtime/start

      // determine necessary platform python, node, docker, java
      // yes | no -> install -> yes | no

      // TODO - way to set cmd line args

      // resolve if package.yml dependencies are met

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

      log.info(`starting process ${pkgPath}/${pkg.cmd} ${pkg.args}`)
      let service: Service = null
      // spawn the process if none node process
      if (pkg.platform === "node") {
        // ================== dynamically load import works begin ==================
        // dynamically load import TODO - promote
        // const { default: ServiceClass } = import(`./${serviceType}`)
        // instantiate service
        // service = new ServiceClass(this.getId(), serviceName, serviceType, version, this.getHostname())
        // ================== dynamically load import works end ==================
        service = new TestNodeService(this.getId(), serviceName, serviceType, version, this.getHostname())
      } else {
        // spawn the process
        const childProcess = spawn(pkg.cmd, pkg.args, { cwd: pkgPath })

        childProcess.on("error", (err) => {
          log.error(`failed to start subprocess. ${err}`)
          // send message with error to UI
        })

        if (childProcess.pid) {
          // register the service
          const service: Service = new Service(
            childProcess.pid.toString(),
            serviceName,
            serviceType,
            version,
            this.getHostname()
          )
        }
        // register the process
        const pd: ProcessData = new ProcessData(
          serviceName,
          childProcess.pid.toString(),
          this.getHostname(),
          pkg.platform,
          pkg.platformVersion
        )
        this.registerProcess(pd)

        service = new Service(childProcess.pid.toString(), serviceName, serviceType, version, this.getHostname())

        log.info(`process ${JSON.stringify(childProcess)}`)
      }

      // register and start the service
      this.register(service)
      return service
    } catch (e) {
      log.error(e)
    }
  }

  release(name: string): void {
    log.info(`Released service: ${name}`)
  }

  getUptime(): string {
    let uptime: string = super.getUptime()
    log.info(`Uptime: ${uptime}`)
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
    log.info(`== registering service: ${typeof service} ==`)
    Store.getInstance().register(`${service.name}@${service.id}`, service)
    this.invoke("registered", service)
  }

  registered(service: Service): Service {
    return service
  }

  getRepo() {
    const repoBasePath = path.join(__dirname, "../public/repo")
    log.info(`======== repo base path: ${repoBasePath} ========`)
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
