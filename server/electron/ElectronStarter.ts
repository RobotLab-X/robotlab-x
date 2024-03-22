import debug from "debug"
import Electron from "electron"
import path from "path"

import App from "../express/App"

// require("electron-reload")(__dirname, {
//   electron: require(`${__dirname}/node_modules/electron`)
// })

let logger: debug.Debugger

export default class Main {
  private static app: Electron.App
  private static BrowserWindow: typeof Electron.BrowserWindow
  private static mainWindow: Electron.BrowserWindow
  private static port: string | number | boolean

  // if this variable is set to true in the main constructor, the app will quit when closing it in macOS
  private static quitOnCloseOSX: boolean

  public static main(
    electronApp: Electron.App,
    browserWindow: typeof Electron.BrowserWindow
  ) {
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
    const startUrl =
      process.env.ELECTRON_START_URL ||
      `file://${path.join(__dirname, "../client/index.html")}`
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
    Main.mainWindow = null
  }

  private static bootServer() {
    // logger
    logger = debug("server")
    logger.log = console.log.bind(console)

    // if (isDev) {
    debug.enable("server")
    // }

    Main.port = Main.normalizePort(process.env.PORT || 3001)
    App.express.set("port", Main.port)

    // Main.server = http.createServer(App)
    App.http.listen(Main.port)
    App.http.on("error", Main.onError)
    App.http.on("listening", Main.onListening)
  }

  private static normalizePort(
    val: number | string
  ): number | string | boolean {
    const port: number = typeof val === "string" ? parseInt(val, 10) : val
    if (isNaN(port)) {
      return val
    } else if (port >= 0) {
      return port
    } else {
      return false
    }
  }

  private static onError(error: NodeJS.ErrnoException): void {
    if (error.syscall !== "listen") {
      throw error
    }
    const bind =
      typeof Main.port === "string" ? "Pipe " + Main.port : "Port " + Main.port
    switch (error.code) {
      case "EACCES":
        // tslint:disable-next-line:no-console
        console.error(`${bind} requires elevated privileges`)
        process.exit(1)
        break
      case "EADDRINUSE":
        // tslint:disable-next-line:no-console
        console.error(`${bind} is already in use`)
        process.exit(1)
        break
      default:
        throw error
    }
  }

  private static onListening(): void {
    const addr = App.http.address()
    const bind = typeof addr === "string" ? `pipe ${addr}` : `port ${addr.port}`
    logger.log(`Listening on ${bind}`)
  }
}

Main.main(Electron.app, Electron.BrowserWindow)
