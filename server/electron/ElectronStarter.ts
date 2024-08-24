import Electron, { Menu, shell, Tray } from "electron"
import path from "path"
import "source-map-support/register"
import { getLogger } from "../express/framework/LocalLog"
import Main from "./Main"

const { app, ipcMain } = require("electron")
const asar = require("asar")
const fs = require("fs-extra")
const minimist = require("minimist")
const log = getLogger("ElectronStarter")
const { exec } = require("child_process")

export default class ElectronStarter {
  // FIXME ! - all these statics are a bad idea

  private static app: Electron.App
  private static BrowserWindow: typeof Electron.BrowserWindow
  public static mainWindow: Electron.BrowserWindow
  public static hiddenWindow: Electron.BrowserWindow

  // Tray instance
  public static tray: Tray

  public static main() {
    log.info("ElectronStarter.main")
    ElectronStarter.BrowserWindow = Electron.BrowserWindow
    // when running as a service the following line might need to change
    // assignment of Electron.app to ElectronStarter.app - we should be done with direct Electron dependencies
    ElectronStarter.app = Electron.app
    ElectronStarter.app.on("window-all-closed", ElectronStarter.onWindowAllClosed)
    ElectronStarter.app.on("ready", ElectronStarter.onReady)
    ElectronStarter.app.on("activate", ElectronStarter.onActivate)
    ElectronStarter.bootServer()
  }

  public static createMenu = () => {
    const template: (Electron.MenuItemConstructorOptions | Electron.MenuItem)[] = [
      {
        label: "File",
        submenu: [{ role: "quit" }]
      },
      /*
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" }
        ]
      },
      */
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "forceReload" }, // Corrected from "forcereload"
          { role: "toggleDevTools" }, // Corrected from "toggledevtools"
          { type: "separator" },
          { role: "resetZoom" }, // Corrected from "resetzoom"
          { role: "zoomIn" }, // Corrected from "zoomin"
          { role: "zoomOut" }, // Corrected from "zoomout"
          { type: "separator" },
          { role: "togglefullscreen" }
        ]
      },
      {
        label: "Window",
        submenu: [{ role: "minimize" }, { role: "close" }]
      },
      {
        label: "Help",
        submenu: [
          {
            label: "Learn about RobotLab-X",
            click: async () => {
              // No Subscription required
              await shell.openExternal("https://www.patreon.com/RobotLabX/posts")
            }
          },
          {
            label: "RobotLab-X Community",
            click: async () => {
              // No Subscription required
              await shell.openExternal("https://discord.gg/FJnM4GNb")
            }
          },
          {
            label: "RobotLab-X Tutorials",
            click: async () => {
              // Subscription required
              await shell.openExternal("https://www.patreon.com/RobotLabX/posts")
            }
          },
          {
            label: "Send a No Worky (Bug Report)",
            click: async () => {
              // Subscription required - send No Worky ! - implement !
              // await shell.openExternal("https://github.com/electron/electron/issues")
              await shell.openExternal("https://discord.gg/5kuwceeS")
            }
          }
        ]
      }
    ]

    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
  }

  // FIXME restart with same cmd line args
  public static relaunch() {
    setTimeout(() => {
      app.relaunch()
      app.quit()
    }, 2000) // 2-second delay
  }

  private static onReady() {
    log.info("ElectronStarter.onReady")
    if (!Main.getInstance().hasDisplay()) {
      log.error("Graphical environment not available ... running headless")
      return
    }

    const main = Main.getInstance()

    ElectronStarter.createMenu()

    log.info(`onReady: ElectronStarter.publicRoot ${main.publicRoot}`)
    ElectronStarter.mainWindow = new ElectronStarter.BrowserWindow({
      width: 800,
      height: 600,
      icon: path.join(main.publicRoot, "repo", "robotlab-x-48.png"),
      webPreferences: {
        // nodeIntegration: false,
        // contextIsolation: true,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: false,
        preload: path.join(__dirname, "Preload.js")
      }
    })
    // FIXME - Set in Store.ts !!!! not here
    // FIXME - startUrl is not correct when packaged
    log.info(`onReady: loadURL ${main.startUrl}`)
    ElectronStarter.mainWindow.loadURL(main.startUrl)
    ElectronStarter.mainWindow.on("closed", ElectronStarter.onClose)

    // Create the Tray instance and set the tooltip
    ElectronStarter.tray = new Tray(path.join(main.publicRoot, "repo", "robotlab-x-48.png"))
    ElectronStarter.tray.setToolTip("RobotLab-X")

    // Create the hidden window
    ElectronStarter.hiddenWindow = new ElectronStarter.BrowserWindow({
      show: false,
      webPreferences: {
        webSecurity: false,
        preload: path.join(__dirname, "Preload.js")
      }
    })

    // ElectronStarter.hiddenWindow.loadURL(`${ElectronStarter.startUrl}/hidden.html`)
    ElectronStarter.hiddenWindow.loadFile(path.join(__dirname, "hidden.html"))
    // ElectronStarter.hiddenWindow.webContents.openDevTools({ mode: "detach" })

    // IPC handlers from renderers --to--> main process
    ipcMain.on("play-sound", (event, audioFilePath) => {
      console.log("Received play-sound in main process:", audioFilePath)
      // const audioFilePath = path.resolve(process.cwd(), arg)
      console.log("Resolved audio file path:", audioFilePath)
      // relayed to hidden renderer
      ElectronStarter.hiddenWindow.webContents.send("play-sound", audioFilePath)
    })

    ipcMain.on("get-versions", (event) => {
      event.returnValue = {
        chrome: process.versions.chrome,
        node: process.versions.node,
        electron: process.versions.electron,
        appVersion: main.pkg?.version
      }
    })

    // ipcMain.on("play-audio", (event, filePath) => {
    //   const audioPath = path.resolve(filePath)
    //   exec(`start "" "${audioPath}"`, (error: any) => {
    //     if (error) {
    //       console.error(`Error playing audio: ${error.message}`)
    //     }
    //   })
    // })

    // ipcMain.on("get-audio-path", (event, filePath) => {
    //   const audioPath = path.resolve(filePath)
    //   event.returnValue = audioPath
    // })
  }

  private static onWindowAllClosed() {
    log.info("ElectronStarter.onWindowAllClosed")
    ElectronStarter.app?.quit()
  }

  private static onActivate() {
    log.info("ElectronStarter.onActivate")
    if (ElectronStarter.mainWindow === null) {
      ElectronStarter.onReady()
    }
  }

  private static onClose() {
    log.info("ElectronStarter.onClose")
    // Dereference the window object.
    //  ElectronStarter.mainWindow = null
    if (ElectronStarter.hiddenWindow && !ElectronStarter.hiddenWindow.isDestroyed()) {
      ElectronStarter.hiddenWindow.close()
    }
  }

  public static bootServer() {
    // Electron's path names
    // getPath(name: 'home' | 'appData' | 'userData' | 'sessionData' | 'temp' | 'exe' | 'module' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos' | 'recent' | 'logs' | 'crashDumps')

    const main = Main.getInstance()

    log.info(`bootServer: appData: ${main.appData}`)

    ElectronStarter.app?.setPath("appData", main.appData)
    ElectronStarter.app?.setPath("userData", main.appData)
    ElectronStarter.app?.setPath("sessionData", main.appData)
    ElectronStarter.app?.setPath("logs", main.appData)
    ElectronStarter.app?.setPath("temp", path.join(main.appData, "tmp"))
    ElectronStarter.app?.setPath("crashDumps", main.appData)

    log.info(`Electron: appData: ${ElectronStarter.app?.getPath("appData")}`)
    if (ElectronStarter.app) {
      ElectronStarter.app?.setPath("userData", path.join(ElectronStarter.app?.getPath("appData"), "robotlab-x"))
    }
    log.info(`Electron: userData: ${ElectronStarter.app?.getPath("userData")}`)
  }

  public static toJSON(): any {
    const main = Main.getInstance()
    return main.toJSON()
  }
} // ElectronStarter
