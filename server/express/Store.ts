import bodyParser from "body-parser"
import cors from "cors"
import express from "express"
import http, { Server as HTTPServer } from "http"
import path from "path"
import { v4 as uuidv4 } from "uuid"
import { WebSocket, Server as WebSocketServer } from "ws"
import { getLogger } from "../express/framework/Log"
import { CodecUtil } from "./framework/CodecUtil"
import Service from "./framework/Service"
import Gateway from "./interfaces/Gateway"
import Message from "./models/Message"
import RobotLabXRuntime from "./service/RobotLabXRuntime"

const session = require("express-session")
const FileStore = require("session-file-store")(session)
const apiPrefix = "/api/v1/services"

const log = getLogger("Store")

type RegistryType = { [key: string]: Service }

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
      store.routes()
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
    return this.registry[key]
  }

  public releaseService(key: string): void {
    delete this.registry[key]
  }

  // Run configuration methods on the Express instance.
  constructor() {
    log.info(`store initializing on node ${process.version}`)
  }

  /**
   * Accept "inbound" WebSocket connections
   */
  private initWebSocketServer() {
    this.wss.on("connection", (ws, request) => {
      log.info("client connected")

      // Access the URL the client connected to
      const url = request.url
      log.info(`connected to url: ${url}`)

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
      this.runtime.registerConnection(`runtime@${this.runtime.getId()}`, gatewayId, url, "inbound", ws)

      // onmessage - server
      ws.on("message", this.handleWsMessage(ws, gatewayId))

      ws.on("close", () => {
        this.runtime.removeConnection(gatewayId)
      })

      ws.on("error", (error) => {
        console.error("WebSocket error:", error)
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
        // log.info(`--> ws ${JSON.stringify(msg)}`)
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
      if (msg.data && msg.data.length > 0) {
        log.info(`--> ${msg.sender} --> ${msg.name}.${msg.method}(${JSON.stringify(msg.data)})`)
      } else {
        log.info(`--> ${msg.sender} --> ${msg.name}.${msg.method}()`)
      }

      // fully address name
      let fullName = CodecUtil.getFullName(msg.name)
      const msgId = CodecUtil.getId(fullName)

      // FIXME - this is duplicate code inside of invokeMsg
      // FIXME FIXME FIXME - this is a kludge - all this should be in Service
      // in invokeMsg
      // check if msg destination is remote or local
      if (msgId !== this.runtime.getId()) {
        // we need to immediately send a remote message away, because the registry
        // won't have a real service to invokeMsg on it - chicken egg problem
        // RobotLabXRuntime.getInstance().getGatewayConnection(msgId).send(JSON.stringify(msg))

        // fine the gateway for the message's remoteId
        let gateway: Gateway = this.runtime.getGateway(msgId)
        if (!gateway) {
          log.error(`NO GATEWAY for remoteId ${msgId}`)
          return null
        }

        // find the local process id for the message to be routed through
        const gatewayRouteId = this.runtime.getRouteId(msgId)

        // TODO - implement synchronous blocking
        let blockingObject = gateway.sendRemote(gatewayRouteId, msg)

        return null
      }

      // FIXME nameless service should be routed to runtime
      // find service in registry
      let service: Service = this.getService(fullName)

      if (service === null) {
        // ui error - user should be informed
        console.error(`service ${fullName} not found`)
        return null
      }

      if (msg.method === null) {
        // ui error - user should be informed
        console.error(`method ${msg.method} not found`)
        return null
      }

      // execute method with parameters on service
      // TODO - should be done in a service.invoke(msg) method so that subscriptions
      // can be processed
      let ret: Object = service.invokeMsg(msg)
      log.debug(`return ${JSON.stringify(ret)}`)

      return ret

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
    this.express.use("/service", express.static(path.join(__dirname, "public/service")))
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
      log.info(`--> put ${req.originalUrl} ${JSON.stringify(req.body)}`)
      const serviceData = req.body

      const pathSegments = req.originalUrl.split("/").filter((segment) => segment.length > 0)
      if (pathSegments.length != 5) {
        res.json({
          error: `invalid path ${req.originalUrl} must follow pattern ${apiPrefix}/{serviceName}/{method}`
        })
        return
      }

      const name = pathSegments[3]
      const methodName = pathSegments[4]
      const runtime = RobotLabXRuntime.getInstance()
      const service = runtime.getService(name)
      const msg = new Message(name, methodName, serviceData)
      const ret = this.handleMessage(msg)
      res.json(ret)
    })

    router.put(`${apiPrefix}/runtime/register`, (req, res, next) => {
      log.info(req.body)
      const serviceData = req.body
      let runtime = RobotLabXRuntime.getInstance()
      runtime.register(serviceData)
      res.json(serviceData)
    })

    router.put(`${apiPrefix}/runtime/registerType`, (req, res, next) => {
      log.info(req.body)
      const serviceDataType = req.body
      let runtime = RobotLabXRuntime.getInstance()
      runtime.registerType(serviceDataType)
      res.json(serviceDataType)
    })

    router.get(`${apiPrefix}/*`, (req, res, next) => {
      log.info(`--> get ${req.originalUrl}`)
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
        log.info(`getting service ${name}`)
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

        const msg: Message = new Message(name, methodName, params)
        let ret = this.handleMessage(msg)
        log.info(`--> get ${req.originalUrl} return ${JSON.stringify(ret)}`)
        res.json(ret)
        return
      }

      log.info(`pathSegments ${pathSegments}`)

      res.json(runtime.getRegistry())
    })

    this.express.use("/", router)
  }
}
