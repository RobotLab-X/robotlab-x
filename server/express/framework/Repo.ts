import fs from "fs"
import path from "path"
import { default as yaml, default as YAML } from "yaml"
import Main from "../../electron/Main"
import Service from "../framework/Service"
import Package from "../models/Package"
import { getLogger } from "./Log"

const log = getLogger("Repo")

type ServiceConstructor = new (
  id: string,
  name: string,
  serviceType: string,
  version: string,
  hostname: string | null
) => Service

interface ServicesDictionary {
  [key: string]: ServiceConstructor
}

// FIXME - there should be no catches in this class only throws
export class Repo {
  protected repoMap: any = {} // new Map<string, any>()
  // protected services: any = {} // Map<string, any> = new Map()
  protected services: ServicesDictionary = {}

  load() {
    log.info("loading repo")
    // DEV
    // client is client/{dist} -> copied to  project-root/server/dist/client
    // {dist} will be project-root/server/dist

    // CLIENT
    // FIXME - client is {dist}/client

    // SERVER
    // FIXME - needs to be {dist}/espress/public /repo
    // FIXME - express root is {dist}/express/public /service
    // FIXME - express root is {dist}/express/public /images
    const main = Main.getInstance()
    this.processRepoDirectory(path.join(main.publicRoot, "repo"))
    this.loadServices()
  }

  getRepo() {
    return this.repoMap
  }

  getPackage(pkgName: string): Package {
    try {
      if (pkgName === null || pkgName === "" || pkgName === undefined) {
        log.error(`getPackage ${pkgName} not found`)
        return null
      }
      pkgName = pkgName.toLowerCase()
      log.info(`${pkgName} getting package`)
      const main = Main.getInstance()
      const targetDir = path.join(main.publicRoot, `repo/${pkgName}`)
      log.info(`successful ${targetDir}`)
      const pkgYmlFile = `${targetDir}/package.yml`

      // loading type info
      log.info(`loading type data from ${pkgYmlFile}`)
      const file = fs.readFileSync(pkgYmlFile, "utf8")
      const pkg: Package = YAML.parse(file)
      log.info(`package ${pkgName} loaded`)

      // if not a native node package
      if (!pkg.installed) {
        // check if installed
        pkg.installed = this.isInstalled(pkgName)
      }

      return pkg
    } catch (e) {
      log.error(`failed to load package ${e}`)
    }
    return null
  }

  loadServices() {
    const serviceDir = path.join(__dirname, "..", "service")
    const files = fs.readdirSync(serviceDir)
    files.forEach((file) => {
      try {
        if (file.endsWith(".js")) {
          const servicePath = path.join(serviceDir, file)
          log.info(`attempting to load:[${servicePath}]`)

          const importedModule = require(servicePath)
          const ServiceClass = importedModule.default // Accessing the default export

          const serviceName = file.replace(".js", "")

          if (typeof ServiceClass !== "function") {
            log.error(`Loaded module from ${servicePath} is not a constructor: ${typeof ServiceClass}`)
          } else {
            log.info(`Registering service type: ${serviceName}`)
            this.services[serviceName] = ServiceClass
          }

          // Register each service with the filename (minus the extension) as key
          log.info(`=======registering service type: ${serviceName}`)
          this.services[serviceName] = ServiceClass
        }
      } catch (error) {
        log.error(`Error loading service: ${error}`)
      }
    })
  }
  getNewService(
    id: string,
    name: string,
    serviceType: string,
    version: string,
    hostname: string | null = null
  ): Service {
    const ServiceClass = this.services[serviceType]
    if (!ServiceClass) {
      log.error(`No service found for type: ${serviceType} list of possible types: ${Object.keys(this.services)}`)
      throw new Error(`No service found for type: ${serviceType}`)
    }
    // FIXME - pretty sure this makes zombie objects - but those zombies
    // especially with different process ids are necessary for routing
    log.info(`constructing ${name}@${id}  ${serviceType}`)
    return new ServiceClass(id, name, serviceType, version, hostname)
  }

  installPackage(pkgTypeKey: string) {
    const main = Main.getInstance()
    const installFile = path.join(main.publicRoot, "repo", pkgTypeKey.toLowerCase(), "installed.txt")
    fs.writeFileSync(installFile, new Date().toLocaleString())
    log.info(`package ${pkgTypeKey} installed`)
  }

  isInstalled(pkgTypeKey: string): boolean {
    const main = Main.getInstance()
    const installFile = path.join(main.publicRoot, "repo", pkgTypeKey.toLowerCase(), "installed.txt")
    const exists = fs.existsSync(installFile)
    if (exists) {
      log.info(`package ${pkgTypeKey} installed`)
      return true
    }
    log.info(`package ${pkgTypeKey} not installed`)
    return
  }

  processRepoDirectory(basePath: string): Map<string, any> {
    try {
      // Read the directory containing the package definitions directly
      const repoDirs = fs.readdirSync(basePath, { withFileTypes: true })

      for (const dir of repoDirs) {
        if (dir.isDirectory()) {
          const dirPath = path.join(basePath, dir.name)
          const packageFilePath = path.join(dirPath, "package.yml")

          // Try to read the package file in each directory
          try {
            const packageFileContents = fs.readFileSync(packageFilePath, "utf8")
            const packageObject = yaml.parse(packageFileContents)

            // Use the directory name as the key since there are no version subdirectories
            this.repoMap[dir.name] = packageObject
          } catch (err) {
            // log.error(`Error reading package file in ${dirPath}: ${err}`)
            log.info(`skipping ${dirPath} no package file found`)
          }
        }
      }
    } catch (err) {
      log.error(`Error processing repository directory: ${err}`)
    }
    return this.repoMap
  }
}
