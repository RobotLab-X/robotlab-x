import fs from "fs"
import path from "path"
import yaml from "yaml"
import { getLogger } from "./Log"

const log = getLogger("Repo")

// FIXME - there should be no catches in this class only throws
export class Repo {
  protected repoMap: any = {} // new Map<string, any>()
  protected services: any = {} // Map<string, any> = new Map()

  load() {
    log.info("loading repo")
    this.processRepoDirectory("./express/public/repo")
    this.loadServices()
  }

  getRepo() {
    return this.repoMap
  }

  loadConfigurations() {
    const configDir = path.join(__dirname, "..", "config")
    const files = fs.readdirSync(configDir)
    files.forEach((file) => {
      try {
        if (file.endsWith(".js")) {
          const configPath = path.join(configDir, file)
          log.info(`attempting to load:[${configPath}]`)
          // const ServiceClass = require(servicePath)

          const importedModule = require(configPath)
          const ConfigClass = importedModule.default // Accessing the default export

          const configName = file.replace(".js", "")

          if (typeof ConfigClass !== "function") {
            log.error(`Loaded module from ${configPath} is not a constructor: ${typeof ConfigClass}`)
          } else {
            log.info(`Registering config type: ${configName}`)
            this.services[configName] = ConfigClass
          }

          // Register each service with the filename (minus the extension) as key
          log.info(`=======registering config type: ${configName}`)
          this.services[configName] = ConfigClass
        }
      } catch (error) {
        log.error(`Error loading config: ${error}`)
      }
    })
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
  getService(id: string, name: string, serviceType: string, version: string, hostname: string | null = null) {
    const ServiceClass = this.services.get(serviceType)
    if (!ServiceClass) {
      throw new Error(`No service found for type: ${serviceType}`)
    }
    log.info(`constructing ${serviceType}`)
    return new ServiceClass(id, name, serviceType, version, hostname)
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
    const source = `./express/public/repo/${typeKey}/`
    const target = `./express/public/service/${name}`
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
