import debug from "debug"
import Electron, { Tray } from "electron"
import os from "os"
import path from "path"
import "source-map-support/register"
import yaml from "yaml"
import { getLogFilePath, getLogger } from "../express/framework/Log"
import { HostData } from "../express/models/HostData"
import { ProcessData } from "../express/models/ProcessData"
import RobotLabXRuntime from "../express/service/RobotLabXRuntime"
const { app } = require("electron")
const asar = require("asar")
const fs = require("fs-extra")
const minimist = require("minimist")
const log = getLogger("ElectronStarter")

export default class Main {
  private static app: Electron.App
  private static BrowserWindow: typeof Electron.BrowserWindow
  public static mainWindow: Electron.BrowserWindow
  public static isPackaged: boolean
  // The root directory of the app in both development and production
  public static distRoot: string = null
  // The root directory of the express server in both development and production
  public static publicRoot: string = null
  // The root of the extracted asar file if it exists
  public static extractPath: string

  // Service API AND WS URL - in Prod this will be the same as startUrl
  // defaults:
  //
  // dev Main.serviceUrl = "http://localhost:3001"
  // dev Main.startUrl = "http://localhost:3000"
  //
  // prod Main.serviceUrl = "http://localhost:3000"
  // prod Main.startUrl = "http://localhost:3000"
  public static serviceUrl: string

  /**
   * BrowserWindow.loadURL() will use this URL to load the app
   */
  public static startUrl: string

  // if this variable is set to true in the main constructor, the app will quit when closing it in macOS
  private static quitOnCloseOSX: boolean

  protected static logFilePath: string

  // Tray instance
  public static tray: Tray

  protected static version: string

  protected static root: string

  public static main() {
    log.info("Main.main")
    Main.BrowserWindow = Electron.BrowserWindow
    // when running as a service the following line might need to change
    // assignment of Electron.app to Main.app - we should be done with direct Electron dependencies
    Main.app = Electron.app
    Main.isPackaged = app?.isPackaged

    Main.app.on("window-all-closed", Main.onWindowAllClosed)
    Main.app.on("ready", Main.onReady)
    Main.app.on("activate", Main.onActivate)
    Main.quitOnCloseOSX = true
    Main.bootServer()
  }

  public static isGraphicalEnvironmentAvailable(): boolean {
    return true // !!process.env.DISPLAY
  }

  private static onReady() {
    log.info("Main.onReady")
    if (!Main.isGraphicalEnvironmentAvailable()) {
      log.error("Graphical environment not available ... running headless")
      return
    }

    log.info(`onReady: Main.publicRoot ${Main.publicRoot}`)
    Main.mainWindow = new Main.BrowserWindow({
      width: 800,
      height: 600,
      icon: path.join(Main.publicRoot, "repo", "robotlab-x-48.png"),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "Preload.js")
      }
    })
    // Set in Store.ts !!!! not here
    Main.startUrl = process.env.ELECTRON_START_URL || "http://localhost:3001/"
    // FIXME - startUrl is not correct when packaged
    log.info(`onReady: Main.startUrl == ${Main.startUrl}`)
    Main.mainWindow.loadURL(Main.startUrl)
    if (!Main.isPackaged) {
      Main.mainWindow.webContents.openDevTools()
    }

    Main.mainWindow.on("closed", Main.onClose)

    // Create the Tray instance and set the tooltip
    Main.tray = new Tray(path.join(Main.publicRoot, "repo", "robotlab-x-48.png"))
    Main.tray.setToolTip("RobotLab-X")
  }

  private static onWindowAllClosed() {
    log.info("Main.onWindowAllClosed")
    if (process.platform !== "darwin" || Main.quitOnCloseOSX) {
      Main.app.quit()
    }
  }

  private static onActivate() {
    log.info("Main.onActivate")
    if (Main.mainWindow === null) {
      Main.onReady()
    }
  }

  private static onClose() {
    log.info("Main.onClose")
    // Dereference the window object.
    //  Main.mainWindow = null
  }

  public static bootServer() {
    // getPath(name: 'home' | 'appData' | 'userData' | 'sessionData' | 'temp' | 'exe' | 'module' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos' | 'recent' | 'logs' | 'crashDumps')

    // if env var or cmdline param CUSTOM_USER_DATA_DIR use that otherwise
    // root of all is cwd - if "dev/!isPackaged" then cwd is the dist directory
    Main.root = process.env.ROOT_DIR || process.cwd()
    Main.app.setPath("appData", Main.root)
    Main.app.setPath("userData", Main.root)
    Main.app.setPath("sessionData", Main.root)
    Main.app.setPath("logs", Main.root)
    Main.app.setPath("temp", path.join(Main.root, "tmp"))
    Main.app.setPath("tmp", path.join(Main.root, "tmp"))
    Main.app.setPath("crashDumps", Main.root)

    log.info(`bootServer: root: ${Main.root}`)

    log.info("bootServer: starting server")
    Main.app.setAppLogsPath
    log.info(`bootServer: appData: ${Main.app.getPath("appData")}`)
    Main.app.setPath("userData", path.join(Main.app.getPath("appData"), "robotlab-x"))
    log.info(`bootServer: userData: ${Main.app.getPath("userData")}`)

    // Main.app.setPath("userData", path.join(app.getPath("appData"), "robotlab-x"))

    Main.logFilePath = getLogFilePath()

    // TODO - determine if we are running as a Node.js process or an Electron process
    // set static variables based on the process type
    // if Node.js process, then we need to extract asar and start the server
    log.info(`bootServer: Main.isPackaged == ${Main.isPackaged}`)
    log.info(`bootServer: __dirname == ${__dirname}`)
    log.info(`bootServer: app.getPath("userData") == ${Main.app.getPath("userData")}`)

    let asarPath = Main.isPackaged ? path.join(process.resourcesPath, "app.asar") : null
    Main.extractPath = path.join(Main.app.getPath("userData"), "resources")

    log.info(`bootServer: Main.extractPath == ${Main.extractPath} ==`)
    log.info(`bootServer: asarPath == ${asarPath}`)

    // set our version from __dirname (dev mode or asar) - SHOULD EXIST IN ANY CONTEXT !!!
    const runningRobotLabXRuntimeYmlFilename = path.join(
      __dirname,
      "..",
      "express",
      "public",
      "repo",
      "robotlabxruntime",
      "package.yml"
    )

    if (fs.existsSync(runningRobotLabXRuntimeYmlFilename)) {
      Main.version = yaml.parse(fs.readFileSync(runningRobotLabXRuntimeYmlFilename, "utf8"))?.version
    }

    log.info(`bootServer: version ${Main.version}`)

    // check if existing resource versino exists
    let existingVersion = null

    // In theory the ts/js files would be replaced by the setup
    // but anything in userData is not replaced, however the dist/resources we will need to manage
    // asar extract is not forceful and will die silently if already extracted

    // if a previous version exists, move the resources to resources.{version}
    // extract the new resources

    if (Main.isPackaged && fs.existsSync(asarPath)) {
      // FIXME - make a flag based on major/minor version which replaces repo if changed
      // FIXME - this will throw if file exists, will not overwrite - need to resolve
      // Extract the asar file if it hasn't been extracted already

      // determine if we need to move the previous resources
      const robotlabxruntimePkgFilename = path.join(
        Main.extractPath,
        "dist",
        "express",
        "public",
        "repo",
        "robotlabxruntime",
        "package.yml"
      )
      if (fs.existsSync(robotlabxruntimePkgFilename)) {
        log.info(`bootServer: found robotlabxruntime package.yml`)
        const robotlabxruntimePkg = yaml.parse(fs.readFileSync(robotlabxruntimePkgFilename, "utf8"))
        existingVersion = robotlabxruntimePkg.version
        log.info(`bootServer: existingVersion ${existingVersion}`)
      } else {
        log.info(`bootServer: no ${runningRobotLabXRuntimeYmlFilename} found`)
      }

      if (existingVersion && existingVersion !== Main.version) {
        // move existing resources to resources.{existingVersion}

        // const resourcesDirVersion = path.join(resourcesDir, existingVersion)
        if (fs.existsSync(Main.extractPath)) {
          const prevVersionResources = `${Main.extractPath}-${existingVersion}`
          log.info(`bootServer: moving previous existing resources to ${prevVersionResources}`)
          fs.renameSync(Main.extractPath, prevVersionResources)
        }
      } else {
        log.info(
          `bootServer: existing version ${existingVersion} is null or matches current version ${Main.version} not moving resources`
        )
      }

      // get internal asar version of RobotLabXRuntime
      const serviceDir = path.join(__dirname, "..", "service")

      if (!fs.existsSync(Main.extractPath)) {
        // fs.mkdirSync(Main.extractPath, { recursive: true })
        log.info(`bootServer: extracting asar ${asarPath} ... to ${Main.extractPath}`)
        asar.extractAll(asarPath, Main.extractPath)
      }
      Main.distRoot = path.join(Main.extractPath, "dist")
      Main.publicRoot = path.join(Main.distRoot, "express/public")
    } else {
      //
      Main.distRoot = path.join(process.cwd(), "dist")
      // not in dist - because we want "live" files in git
      Main.publicRoot = path.join(process.cwd(), "express/public")
      // Main.publicRoot = path.join(Main.distRoot, "express/public")
    }

    // probably absolute file path asap

    log.info(`bootServer: Main.distRoot ==== ${Main.distRoot} ====`)
    log.info(`bootServer: Main.publicRoot == ${Main.publicRoot}`)

    const argv = minimist(process.argv.slice(2))
    log.info(`bootServer: argv: ${JSON.stringify(argv)}`)

    if (Main.isPackaged) {
      debug.enable("server")
    }

    let launchFile = argv.config ? argv.config : "default"
    // must create instance before startServiceType to fix chicken egg problem
    let runtime: RobotLabXRuntime = RobotLabXRuntime.createInstance(launchFile)

    // Store needs getId/id to be set

    // starting self .. chicken egg problem
    // but starting self is a good way to have runtime follow the same processes
    // as other services and have a consistent lifecycle
    // runtime.startService()
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
  }

  public static toJSON(): any {
    return {
      serviceUrl: Main.serviceUrl,
      startUrl: Main.startUrl,
      isPackaged: Main.isPackaged,
      distRoot: Main.distRoot,
      publicRoot: Main.publicRoot,
      extractPath: Main.extractPath
    }
  }
} // Main

if (process.env.ELECTRON_RUN_AS_NODE) {
  Main.bootServer()
} else {
  Main.main()
}
