import debug from "debug"
import Electron, { Tray } from "electron"
import os from "os"
import path from "path"
import "source-map-support/register"
import { getLogger } from "../express/framework/Log"
import { HostData } from "../express/models/HostData"
import { ProcessData } from "../express/models/ProcessData"
import RobotLabXRuntime from "../express/service/RobotLabXRuntime"
const { app } = require("electron")
const asar = require("asar")
const fs = require("fs-extra")
const minimist = require("minimist")

// require("electron-reload")(__dirname, {
//   electron: require(`${__dirname}/node_modules/electron`)
// })

const log = getLogger("ElectronStarter")

export default class Main {
  private static app: Electron.App
  private static BrowserWindow: typeof Electron.BrowserWindow
  public static mainWindow: Electron.BrowserWindow
  public static isPackaged: boolean = app.isPackaged
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

  // Tray instance
  public static tray: Tray

  public static main(electronApp: Electron.App, browserWindow: typeof Electron.BrowserWindow) {
    Main.BrowserWindow = browserWindow
    Main.app = electronApp
    Main.app.on("window-all-closed", Main.onWindowAllClosed)
    Main.app.on("ready", Main.onReady)
    Main.app.on("activate", Main.onActivate)
    Main.quitOnCloseOSX = true
    Main.bootServer()
  }

  private static onReady() {
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
    if (process.platform !== "darwin" || Main.quitOnCloseOSX) {
      Main.app.quit()
    }
  }

  private static onActivate() {
    if (Main.mainWindow === null) {
      Main.onReady()
    }
  }

  private static onClose() {
    // Dereference the window object.
    //  Main.mainWindow = null
  }

  private static bootServer() {
    log.info("bootServer: starting server")
    log.info(`bootServer: Main.isPackaged == ${Main.isPackaged}`)
    let asarPath = Main.isPackaged ? path.join(process.resourcesPath, "app.asar") : null
    Main.extractPath = path.join(app.getPath("userData"), "resources")
    log.info(`bootServer: Main.extractPath == ${Main.extractPath} ==`)
    log.info(`bootServer: __dirname == ${__dirname}`)
    log.info(`bootServer: asarPath == ${asarPath}`)
    log.info(`bootServer: process.cwd() == ${process.cwd()}`)

    if (asarPath && fs.existsSync(asarPath)) {
      // FIXME - make a flag based on major/minor version which replaces repo if changed
      // FIXME - this will throw if file exists, will not overwrite - need to resolve
      // Extract the asar file if it hasn't been extracted already
      if (!fs.existsSync(Main.extractPath)) {
        // fs.mkdirSync(Main.extractPath, { recursive: true })
        log.error(`bootServer: extracting asar ${asarPath} ... to ${Main.extractPath}`)
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

Main.main(Electron.app, Electron.BrowserWindow)
