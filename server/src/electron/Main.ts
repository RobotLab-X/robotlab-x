import fs from "fs"
import minimist from "minimist"
import os from "os"
import path from "path"
import yaml from "yaml"
import { getLogFilePath, getLogger } from "../express/framework/LocalLog"
import { HostData } from "../express/models/HostData"
import { ProcessData } from "../express/models/ProcessData"
import RobotLabXRuntime from "../express/service/RobotLabXRuntime"

const log = getLogger("Main")

export default class Main {
  static instance: Main

  // FIXME - remove all configurable items - that can be set from the command line or file
  // use argv directly

  args: string[]

  argv: any = null

  // top of the tree
  root: string

  // electron's appData directory - FIXME - remove if possible
  appData: string

  // user data directory separation from appData vs userData
  userData: string

  // The root directory of the app in both development and production
  // in dev this is cwd in prod its where the asar is extracted/dist
  distRoot: string = null

  // The root directory of the express server in both development and production
  // although this location is different depending on dev or prod
  publicRoot: string = null

  // Service API AND WS URL in Prod this will be the same as startUrl
  // defaults:
  //
  // dev Main.serviceUrl = "http://localhost:3001"
  // dev Main.startUrl = "http://localhost:3000"
  //
  // prod Main.serviceUrl = "http://localhost:3000"
  // prod Main.startUrl = "http://localhost:3000"
  serviceUrl: string

  /**
   * BrowserWindow.loadURL() will use this URL to load the app
   */
  startUrl: string

  logFilePath: string

  // typeless reference to electron
  electron: any

  // robotlabxruntime/package.yml
  pkg: any

  hasDisplay(): boolean {
    if (
      process.platform.startsWith("win") ||
      os.arch().includes("arm") ||
      (process.platform == "linux" && process.env.DISPLAY)
    ) {
      log.info(`hasDisplay true`)
      return true
    }
    log.info(`hasDisplay false`)
    return false
  }

  relaunch(): void {
    log.info("Relaunching")
    this.electron?.relaunch()
    // FIXME - shut down express gracefully ?
    // FIXME - if express "only" relaunch express "only"
  }

  async run(): Promise<void> {
    try {
      // first setup will be for dev
      this.argv = minimist(process.argv.slice(2), {
        // 3 important roots

        // FIXME - be able to override defaults
        default: {
          // distRoot: path.join(__dirname, ".."),
          // publicRoot: path.join(__dirname, "..", "express", "public"),
          launchFile: path.join(__dirname, "..", "launch", "default.js")
        }
      })

      // FIXME - overridable by args ?
      // set early, do not modify later
      this.distRoot = path.resolve(process.env.DISTROOT || "dist")
      this.publicRoot = path.resolve(process.env.PUBLICROOT || path.join(this.distRoot, "express", "public"))
      this.userData = path.resolve(process.env.USERDATA || path.join(process.cwd(), "data"))

      // FIXME - remove if possible
      this.appData = path.resolve(process.env.USERDATA || path.join(process.cwd(), "data"))

      log.info(`bootServer: argv: ${JSON.stringify(this.argv)}`)

      // extract VFS
      // new Pkg().extractVFS()

      // add version info
      log.info(`Starting RobotLab-X...`)
      log.info(`__dirname: ${__dirname}`)
      log.info(`DISTROOT: ${this.distRoot}`)
      log.info(`PUBLICROOT: ${this.publicRoot}`)
      log.info(`USERDATA: ${this.userData}`)
      log.info(`execPath: ${process.execPath}`)
      log.info(`Platform: ${process.platform}`)
      log.info(`Node.js Version: ${process.version}`)
      log.info(`CWD: ${process.cwd()}`)
      log.info(`PID: ${process.pid}`)
      log.info(`OS Type: ${os.type()}`)
      log.info(`Platform: ${os.platform()}`)
      log.info(`Architecture: ${os.arch()}`)
      log.info(`Hostname: ${os.hostname()}`)
      log.info(`Release: ${os.release()}`)
      log.info(`OS Uptime: ${os.uptime()} seconds`)
      log.info(`Total Memory: ${(os.totalmem() / 1024 ** 3).toFixed(2)} GB`)
      log.info(`Free Memory: ${(os.freemem() / 1024 ** 3).toFixed(2)} GB`)
      log.info(`CPUs: ${os.cpus().length}`)
      log.info(`appData: ${this.appData}`)
      log.info(`distRoot: ${this.distRoot}`)

      // immutable type and version information
      // should always exist
      // should also allow path to be passed in
      const runtimeYmlPath: string = path.join(this.publicRoot, "repo", "robotlabxruntime", "package.yml")

      log.info(`runtimeYmlPath: ${runtimeYmlPath}`)

      if (fs.existsSync(runtimeYmlPath)) {
        this.pkg = yaml.parse(fs.readFileSync(runtimeYmlPath, "utf8"))
      } else {
        log.error(`runtimeYmlPath ${runtimeYmlPath} does not exist`)
      }

      log.info(`RobotLabXRuntime version: ${this.pkg?.version}`)

      // FIXME this is not quite right
      this.logFilePath = getLogFilePath()

      // root distRoot and publicRoot
      if (this.hasArg("--help")) {
        this.printHelp()
        return
      }

      // start RobotLabXRuntime
      // let launchFile = this.argv.config ? this.argv.config : "default.js"
      // must create instance before startServiceType to fix chicken egg problem
      let runtime: RobotLabXRuntime = RobotLabXRuntime.createInstance(this.argv.launchFile)

      runtime.startServiceType("runtime", "RobotLabXRuntime")

      // register the host
      let host = HostData.getLocalHostData(os)

      // running start before this is critical
      runtime.registerHost(host)
      // register process
      let pd: ProcessData = runtime.getLocalProcessData()
      pd.hostname = host.hostname
      runtime.registerProcess(pd)
      runtime.register(runtime)

      // load runtime config

      // url config
      // FIXME - need to appropriately switch https when asked
      this.serviceUrl = `http://localhost:${runtime.getConfig().port}`
      this.startUrl = process.env.ELECTRON_START_URL || "http://localhost:3001/"

      // app.commandLine.appendSwitch('headless')
      // app.disableHardwareAcceleration()

      if (!this.hasDisplay()) {
        log.info("No display detected, starting express only")
        // ExpressAdapter ???
      } else {
        log.info("Display detected, starting electron")
        const { default: electron } = await import(path.join(__dirname, "ElectronStarter")) // ElectronStarter.ts
        this.electron = electron
        this.electron.main()
        // ElectronMain.relaunch()
        // main.app = ElectronMain.relaunch xxx
      }

      // goint to try express only
    } catch (error) {
      log.error(`Main.run error: ${error}`)
    }
  }

  hasArg(arg: string): boolean {
    return this.args.includes(arg)
  }

  getArgValue(arg: string): string | null {
    const index = this.args.indexOf(arg)
    return index !== -1 && this.args[index + 1] ? this.args[index + 1] : null
  }

  public static getInstance(): Main {
    if (!Main.instance) {
      Main.instance = new Main()
      Main.instance.args = process.argv.slice(2)
      Main.instance.run()
    }
    return Main.instance
  }

  private printHelp(): void {
    const help = `
      Usage: node Main.js [options]

      Options:
        --id             Process ID
        --launch         Launch file
        --port           Port
        --help           Show help information

    `
    log.info(help)
    console.info(help)
  }

  // FIXME make conditional callbacks to electron
  setDebug(debug: boolean) {
    log.info(`Setting debug to ${debug}`)
  }

  public toJSON(): any {
    return {
      serviceUrl: this.serviceUrl,
      startUrl: this.startUrl,
      distRoot: this.distRoot,
      publicRoot: this.publicRoot
    }
  }
}

// Start an instance
const main = Main.getInstance()
