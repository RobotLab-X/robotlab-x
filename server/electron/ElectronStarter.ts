import debug from "debug"
import Electron from "electron"
import "module-alias/register"
import os from "os"
import path from "path"
import "source-map-support/register"
import Store from "../express/Store"
import NameGenerator from "../express/framework/NameGenerator"
import { HostData } from "../express/models/HostData"
import { ProcessData } from "../express/models/ProcessData"
import RobotLabXRuntime from "../express/service/RobotLabXRuntime"

// require("electron-reload")(__dirname, {
//   electron: require(`${__dirname}/node_modules/electron`)
// })

let logger: debug.Debugger

export default class Main {
  private static app: Electron.App
  private static BrowserWindow: typeof Electron.BrowserWindow
  private static mainWindow: Electron.BrowserWindow
  private static port: string | number | boolean
  private static store: Store

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
    const startUrl = process.env.ELECTRON_START_URL || `file://${path.join(__dirname, "../client/index.html")}`
    Main.mainWindow.loadURL(startUrl)

    // development
    //        if (isDev) {
    Main.mainWindow.webContents.openDevTools()
    //         }

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
    // logger
    logger = debug("server")
    logger.log = console.log.bind(console)

    // if (isDev) {
    debug.enable("server")
    // }

    // FIXME - do this in RobotLabXRuntime
    Main.store = Store.createInstance()

    // TODO - allow id to be passed in or configured
    let runtime: RobotLabXRuntime = RobotLabXRuntime.createInstance(NameGenerator.getName(), os.hostname())

    // FIXME - do the following in RobotLabXRuntime

    // register the host
    let host = HostData.getLocalHostData(os)

    // register process
    let pd: ProcessData = runtime.getLocalProcessData()
    pd.host = host.hostname

    runtime.registerHost(host)
    runtime.registerProcess(pd)
    runtime.register(runtime)
  }
}

Main.main(Electron.app, Electron.BrowserWindow)
