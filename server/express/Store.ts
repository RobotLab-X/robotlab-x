import bodyParser from "body-parser"
import cors from "cors"
import express from "express"
import http, { Server as HTTPServer } from "http"
// import open from "open"
import path from "path"
import { v4 as uuidv4 } from "uuid"
import { WebSocket, Server as WebSocketServer } from "ws"
import Main from "../electron/Main"
import { getLogger } from "../express/framework/Log"
import { CodecUtil } from "./framework/CodecUtil"
import Service from "./framework/Service"
import Gateway from "./interfaces/Gateway"
import Message from "./models/Message"
import RobotLabXRuntime from "./service/RobotLabXRuntime"

const session = require("express-session")
// const open = require('open'); ESM 6 ONLY !!!

const FileStore = require("session-file-store")(session)
const apiPrefix = "/api/v1/services"

const log = getLogger("Store")

type RegistryType = { [key: string]: Service }
type MessageType = { [key: string]: Message }

/**
 * The Store class is a singleton class that acts as a central store for the
 * application. It is used to store and retrieve data from the registry.
 * It also acts as a central point for the WebSocket server and the Express
 * server.
 *
 * This is effectively part of RobotLabXRuntime, but is separated out for
 * simplicity, clarity and serialization. This class is not serializable,
 * since it has references to sockets and other communication objects.
 *
 */
export default class Store {
  private static instance: Store

  private registry: RegistryType = {}

  private messages: MessageType = {}

  private express: express.Application

  private http: HTTPServer

  private wss: WebSocketServer

  private runtime: RobotLabXRuntime = null

  public static getInstance(): Store {
    if (!Store.instance) {
      Store.instance = new Store()
    }
    return Store.instance
  }

  // FIXME since express and wss are initialized here, need port passed in
  public static createInstance(runtime: RobotLabXRuntime): Store {
    if (!Store.instance) {
      Store.instance = new Store()
      Store.instance.runtime = runtime
      let store = Store.instance
      log.info("initializing store")
      store.express = express()
      store.http = http.createServer(store.express)
      store.wss = new WebSocketServer({ server: store.http })
      store.middleware()
      store.initWebSocketServer()

      // FIXME - this is dumb - RuntimeXServer should have config
      log.info(`setting port ${runtime.getConfig().port}`)
      store.express.set("port", runtime.getConfig().port)

      store.http.listen(runtime.getConfig().port)
      store.http.on("error", Store.onError)
      store.http.on("listening", Store.onListening)
    } else {
      console.error("store instance already exists")
    }
    return Store.instance
  }

  private static onError(error: NodeJS.ErrnoException): void {
    if (error.syscall !== "listen") {
      throw error
    }
    // const bind = typeof Store.port === "string" ? "Pipe " + Store.port : "Port " + Store.port
    switch (error.code) {
      case "EACCES":
        // tslint:disable-next-line:no-console
        console.error(`${Store.instance.runtime.getConfig().port} requires elevated privileges`)
        process.exit(1)
        break
      case "EADDRINUSE":
        // tslint:disable-next-line:no-console
        console.error(`${Store.instance.runtime.getConfig().port} is already in use`)
        process.exit(1)
        break
      default:
        throw error
    }
  }

  private static onListening(): void {
    const addr = Store.instance.http.address()
    if (addr === null) {
      console.error("Server listening address is null")
    } else {
      const bind = typeof addr === "string" ? `pipe ${addr}` : `port ${addr.port}`
      log.info(`listening on ${bind}`)

      // FIXME in ElectonStarter.ts normalize
      const url = process.env.ELECTRON_START_URL || "http://localhost:3001/"

      // Would use npm "open" package - but it is ESM 6 only !!!
      if (process.env.DISPLAY || process.platform.startsWith("win")) {
        try {
          const { exec } = require("child_process")

          let command

          if (process.platform === "win32") {
            command = `start ${url}`
          } else if (process.platform === "darwin") {
            command = `open ${url}`
          } else if (process.platform === "linux") {
            command = `xdg-open ${url}`
          }

          exec(command, (err: any) => {
            if (err) {
              console.error("Error opening the URL:", err)
            } else {
              console.log(`Opened ${url} in the default browser.`)
            }
          })

          // Opening URL if DISPLAY
          // open(url)
          //   .then(() => {
          //     log.info(`Opened ${url} in the default browser.`)
          //   })
          //   .catch((err: any) => {
          //     log.error("Error opening the URL:", err)
          //   })
        } catch (error) {
          console.error("Error importing child_process:", error)
        }
      }
    }
  }

  // Method to set a key-value pair in the registry
  public register(key: string, value: any): void {
    this.registry[key] = value
  }

  // FIXME !!! - should be unregister not release !
  public release(key: string): void {
    if (this.registry[key]) {
      delete this.registry[key]
    } else {
      log.error(`release key ${key} not found`)
    }
  }

  // Method to get a value by key from the registry
  public getRegistry(): any {
    return this.registry
  }

  public getService(key: string): any {
    return this.registry[key]
  }

  public getServiceNames(): any {
    return Object.keys(this.registry)
  }

  // FIXME !!! - should be unregister not release !
  // FIXME remove this method
  public releaseService(key: string): void {
    this.release(key)
  }

  // Run configuration methods on the Express instance.
  constructor() {
    log.info(`store initializing on node ${process.version}`)
  }

  /**
   * Accept "inbound" WebSocket connections
   */
  private initWebSocketServer() {
    const runtime = RobotLabXRuntime.getInstance()
    this.wss.on("connection", (ws, request) => {
      // Access the URL the client connected to
      const url = request.url
      log.info(`client connected at url: ${url}`)

      // Retrieve a specific query parameter (e.g., id)
      const urlParams = new URLSearchParams(url.split("?")[1]) // assuming your WS URL might contain query params
      let gatewayId: string = urlParams.get("id") // Assuming 'id' is passed as a query parameter
      const uuid = uuidv4()
      if (!gatewayId) {
        gatewayId = uuid
      }
      // FIXME - check for collisions
      // FIXME - Web UIs should have a single client id and an array of ws connections
      // unless the client id is associated with a "different" (non default) session
      // this.connectionImpl.set(gatewayId, ws)

      // FIXME - MAKE CONNECTION CLASS
      // ---> someone has connected to me (inbound connection)
      runtime.registerConnection(`runtime@${runtime.getId()}`, gatewayId, url, "inbound", ws)
      RobotLabXRuntime.getInstance().invoke("broadcastState")
      // onmessage - server
      ws.on("message", this.handleWsMessage(ws, gatewayId))

      ws.on("close", () => {
        runtime.warn(`connection ${gatewayId} closed`)
        // NOT REMOVING CONNECTION TO TEST FROM PYTHON SIDE
        // runtime.removeConnection(gatewayId)
        runtime.updateConnection(gatewayId, "disconnected")

        // update all services belonging to this id and connection
        runtime.getServiceNames().forEach((serviceName: string) => {
          const service = runtime.getService(serviceName)
          if (service?.id === gatewayId) {
            if (service.invoke) {
              service.invoke("onConnectionClosed")
            } else {
              log.error(`service ${serviceName} does not have an invoke method`)
            }
            // this removes all services associated with this connection id
            // RobotLabXRuntime.getInstance().removeConnection(gatewayId)
          }
        })
        RobotLabXRuntime.getInstance().setConnectionImpl(gatewayId, null)

        runtime.invoke("broadcastState")
      })

      ws.on("error", (error) => {
        log.error("WebSocket error:", error)
        runtime.error(`connection ${gatewayId} error`)
      })
    })
  }

  /**
   * Decode the message
   * @param ws
   */
  // FIXME switch gatewayId to connection uuid !!!!
  public handleWsMessage(ws: WebSocket, gatewayId: string) {
    return (message: any) => {
      try {
        const msg: Message = JSON.parse(message)
        // setting connection/client id on message
        // its one of two points
        msg.gatewayId = gatewayId
        msg.gateway = `runtime@${this.runtime.getId()}`
        // FIX - probably not need on every single msg
        // Dynamic Routing
        // get the originating msg id
        const remoteId = CodecUtil.getId(msg.sender)
        if (remoteId && remoteId !== this.runtime.getId()) {
          this.runtime.addRoute(remoteId, msg.gatewayId, msg.gateway)
        }

        if (!msg.name) {
          log.error(`no name in msg ${JSON.stringify(msg)}`)
        }

        const id = CodecUtil.getId(msg.name)
        if (!id) {
          log.error(`msg not fully addressed ${JSON.stringify(msg)}`)
        }

        // log.info(`--> ws ${JSON.stringify(msg)}`)
        // log.info(`--> ws ${msg.name} ${msg.method}`)
        this.handleMessage(msg)
      } catch (e) {
        // ui error - user should be informed
        console.error("parsing message error")
        console.error(e)
      }
    }
  }

  /**
   * FIXME FIXME FIXME - reduce this function to nothing, all business logic should be
   * in the Service class, including dynamic routing based on msg.gateway and msg.gatewayId
   * Handles all message processing - probably should be moved into Service
   * @param msg
   * @param gatewayId
   * @returns
   */
  public handleMessage(msg: Message) {
    try {
      // log.info(`--> handleMessage ${msg.name}.${msg.method}`)
      // can you relay without having that service in this registry ... "yes"
      let fullName = CodecUtil.getFullName(msg.name)
      const msgId = CodecUtil.getId(fullName)

      // Experimental - add messages to the store (similar to retained messages)
      let remoteKey = `${msg.sender}.${msg.method}`
      this.messages[remoteKey] = msg

      // MESSAGE FROM REMOTE NEEDS TO BE SENT OUT REMOTE
      // POTENTIALLY NO SERVICE DEFINED FOR THIS MESSAGE
      if (msgId !== this.runtime.getId()) {
        // we need to immediately send a remote message away, because the registry
        // won't have a real service to invokeMsg on it - chicken egg problem
        // fine the gateway for the message's remoteId
        let gateway: Gateway = this.runtime.getGateway(msgId)
        if (!gateway) {
          log.error(`NO GATEWAY for remoteId ${msgId}`)
          return null
        }

        // TODO - implement synchronous blocking
        let blockingObject = gateway.sendRemote(msg)
        return blockingObject
      }

      let service: Service = this.getService(fullName)

      if (!service) {
        RobotLabXRuntime.getInstance().error(`service ${fullName} not found`)
        return null
      }

      let ret: Object = service.invokeMsg(msg)

      return ret
    } catch (e) {
      // ui error - user should be informed
      console.error(e)
    }
    return null
  }

  public getMessages(): { [key: string]: Message } {
    return this.messages
  }

  // Configure Express middleware.
  private middleware(): void {
    // Uncomment if you want to use a logger
    // this.express.use(logger("dev"));

    // Session middleware
    this.express.use(
      session({
        store: new FileStore(), // options iApps optional
        secret: "your secret",
        resave: false,
        saveUninitialized: true,
        cookie: { secure: true }
      })
    )

    // CORS middleware
    this.express.use(cors())

    // Body parsers
    this.express.use(bodyParser.json())
    this.express.use(bodyParser.urlencoded({ extended: false }))

    // Static file serving
    const main = Main.getInstance()
    this.express.use("/public", express.static(main.publicRoot))
    this.express.use("/log", express.static(path.join(process.cwd(), "robotlab-x.log")))
    this.express.use("/static", express.static(path.join(main.distRoot, "client", "static")))
    this.express.use("/manifest.json", express.static(path.join(main.distRoot, "client", "manifest.json")))

    // TODO - REMOVE THIS !!! - this.express.use(`${apiPrefix}/*` should handle it
    this.express.use(`${apiPrefix}/runtime/register`, (req, res) => {
      log.info(req.body)
      const serviceData = req.body
      const runtime = RobotLabXRuntime.getInstance()
      runtime.register(serviceData)
      res.json(serviceData)
    })

    // TODO - REMOVE THIS !!! - this.express.use(`${apiPrefix}/*` should handle it
    this.express.use(`${apiPrefix}/runtime/registerType`, (req, res) => {
      log.info(req.body)
      const serviceDataType = req.body
      const runtime = RobotLabXRuntime.getInstance()
      runtime.registerType(serviceDataType)
      res.json(serviceDataType)
    })

    // TODO - make this handle all GET and POST
    // Make it convert all of them to messages
    // Implement blocking messages
    this.express.use(`${apiPrefix}/*`, (req, res) => {
      log.info(`--> incoming get ${req.originalUrl}`)
      const pathSegments = req.originalUrl.split("/").filter((segment) => segment.length > 0)
      if (pathSegments.length < 3) {
        res.json({
          error: `invalid path ${req.originalUrl} must follow pattern ${apiPrefix}/{serviceName}/{method}/"jsonParam1"/"jsonParam2"/...`
        })
        return
      }

      const runtime = RobotLabXRuntime.getInstance()

      // service name only - returns service
      if (pathSegments.length === 4) {
        // Return service
        const name = pathSegments[3]
        log.info(`getting service ${name}`)
        // const service = runtime.getService(name)
        // res.json(service)
        const msg = new Message(name, "broadcastState", null)
        const ret = this.handleMessage(msg)
        res.json(ret)

        return
      }

      // TODO - method query via http://localhost:3001/api/v1/services/runtime/
      // with the last parameter being a /

      // at least one parameter
      if (pathSegments.length > 4) {
        // Invoke method
        const name = pathSegments[3]
        const methodName = pathSegments[4]
        const service = runtime.getService(name)

        let params: any[] = []
        // Parameters supplied
        if (pathSegments.length > 5) {
          for (let i = 5; i < pathSegments.length; i++) {
            params.push(JSON.parse(decodeURIComponent(pathSegments[i])))
          }
        }

        // body has precedence over query params, if it exists
        if (req.body && Object.keys(req.body).length > 0) {
          params = req.body
        }

        const msg: Message = new Message(name, methodName, params)
        const ret = this.handleMessage(msg)
        log.info(`--> get ${req.originalUrl} return ${JSON.stringify(ret)}`)
        res.json(ret)
        return
      }

      log.info(`pathSegments ${pathSegments}`)
      res.json(runtime.getRegistry())
    })

    // Catch-all handler to serve index.html for client-side routing
    this.express.use((req, res, next) => {
      if (
        !req.originalUrl.startsWith(apiPrefix) &&
        !req.originalUrl.startsWith("/public") &&
        !req.originalUrl.startsWith("/log") &&
        !req.originalUrl.startsWith("/static") &&
        !req.originalUrl.startsWith("/manifest.json")
      ) {
        // res.sendFile(path.join(Main.distRoot, "client", "index.html"))

        // Serve the file based on the requested path
        res.sendFile(path.join(main.distRoot, "client", req.originalUrl), (err) => {
          if (err) {
            // If the file does not exist, serve index.html
            res.sendFile(path.join(main.distRoot, "client", "index.html"))
          }
        })
      } else {
        next()
      }
    })
  }
}
