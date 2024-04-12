import bodyParser from "body-parser"
import cors from "cors"
import os from "os"
import path from "path"
import NameGenerator from "./framework/NameGenerator"
import { Repo } from "./framework/Repo"
import { AppData } from "./models/AppData"
import Message from "./models/Message"
import { ProcessData } from "./models/ProcessData"

import { spawn } from "child_process"
import express from "express"
import fs from "fs"
import http, { Server as HTTPServer } from "http"
import { WebSocket, Server as WebSocketServer } from "ws"
import YAML from "yaml"
import Service from "./framework/Service"
import Store from "./framework/Store"
import { HostData } from "./models/HostData"
import RobotLabXRuntime from "./service/RobotLabXRuntime"

const session = require("express-session")
const FileStore = require("session-file-store")(session)

const apiPrefix = "/api/v1/services"

// Creates and configures an ExpressJS web server2.
class App {
  // ref to Express instance
  public express: express.Application
  public http: HTTPServer
  protected wss: WebSocketServer
  protected clients: Set<WebSocket>
  protected runtime: RobotLabXRuntime
  protected store: Store

  // all application data
  protected datax: AppData

  protected id: string = NameGenerator.getName()
  protected name: string = "runtime"
  protected typeKey: string = "RobotLabXRuntime"
  protected version: string = "0.0.1"

  // Run configuration methods on the Express instance.
  constructor() {
    console.info(`starting RobotLabXRuntime ${this.version} on node ${process.version}`)

    console.info(`id ${this.id} initializing store`)
    // FIXME probably should not set a reference ?
    this.store = Store.getInstance()

    this.express = express()
    this.http = http.createServer(this.express)
    this.wss = new WebSocketServer({ server: this.http })
    this.clients = new Set()
    this.runtime = RobotLabXRuntime.createInstance(this.id, os.hostname())

    this.middleware()
    this.routes()

    // initialize the application data - FIXME DEPRECATE
    // this.data = new AppData(this.name, this.id, os.hostname())
    // let data = this.data

    // register the host
    let host = HostData.getLocalHostData(os)
    this.runtime.registerHost(host)

    // register process
    let pd: ProcessData = this.getLocalProcessData()
    pd.host = host.hostname

    this.runtime.registerProcess(pd)
    this.runtime.register(this.runtime)

    this.initWebSocketServer()
  } // end constructor "too big"

  public static main(args: string[]) {
    let app = new App()
    // app.http.listen(3000)
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
   * Process incoming messages from the client
   * @param ws
   * @returns
   */
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
        store: new FileStore(), // options is optional
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
      this.runtime.register(serviceData)
      res.json(serviceData)
    })

    router.put(`${apiPrefix}/runtime/registerType`, (req, res, next) => {
      console.log(req.body)
      const serviceDataType = req.body
      this.runtime.registerType(serviceDataType)
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
      res.json(this.runtime)
    })

    router.get(`${apiPrefix}/runtime/getRegistry`, (req, res, next) => {
      res.json(this.runtime.getRegistry())
    })

    router.get(`${apiPrefix}/runtime/host`, (req, res) => {
      res.json(this.runtime.getHost())
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
        const pd: ProcessData = new ProcessData(
          serviceName,
          "123456", // process.pid,
          this.runtime.getHostname(),
          "python",
          "3.8.5"
        )
        this.runtime.registerProcess(pd)

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
            this.runtime.getHostname()
          )

          // TODO register the service
          this.runtime.register(service)
        }

        console.info(`process ${JSON.stringify(childProcess)}`)
        res.json(childProcess)
      } catch (e) {
        console.error(e)
      }
    })

    this.express.use("/", router)
  }

  public getLocalProcessData(): ProcessData {
    let pd: ProcessData = new ProcessData(
      this.runtime.getId(),
      process.pid,
      this.runtime.getHostname(),
      "node",
      process.version
    )
    return pd
  }
}

// export default new App().express
export default new App()
