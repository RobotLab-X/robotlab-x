// import Service from "express/framework/Service"
// FIXME - aliases don't appear to be work, neither does root reference path
import { spawn } from "child_process"
import fs from "fs"
import path from "path"
import YAML from "yaml"
import Store from "../../express/Store"
import { CodecUtil } from "../framework/CodecUtil"
import InstallerPython from "../framework/InstallerPython"
import { getLogger } from "../framework/Log"
import { Repo } from "../framework/Repo"
import Service from "../framework/Service"
import { HostData } from "../models/HostData"
import Package from "../models/Package"
import { ProcessData } from "../models/ProcessData"
import { ServiceTypeData } from "../models/ServiceTypeData"

const log = getLogger("RobotLabXRuntime")

interface Error {
  stack?: string | undefined
}
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

  installInfo(msg: string) {
    log.info(msg)
    this.invoke("publishInstallLog", msg)
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
      log.info(`package.platform: ${pkg.platform}, type: ${serviceType} in ${process.cwd()}`)

      let dependenciesMet = false

      // determine necessary platform python, node, docker, java
      // yes | no -> install -> yes | no
      if (pkg.platform === "python") {
        this.installInfo(`python required for ${serviceType}`)
        let installer = new InstallerPython()
        installer.install()
        // check if python is installed

        // check if python version is correct
      } else {
        log.info(`platform [${pkg.platform}] not supported`)
      }

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
        this.installInfo(`node process ${serviceName} ${serviceType} ${pkg.platform} ${pkg.platformVersion}`)
        service = repo.getService(this.getId(), serviceName, serviceType, version, this.getHostname())
        log.info(`service ${JSON.stringify(service)}`)
        this.installInfo(`platform is ok`)
        this.register(service)
        this.installInfo(`registered service ${serviceName}`)
      } else if (dependenciesMet) {
        log.info(`dependencies met for ${serviceName} ${serviceType} ${pkg.platform} ${pkg.platformVersion}`)
        // spawn the process
        const childProcess = spawn(pkg.cmd, pkg.args, { cwd: pkgPath })

        childProcess.on("error", (err) => {
          log.error(`failed to start subprocess. ${err}`)
          // send message with error to UI
        })

        if (childProcess.pid) {
          // register the service
          service = new Service(childProcess.pid.toString(), serviceName, serviceType, version, this.getHostname())
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
      } else {
        log.error(`dependencies not met for ${serviceName} ${serviceType} ${pkg.platform} ${pkg.platformVersion}`)
        return null
      }

      // register and start the service
      this.register(service)
      return service
    } catch (e: any) {
      const error = e as Error

      // Get the file and line number where the error occurred
      const file = e.stack.split("\n")[1].match(/\((?<file>.+):\d+\)/)?.groups?.file
      const lineNumber = e.stack.split("\n")[1].match(/\((?<file>.+):(?<lineNumber>\d+)\)/)?.groups?.lineNumber

      log.error(`e ${error} ${file} ${lineNumber}`)
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
    // log.info(`registering service: ${service.name} ${service.constructor.name}`)
    log.info(`registering service: ${JSON.stringify(service)}`)
    log.info(`registering service: ${service.name}@${service.id}`)
    Store.getInstance().register(`${service.name}@${service.id}`, service)
    this.invoke("registered", service)
  }

  registered(service: Service): Service {
    return service
  }

  getRepo() {
    const repoBasePath = path.join(__dirname, "../public/repo")
    log.info(`getting repo with base path: ${repoBasePath}`)
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
    log.info(`publishInstallLog: ${msg}`)
    return msg
  }
}
