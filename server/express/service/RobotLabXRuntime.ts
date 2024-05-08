// import Service from "express/framework/Service"
// FIXME - aliases don't appear to be work, neither does root reference path
import { spawn } from "child_process"
import { LaunchAction } from "express/framework/LaunchDescription"
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
// import LaunchDescription from "express/framework/LaunchDescription"
// const LaunchDescription = require("express/framework/LaunchDescription").default

const log = getLogger("RobotLabXRuntime")

interface Error {
  stack?: string | undefined
}
// import Service from "@framework/Service"
export default class RobotLabXRuntime extends Service {
  private static instance: RobotLabXRuntime

  protected dataDir = "./data"
  protected configDir = "./config"

  config = {
    config: "default",
    registry: [] as string[]
  }

  save() {
    const filePath = path.join(this.dataDir, this.config.config, "runtime.yml")
    try {
      const yamlStr = YAML.stringify(this.config)
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, yamlStr, "utf8")
      console.log("Config saved to", filePath)
    } catch (error) {
      this.error(`Failed to save config: ${error}`)
    }
  }

  apply(config: any) {
    this.config = config
    this.save()
  }

  readConfig() {
    const filePath = path.join(this.dataDir, this.config.config, "runtime.yml")
    try {
      const file = fs.readFileSync(filePath, "utf8")
      const config = YAML.parse(file)
      this.config = config
      console.log("Config loaded from", filePath)
    } catch (error) {
      this.error(`Failed to load config: ${error}`)
    }
  }

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
    public typeKey: string,
    public version: string,
    public hostname: string
  ) {
    super(id, name, typeKey, version, hostname) // Call the base class constructor if needed
    fs.mkdir(this.dataDir, { recursive: true }, (err) => {
      if (err) {
        log.error(`Error creating data directory: ${err}`)
      }
    })
    fs.mkdir(path.join(this.configDir, this.config.config), { recursive: true }, (err) => {
      if (err) {
        log.error(`Error creating data directory: ${err}`)
      }
    })
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

  async start(launcher: string) {
    log.info(`Starting launcher: ${launcher}`)

    try {
      log.info(`cwd ${process.cwd()}`)
      // Dynamically import the Default configuration based on the launcher name
      const modulePath = `../../config/${launcher}` // Construct the module path dynamically
      const configModule = await import(modulePath)
      const DefaultConfig = configModule.default

      // Create an instance of the dynamically loaded configuration
      const configInstance = new DefaultConfig()

      // Process the configuration - this example just logs the loaded configuration
      log.info(`Loaded configuration with ${configInstance.getLaunchActions().length} actions.`)

      // You might want to do more here, such as applying the configuration or starting nodes
      configInstance.getLaunchActions().forEach((action: LaunchAction) => {
        log.info(`Starting ${action.package}/${action.executable} named ${action.name}`)
        this.startServiceType(action.name, action.executable)
      })
    } catch (error) {
      if (error instanceof Error) {
        log.error(`Error loading configuration for ${launcher}: ${error.message}`)
      } else {
        log.error(`An unknown error occurred while loading configuration for ${launcher}`)
      }
    }
  }

  // TODO - remove version
  startServiceType(serviceName: string, serviceType: string): Service {
    try {
      const check = this.getService(serviceName)
      if (check != null) {
        log.info(`service ${check.getName()}@${check.getId()} already exists`)
        return check
      }

      log.info(`starting service: ${serviceName}, type: ${serviceType} in ${process.cwd()}`)

      // repo should be immutable - make a copy to service/{name} if one doesn't already exist
      const targetDir = `./express/public/service/${serviceName}`
      const repo = new Repo()
      repo.copyPackage(serviceName, serviceType)
      log.info(`successful ${targetDir}`)

      const pkgYmlFile = `${targetDir}/package.yml`

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

      let platformInfo = null

      // determine necessary platform python, node, docker, java
      // yes | no -> install -> yes | no
      if (pkg.platform === "python") {
        this.installInfo(`python required for ${serviceType}`)
        let installer = new InstallerPython()
        // default install venv and pip
        // check if min python version is correct
        platformInfo = installer.install({ cwd: targetDir })
        dependenciesMet = true
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

      log.info(`starting process ${targetDir}/${pkg.cmd} ${pkg.args}`)
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
        log.info(`spawning process ${pkg.cmd} ${pkg.args} in ${targetDir}`)
        const childProcess = spawn(pkg.cmd, pkg.args, { cwd: targetDir, shell: true })

        childProcess.on("error", (err) => {
          log.error(`failed to start subprocess. ${err}`)
          // send message with error to UI
          return
        })

        if (childProcess.pid) {
          // register the service
          service = new Service(childProcess.pid.toString(), serviceName, serviceType, version, this.getHostname())
        } else {
          log.error("Process PID is undefined, indicating an issue with spawning the process.")
          return
        }

        // Stream stdout and stderr
        childProcess.stdout.on("data", (data) => {
          log.info(`STDOUT: ${data}`)
          // TODO more structured publishStdOutRecord
          // where record.level record.ts record.msg
          service.invoke("publishStdOut", data.toString())
        })

        childProcess.stderr.on("data", (data) => {
          log.error(`STDERR: ${data}`)
          service.invoke("publishStdOut", data.toString())
        })

        // Handle process exit
        childProcess.on("close", (code) => {
          log.info(`Subprocess exited with code ${code}`)
          // Optionally handle process cleanup or restart
        })

        // register the process
        let platformVersion = platformInfo?.platformVersion
        const pd: ProcessData = new ProcessData(
          serviceName,
          childProcess.pid.toString(),
          this.getHostname(),
          pkg.platform,
          platformVersion ? platformVersion : pkg.platformVersion // actual vs requested version
        )
        this.registerProcess(pd)

        // service = new Service(childProcess.pid.toString(), serviceName, serviceType, version, this.getHostname())
        // for unaliased ids for services - single process services will be serviceName@serviceName
        // FIXME MAKE A PROXY TYPE !!!
        service = new Service(this.getId(), serviceName, serviceType, version, this.getHostname())

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
    this.processes[`${process.id}@${process.hostname}`] = process
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

  /**
   * Returns full name of all services
   * @returns Array of all registry service names
   */
  getServiceNames(): string[] {
    const localId = RobotLabXRuntime.instance.getId() // Assuming CodecUtil.getId() returns the local ID string
    const registry = Store.getInstance().getRegistry() // Assuming this returns a dictionary
    return Object.keys(registry)
  }

  /**
   * Returns only local services and short names
   * @returns Array of short names of local services
   */
  getLocalServiceNames(): string[] {
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
