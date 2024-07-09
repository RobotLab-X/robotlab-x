import fs from "fs"
import path from "path"
import yaml from "yaml"
import Main from "../../electron/ElectronStarter"
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
    this.processRepoDirectory(path.join(Main.publicRoot, "repo"))
    this.loadServices()
  }

  getRepo() {
    return this.repoMap
  }

  loadServices() {
    const serviceDir = path.join(__dirname, "..", "service")
    const files = fs.readdirSync(serviceDir)
    files.forEach((file) => {
      try {
        if (file.endsWith(".js")) {
          const servicePath = path.join(serviceDir, file)
          log.info(`attempting to load:[${servicePath}]`)
          // const ServiceClass = require(servicePath)

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

  // Probably preferred - vs saving from external source
  // setInstalled(pkg: Package) {
  //   pkg.setInstalled(true)
  //   fs.writeFileSync(pkg.getPath(), yaml.dump(pkg))

  // }

  savePackage(pkg: Package) {
    const packagePath = path.join(Main.publicRoot, "repo", pkg.typeKey.toLowerCase(), "package.yml")
    fs.writeFileSync(packagePath, yaml.stringify(pkg))
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

  public copyPackage(name: string, typeKey: string) {
    const source = path.join(Main.publicRoot, `repo/${typeKey.toLowerCase()}/`)
    const target = path.join(Main.publicRoot, `/service/${name}`)
    this.copyRecursiveSync(source, target)
    log.info("copy operation completed successfully")
  }

  private copyRecursiveSync(src: string, dest: string) {
    log.info(`copying ${src} to ${dest}`)

    // Check if the source exists
    if (!fs.existsSync(src)) {
      throw new Error("source does not exist")
    }

    const stats = fs.statSync(src)
    const isDirectory = stats.isDirectory()

    if (isDirectory) {
      // Ensure the directory exists or create it
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true })
      }
      const children = fs.readdirSync(src)
      for (const child of children) {
        const srcPath = path.join(src, child)
        const destPath = path.join(dest, child)
        this.copyRecursiveSync(srcPath, destPath) // Recurse for nested directories
      }
    } else {
      // copy file
      fs.copyFileSync(src, dest)
    }
  }
}
