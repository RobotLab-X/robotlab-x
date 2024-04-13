import bodyParser from "body-parser"
import { spawn } from "child_process"
import cors from "cors"
import express from "express"
import fs from "fs"
import http, { Server as HTTPServer } from "http"
import path from "path"
import { WebSocket, Server as WebSocketServer } from "ws"
import YAML from "yaml"
import { CodecUtil } from "./framework/CodecUtil"
import { Repo } from "./framework/Repo"
import Service from "./framework/Service"
import Message from "./models/Message"
import { ProcessData } from "./models/ProcessData"
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

      //

      // Example of sending a message back to the client
      // ws.send(`Server received: ${message}`);
    } catch (e) {
      // ui error - user should be informed
      console.error(e)
    }
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
    // placeholder route handler
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

    router.get(`${apiPrefix}/runtime/getRepo`, async (req, res, next) => {
      let runtime = RobotLabXRuntime.getInstance()
      res.json(runtime.getRepo())
    })

    router.get(`${apiPrefix}/runtime`, (req, res, next) => {
      let runtime = RobotLabXRuntime.getInstance()
      res.json(runtime)
    })

    router.get(`${apiPrefix}/runtime/getRegistry`, (req, res, next) => {
      let runtime = RobotLabXRuntime.getInstance()
      res.json(runtime.getRegistry())
    })

    router.get(`${apiPrefix}/runtime/getHost`, (req, res) => {
      let runtime = RobotLabXRuntime.getInstance()
      res.json(runtime.getHost())
    })

    router.get(`${apiPrefix}/stop/:name`, (req, res, next) => {
      console.info(`release process ${req.params.name}`)
      const name = JSON.parse(decodeURIComponent(req.params.name))
      res.json(name)
    })

    router.get(`${apiPrefix}/release/:name`, (req, res, next) => {
      console.info(`release process ${req.params.name}`)
      const name = JSON.parse(decodeURIComponent(req.params.name))
      res.json(name)
    })

    // version - FIXME - remove version
    router.get(`${apiPrefix}/start/:name/:type/:version`, (req, res, next) => {
      try {
        console.info(`start params ${JSON.stringify(req.params)}`)

        const serviceName = JSON.parse(decodeURIComponent(req.params.name))
        const serviceType = JSON.parse(decodeURIComponent(req.params.type))
        const version = JSON.parse(decodeURIComponent(req.params.version))

        console.info(process.cwd())

        // repo should be immutable - make a copy to service/{name} if one doesn't already exist
        const pkgPath = `./express/public/service/${serviceName}`
        const repo = new Repo()
        const successful = repo.copyPackage(serviceName, serviceType, version)
        console.info(`successful ${successful}`)

        const pkgYmlFile = `${pkgPath}/package.yml`

        // loading type info
        console.info(`loading type data from ${pkgYmlFile}`)
        const file = fs.readFileSync(pkgYmlFile, "utf8")
        const pkg = YAML.parse(file)
        console.info(`package.yml ${pkg}`)

        // TODO - if service request to add a service
        // and mrl and process exists - then /runtime/start

        // determine necessary platform python, node, docker, java
        // yes | no -> install -> yes | no

        // TODO - way to set cmd line args

        console.info(`python package ${pkg}`)

        // resolve if package.yml dependencies are met

        console.info(`yaml ${JSON.stringify(pkg)}`)

        // creating instance config from type if it does not exist

        // preparing to start the process

        // const script = "start.py"
        // register

        // TODO - only if you need a new process
        // TODO get package.yml from processModule - check if
        // dependencies are met
        // host check
        // platform check - python version, pip installed, venv etc.
        // pip libraries and versions installed
        let runtime = RobotLabXRuntime.getInstance()

        const pd: ProcessData = new ProcessData(
          serviceName,
          "123456", // process.pid,
          runtime.getHostname(),
          "python",
          "3.8.5"
        )
        runtime.registerProcess(pd)

        console.info(`starting process ${pkgPath}/${pkg.cmd} ${pkg.args}`)

        // spawn the process
        const childProcess = spawn(pkg.cmd, pkg.args, { cwd: pkgPath })

        childProcess.on("error", (err) => {
          console.error(`failed to start subprocess. ${err}`)
          // send message with error to UI
        })

        if (childProcess.pid) {
          // register the service
          const service: Service = new Service(
            childProcess.pid.toString(),
            serviceName,
            serviceType,
            version,
            runtime.getHostname()
          )

          // TODO register the service
          runtime.register(service)
        }

        console.info(`process ${JSON.stringify(childProcess)}`)
        res.json(childProcess)
      } catch (e) {
        console.error(e)
      }
    })

    this.express.use("/", router)
  }
}

// easy singleton way
// export default new App().express
// export default new App()
