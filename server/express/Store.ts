import bodyParser from "body-parser"
import { spawn } from "child_process"
import cors from "cors"
import express from "express"
import fs from "fs"
import http, { Server as HTTPServer } from "http"
import path from "path"
import { WebSocket, Server as WebSocketServer } from "ws"
import YAML from "yaml"
import NameGenerator from "./framework/NameGenerator"
import { Repo } from "./framework/Repo"
import Service from "./framework/Service"
import { AppData } from "./models/AppData"
import Message from "./models/Message"
import { ProcessData } from "./models/ProcessData"
import RobotLabXRuntime from "./service/RobotLabXRuntime"

const session = require("express-session")
const FileStore = require("session-file-store")(session)

const apiPrefix = "/api/v1/services"

type RegistryType = { [key: string]: any }

// Creates and configures an ExpressJS web server2.
export default class Store {
  private static instance: Store
  private static port: string | number | boolean
  private registry: RegistryType = {}

  // ref to Express instance
  public express: express.Application
  public http: HTTPServer
  protected wss: WebSocketServer
  protected clients: Set<WebSocket>
  protected runtimex: RobotLabXRuntime
  // protected store: Store

  // all application data
  protected datax: AppData

  protected id: string = NameGenerator.getName()
  protected name: string = "runtime"
  protected typeKey: string = "Store"
  protected version: string = "0.0.1"

  public getId(): string {
    return this.id
  }

  public static getInstance(): Store {
    if (!Store.instance) {
      Store.instance = new Store()
    }
    return Store.instance
  }

  public static createInstance(): Store {
    if (!Store.instance) {
      Store.instance = new Store()
      let store = Store.instance
      console.info(`id ${store.id} initializing store`)

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
    console.info(`Store ${this.version} on node ${process.version}`)
  } // end constructor "too big"

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

  private handleWsMessage(ws: WebSocket) {
    return (message: any) => {
      let msg = JSON.parse(message)
      console.log(msg)
      // Example of sending a message back to the client
      // ws.send(`Server received: ${message}`);
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

    router.get(`${apiPrefix}/runtime/repo`, async (req, res, next) => {
      const repoBasePath = path.join(__dirname, "public/repo")
      const repo = new Repo()
      const repoMap = await repo.processRepoDirectory(repoBasePath)

      // Convert the Map to an Object to send as JSON
      const repoObject = Object.fromEntries(repoMap)
      res.json(repoObject)
    })

    router.get(`${apiPrefix}/runtime`, (req, res, next) => {
      let runtime = RobotLabXRuntime.getInstance()
      res.json(runtime)
    })

    router.get(`${apiPrefix}/runtime/getRegistry`, (req, res, next) => {
      let runtime = RobotLabXRuntime.getInstance()
      res.json(runtime.getRegistry())
    })

    router.get(`${apiPrefix}/runtime/host`, (req, res) => {
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
