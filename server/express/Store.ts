import bodyParser from "body-parser"
import cors from "cors"
import express from "express"
import http, { Server as HTTPServer } from "http"
import path from "path"
import { WebSocket, Server as WebSocketServer } from "ws"
import { CodecUtil } from "./framework/CodecUtil"
import Message from "./models/Message"
import RobotLabXRuntime from "./service/RobotLabXRuntime"

const session = require("express-session")
const FileStore = require("session-file-store")(session)
const apiPrefix = "/api/v1/services"

type RegistryType = { [key: string]: any }

/**
 * The Store class is a singleton class that acts as a central store for the
 * application. It is used to store and retrieve data from the registry.
 * It also acts as a central point for the WebSocket server and the Express
 * server.
 */
export default class Store {
  private static instance: Store

  // FIXME - remove
  private static port: string | number | boolean

  private registry: RegistryType = {}

  private express: express.Application

  private http: HTTPServer

  private wss: WebSocketServer

  private clients: Set<WebSocket>

  public static getInstance(): Store {
    if (!Store.instance) {
      Store.instance = new Store()
    }
    return Store.instance
  }

  // FIXME since express and wss are initialized here, need port passed in
  public static createInstance(): Store {
    if (!Store.instance) {
      Store.instance = new Store()
      let store = Store.instance
      console.info("initializing store")
      store.express = express()
      store.http = http.createServer(store.express)
      store.wss = new WebSocketServer({ server: store.http })
      store.clients = new Set()
      store.middleware()
      store.routes()
      store.initWebSocketServer()

      // FIXME - this is dumb - RuntimeXServer should have config
      Store.port = Store.normalizePort(process.env.PORT || "3001")
      store.express.set("port", Store.port)
      store.http.listen(Store.port)
      store.http.on("error", Store.onError)
      store.http.on("listening", Store.onListening)
    } else {
      console.error("Store instance already exists")
    }
    return Store.instance
  }

  private static onError(error: NodeJS.ErrnoException): void {
    if (error.syscall !== "listen") {
      throw error
    }
    const bind = typeof Store.port === "string" ? "Pipe " + Store.port : "Port " + Store.port
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
    const addr = Store.instance.http.address()
    if (addr === null) {
      console.error("Server listening address is null")
    } else {
      const bind = typeof addr === "string" ? `pipe ${addr}` : `port ${addr.port}`
      console.info(`Listening on ${bind}`)
    }
  }

  private static normalizePort(val: number | string): number | string | boolean {
    const port: number = typeof val === "string" ? parseInt(val, 10) : val
    if (isNaN(port)) {
      return val
    } else if (port >= 0) {
      return port
    } else {
      return false
    }
  }

  // Method to set a key-value pair in the registry
  public register(key: string, value: any): void {
    this.registry[key] = value
  }

  // Method to get a value by key from the registry
  public getRegistry(): any {
    return this.registry
  }

  public getService(key: string): any {
    console.info(`Store.getService service ${key}`)
    return this.registry[key]
  }

  // Run configuration methods on the Express instance.
  constructor() {
    console.info(`store initializing on node ${process.version}`)
  }

  private initWebSocketServer() {
    this.wss.on("connection", (ws) => {
      console.log("A client connected")

      this.clients.add(ws)

      ws.on("message", this.handleWsMessage(ws))

      ws.on("close", () => {
        console.log("Connection closed")
      })

      ws.on("error", (error) => {
        console.error("WebSocket error:", error)
        this.clients.delete(ws)
      })
    })
  }

  public broadcastJsonMessage(message: string): void {
    // Iterate over the set of clients and send the message to each
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message)
      }
    })
  }

  public broadcast(message: Message): void {
    let json = JSON.stringify(message)
    this.broadcastJsonMessage(json)
  }

  /**
   * Decode the message
   * @param ws
   */
  private handleWsMessage(ws: WebSocket) {
    return (message: any) => {
      try {
        this.handleMessage(JSON.parse(message))
      } catch (e) {
        // ui error - user should be informed
        console.error("parsing message error")
        console.error(e)
      }
    }
  }

  /**
   * Handles all message processing
   * @param msg
   * @returns
   */
  private handleMessage(msg: Message) {
    try {
      if (msg.data) {
        console.info(`${msg.sender} ==> ${msg.name}.${msg.method}(${msg.data})`)
      } else {
        console.info(`${msg.sender} ==> ${msg.name}.${msg.method}()`)
      }

      // fully address name
      let fullName = CodecUtil.getFullName(msg.name)
      console.info(`full name ${fullName}`)

      // find service in registry
      let service = this.getService(fullName)

      if (service === null) {
        // ui error - user should be informed
        console.error(`service ${fullName} not found`)
        return
      }

      if (msg.method === null || service[msg.method] === null) {
        // ui error - user should be informed
        console.error(`method ${msg.method} not found`)
        return
      }

      // execute method with parameters on service
      // TODO - should be done in a service.invoke(msg) method so that subscriptions
      // can be processed
      let ret: Object = service.invokeOn(false, service, msg.method, msg.data)

      // if (msg.data) {
      //   ret = service[msg.method](msg.data)
      // } else {
      //   ret = service[msg.method]()
      // }
      console.info(`return ${JSON.stringify(ret)}`)

      return ret

      //

      // Example of sending a message back to the client
      // ws.send(`Server received: ${message}`);
    } catch (e) {
      // ui error - user should be informed
      console.error(e)
    }
    return null
  }

  // Configure Express middleware.
  private middleware(): void {
    // this.express.use(logger("dev"));

    this.express.use(
      session({
        store: new FileStore(), // options iApps optional
        secret: "your secret",
        resave: false,
        saveUninitialized: true,
        cookie: { secure: true }
      })
    )

    this.express.use(cors())
    this.express.use("/images", express.static(path.join(__dirname, "public/images")))
    this.express.use("/repo", express.static(path.join(__dirname, "public/repo")))
    this.express.use(bodyParser.json())
    this.express.use(bodyParser.urlencoded({ extended: false }))
  }

  // Configure API endpoints.
  private routes(): void {
    /* This is just to get up and running, and to make sure what we've got is
     * working so far. This function will change when we start to add more
     * API endpoints */
    const router = express.Router()

    router.put(`${apiPrefix}/*`, (req, res, next) => {
      console.log(`--> put ${req.originalUrl} ${JSON.stringify(req.body)}`)
      const serviceData = req.body

      const pathSegments = req.originalUrl.split("/").filter((segment) => segment.length > 0)
      if (pathSegments.length != 5) {
        res.json({
          error: `invalid path ${req.originalUrl} must follow pattern ${apiPrefix}/{serviceName}/{method}`
        })
        return
      }

      const runtime = RobotLabXRuntime.getInstance()
      const name = pathSegments[3]
      const methodName = pathSegments[4]
      const service = runtime.getService(name)

      const ret = service.invokeOn(false, service, methodName, ...serviceData)

      res.json(serviceData)
    })

    router.put(`${apiPrefix}/runtime/register`, (req, res, next) => {
      console.log(req.body)
      const serviceData = req.body
      let runtime = RobotLabXRuntime.getInstance()
      runtime.register(serviceData)
      res.json(serviceData)
    })

    router.put(`${apiPrefix}/runtime/registerType`, (req, res, next) => {
      console.log(req.body)
      const serviceDataType = req.body
      let runtime = RobotLabXRuntime.getInstance()
      runtime.registerType(serviceDataType)
      res.json(serviceDataType)
    })

    router.get(`${apiPrefix}/*`, (req, res, next) => {
      console.info(`--> get ${req.originalUrl}`)
      const pathSegments = req.originalUrl.split("/").filter((segment) => segment.length > 0)
      if (pathSegments.length < 3) {
        res.json({
          error: `invalid path ${req.originalUrl} must follow pattern ${apiPrefix}/{serviceName}/{method}/"jsonParam1"/"jsonParam2"/...`
        })
        return
      }

      let runtime = RobotLabXRuntime.getInstance()

      if (pathSegments.length == 4) {
        // return service
        const name = pathSegments[3]
        console.info(`getting service ${name}`)
        const service = runtime.getService(name)
        res.json(service)
        return
      }

      if (pathSegments.length > 4) {
        // no parameter invoke
        const name = pathSegments[3]
        const methodName = pathSegments[4]
        const service = runtime.getService(name)

        const params: any = []
        // parameters supplied
        if (pathSegments.length > 5) {
          for (let i = 5; i < pathSegments.length; i++) {
            params.push(JSON.parse(decodeURIComponent(pathSegments[i])))
          }
        }

        let ret = null
        if (params.length > 0) {
          console.info(`get - invoking ${name}.${methodName}(${params})`)
          ret = service.invokeOn(false, service, methodName, ...params)
        } else {
          console.info(`get - invoking ${name}.${methodName}()`)
          ret = service.invokeOn(false, service, methodName)
        }
        console.info(`get - return ${JSON.stringify(ret)}`)
        res.json(ret)
        return
      }

      console.info(`pathSegments ${pathSegments}`)

      res.json(runtime.getRegistry())
    })

    this.express.use("/", router)
  }
}
