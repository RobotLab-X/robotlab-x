import debug from "debug"
import Electron from "electron"
import "module-alias/register"
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
  public static expressRoot: string = null
  // The root of the extracted asar file if it exists
  public static extractPath: string

  // if this variable is set to true in the main constructor, the app will quit when closing it in macOS
  private static quitOnCloseOSX: boolean

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
    Main.mainWindow = new Main.BrowserWindow({
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "Preload.js")
      }
    })
    // const startUrl = process.env.ELECTRON_START_URL || `file://${path.join(__dirname, "../client/index.html")}`
    const startUrl = process.env.ELECTRON_START_URL || "http://localhost:3001/"
    // FIXME - startUrl is not correct when packaged
    log.info(`onReady: startUrl == ${startUrl}`)
    Main.mainWindow.loadURL(startUrl)
    if (!Main.isPackaged) {
      Main.mainWindow.webContents.openDevTools()
    }

    Main.mainWindow.on("closed", Main.onClose)
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
    } else {
      Main.distRoot = path.join(process.cwd())
    }

    log.info(`bootServer: Main.distRoot ==== ${Main.distRoot} ====`)
    Main.expressRoot = path.join(Main.distRoot, "express/public")
    log.info(`bootServer: Main.expressRoot == ${Main.expressRoot}`)

    const argv = minimist(process.argv.slice(2))
    log.info(`bootServer: argv: ${JSON.stringify(argv)}`)

    if (Main.isPackaged) {
      debug.enable("server")
    }

    let configName = argv.config ? argv.config : "default"
    // must create instance before startServiceType to fix chicken egg problem
    let runtime: RobotLabXRuntime = RobotLabXRuntime.createInstance("./config", configName)
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
}

Main.main(Electron.app, Electron.BrowserWindow)
