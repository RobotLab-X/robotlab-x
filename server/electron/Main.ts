import asar from "asar"
import fs from "fs"
import minimist from "minimist"
import os from "os"
import path from "path"
import yaml from "yaml"
import { getLogFilePath, getLogger } from "../express/framework/Log"
import { HostData } from "../express/models/HostData"
import { ProcessData } from "../express/models/ProcessData"
import RobotLabXRuntime from "../express/service/RobotLabXRuntime"

const log = getLogger("Main")

export default class Main {
  static instance: Main

  args: string[]

  // top of the tree
  root: string

  // electron's appData directory
  appData: string

  // user data directory separation from appData vs userData
  userData: string

  // if app is running from app.asar mount
  isPackaged: boolean

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
      return true
    }
    return false
  }

  async run(): Promise<void> {
    try {
      // add version info
      log.info(`Starting RobotLab-X...`)
      log.info(`Node.js Version: ${process.version}`)
      log.info(`CWD: ${process.cwd()}`)
      log.info(`PID: ${process.pid}`)
      log.info(`OS Type: ${os.type()}`)
      log.info(`Platform: ${os.platform()}`)
      log.info(`Architecture: ${os.arch()}`)
      log.info(`Hostname: ${os.hostname()}`)
      log.info(`Release: ${os.release()}`)
      log.info(`Uptime: ${os.uptime()} seconds`)
      log.info(`Total Memory: ${(os.totalmem() / 1024 ** 3).toFixed(2)} GB`)
      log.info(`Free Memory: ${(os.freemem() / 1024 ** 3).toFixed(2)} GB`)
      log.info(`CPUs: ${os.cpus().length}`)
      // log.info("Environment Variables:")
      // log.info(JSON.stringify(process.env))

      log.info(`__dirname: ${__dirname}`)

      // check if running from an asar file mount
      this.isPackaged = __dirname.includes("app.asar")
      log.info(`isPackaged: ${this.isPackaged}`)

      // if prod everything is in cwd in dev everything is in cwd/dist to keep it clean
      // this.root = process.env.ROOT_DIR || (this.isPackaged ? process.cwd() : path.join(process.cwd(), "dist"))
      this.root = process.env.ROOT_DIR || process.cwd()
      log.info(`root: ${this.root}`)

      this.appData = path.join(this.root, "appData")
      log.info(`appData: ${this.appData}`)

      this.userData = path.join(this.root, "robotlab-x")
      log.info(`userData: ${this.userData}`)

      if (this.isPackaged) {
        // i think electron-builder compresses all data in this path in the asar file
        this.distRoot = path.join(this.userData, "dist")
      } else {
        // in dev we don't have an extracted resources directory
        this.distRoot = path.join(this.root, "dist")
      }

      log.info(`distRoot: ${this.distRoot}`)

      // publicRoot is the path to the public directory - either the dist/express/public (prod) or the express/public (dev)
      this.publicRoot = this.isPackaged
        ? path.join(this.distRoot, "express", "public")
        : path.join(process.cwd(), "express", "public")
      log.info(`publicRoot: ${this.publicRoot}`)

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

      // extract if necessary
      const asarPath = this.isPackaged ? path.join(process.resourcesPath, "app.asar") : null

      if (asarPath) {
        const extractPath = this.userData
        // Extract the asar file if it hasn't been extracted already
        if (!fs.existsSync(extractPath)) {
          log.info(`extracting asar ${asarPath} ... to ${extractPath}`)
          asar.extractAll(asarPath, extractPath)
        }
      }

      // root distRoot and publicRoot
      if (this.hasArg("--help")) {
        this.printHelp()
        return
      }

      const argv = minimist(process.argv.slice(2))
      log.info(`bootServer: argv: ${JSON.stringify(argv)}`)

      // start RobotLabXRuntime
      let launchFile = argv.config ? argv.config : "default"
      // must create instance before startServiceType to fix chicken egg problem
      let runtime: RobotLabXRuntime = RobotLabXRuntime.createInstance(launchFile)

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

      // start electron or express or both

      // no electron if headless

      // load runtime config

      // url config
      // FIXME - need to appropriately switch https when asked
      this.serviceUrl = `http://localhost:${runtime.getConfig().port}`
      this.startUrl = process.env.ELECTRON_START_URL || "http://localhost:3001/"

      // app.commandLine.appendSwitch('headless')
      // app.disableHardwareAcceleration()

      // if (!this.hasDisplay()) {
      //   log.info("No display detected, starting express only")
      //   // ExpressAdapter ???
      // } else {
      //   log.info("Display detected, starting electron")
      //   const { default: ElectronMain } = await import(path.join(__dirname, "ElectronStarter")) // ElectronStarter.ts
      //   ElectronMain.main()
      // }

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
    if (debug) {
      this.electron?.mainWindow.webContents.openDevTools()
      this.electron?.hiddenWindow.webContents.openDevTools({ mode: "detach" })
    } else {
      this.electron?.mainWindow.webContents.closeDevTools()
      this.electron?.hiddenWindow.webContents.closeDevTools()
    }
  }

  public toJSON(): any {
    return {
      serviceUrl: this.serviceUrl,
      startUrl: this.startUrl,
      isPackaged: this.isPackaged,
      distRoot: this.distRoot,
      publicRoot: this.publicRoot
    }
  }
}

// Start an instance
const main = Main.getInstance()
