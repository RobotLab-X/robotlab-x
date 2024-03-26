import bodyParser from "body-parser"
import cors from "cors"
import os from "os"
import path from "path"
import NameGenerator from "./framework/NameGenerator"
import { ProcessData } from "./models//ProcessData"
import { AppData } from "./models/AppData"

import express from "express"
import { Server as HTTPServer } from "http"
import { Server } from "ws"

import { spawn } from "child_process"
import fs from "fs"
import http from "http"
import YAML from "yaml"
import { HostData } from "./models//HostData"
import { ServiceData } from "./models//ServiceData"
import { ServiceTypeData } from "./models//ServiceTypeData"

const apiPrefix = "/api/v1/services"

// Creates and configures an ExpressJS web server2.
class App {
  // ref to Express instance
  public express: express.Application
  public http: HTTPServer
  public ws: Server

  // all application data
  protected data: AppData

  // Run configuration methods on the Express instance.
  constructor() {
    this.express = express()
    // this.http = new HTTPServer(this.express) // Create an HTTP server from the Express app
    this.http = http.createServer(this.express)
    this.ws = new Server({ server: this.http })
    this.middleware()
    this.routes()

    // initialize the application data

    this.data = new AppData("runtime", NameGenerator.getName(), os.hostname())
    let data = this.data

    // register the host
    let host = HostData.getLocalHostData(os)
    data.registerHost(host)

    // register process
    let process: ProcessData = this.getLocalProcessData()
    process.host = host.hostname
    data.registerProcess(process)

    // register type
    let type = new ServiceTypeData("RobotLabXRuntime")
    type.description =
      "The RobotLab X Server service acts as a foundation for creating additional services tailored for robots, such as vision, text-to-speech, speech-to-text, and chat interfaces. It allows users to easily expand their robot's capabilities by adding new functionalities as needed."
    type.version = "0.0.1"
    type.author = "GroG"
    type.license = "MPL-2.0"
    type.language = "JavaScript"
    type.title = "RobotLab X Server"
    type.platform = "node"
    type.platformVersion = process.platformVersion
    data.registerType(type)

    // register service
    let service = new ServiceData(
      this.data.getId(),
      "runtime",
      "RobotLabXRuntime",
      "0.0.1"
    )
    // this.data.register("runtime", "RobotLabXRuntime", this.data.getId())
    data.register(service)

    // TODO add my service
    // Handle a connection request from clients
    this.ws.on("connection", function connection(ws: any) {
      console.log("A client connected")

      ws.on("message", function incoming(message: any) {
        console.log("received: %s", message)

        // WORKS !!!
        // Echo the received message back to the client
        // ws.send(`Server received: ${message}`)
      })
    })
  }

  // Configure Express middleware.
  private middleware(): void {
    // this.express.use(logger("dev"));
    this.express.use(cors())
    this.express.use(
      "/images",
      express.static(path.join(__dirname, "public/images"))
    )
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
      this.data.register(serviceData)
      res.json(serviceData)
    })

    router.put(`${apiPrefix}/runtime/registerType`, (req, res, next) => {
      console.log(req.body)
      const serviceDataType = req.body
      this.data.registerType(serviceDataType)
      res.json(serviceDataType)
    })

    router.get(`${apiPrefix}/runtime`, (req, res, next) => {
      res.json(this.data)
    })

    router.get(`${apiPrefix}/runtime/host`, (req, res) => {
      res.json(this.data.getHost())
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

    router.get(`${apiPrefix}/start/:name/:type`, (req, res, next) => {
      try {
        const serviceName = JSON.parse(decodeURIComponent(req.params.name))
        const serviceType = JSON.parse(decodeURIComponent(req.params.type))
        const pkgPath = `./service/${serviceType}`
        const pkgYmlFile = `${pkgPath}}/package.yml`

        // loading type info
        console.info(`loading type data from ${pkgYmlFile}`)

        const file = fs.readFileSync(pkgYmlFile, "utf8")
        const pkg = YAML.parse(file)

        // determine necessary platform python, node, docker, java
        // yes | no -> install -> yes | no

        if (pkg.platform === "python") {
          console.info(`python package ${pkg}`)
        }

        // resolve if package.yml dependencies are met

        console.info(`yaml ${JSON.stringify(pkg)}`)

        // creating instance config from type if it does not exist

        // preparing to start the process

        const script = "start.py"

        // register

        // TODO get package.yml from processModule - check if
        // dependencies are met
        // host check
        // platform check - python version, pip installed, venv etc.
        // pip libraries and versions installed
        const pd: ProcessData = new ProcessData(
          serviceName,
          process.pid,
          this.data.getHostname(),
          "python",
          "3.8.5"
        )
        this.data.registerProcess(pd)

        // TODO register the service

        console.info(`Starting process ${pkgPath}/${script}`)

        // spawn the process
        const childProcess = spawn("python", [script], { cwd: pkgPath })

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
      this.data.getId(),
      process.pid,
      this.data.getHostname(),
      "node",
      process.version
    )
    return pd
  }
}

// export default new App().express
export default new App()
