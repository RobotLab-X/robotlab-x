import bodyParser from 'body-parser'
import cors from 'cors'
// import { Server } from 'http'
import os from 'os'
import path from 'path'
import NameGenerator from './framework/NameGenerator'
import { HostData, NodeData, ProcessData } from './models/NodeData'
import { Status } from './models/Status'

import express from 'express'
import { Server as HTTPServer } from 'http'
import { Server } from 'ws'

const { spawn } = require('child_process')
const http = require('http')

const apiPrefix = '/api/v1'

class AppData {
  public id: string
  private nodes: { [id: string]: NodeData } = {}

  /**
   * Adds a new NodeData instance to the collection.
   * @param {string} id - The unique identifier for the node.
   * @param {NodeData} node - The NodeData instance to add.
   */
  public putNode(id: string, node: NodeData) {
    this.nodes[id] = node
  }

  /**
   * Retrieves a NodeData instance by its ID.
   * @param {string} id - The ID of the node to retrieve.
   * @returns {NodeData} The NodeData instance.
   */
  public getNode(id: string) {
    return this.nodes[id]
  }
}

// Creates and configures an ExpressJS web server2.
class App {
  // ref to Express instance
  public express: express.Application
  public http: HTTPServer
  public ws: Server
  protected data: AppData

  // Run configuration methods on the Express instance.
  constructor() {
    this.express = express()
    // this.http = new HTTPServer(this.express) // Create an HTTP server from the Express app
    this.http = http.createServer(this.express)
    this.ws = new Server({ server: this.http })
    this.middleware()
    this.routes()
    this.data = new AppData()
    this.data.id = NameGenerator.getName()
    let thisNode = new NodeData(this.data.id)
    thisNode.name = 'runtime'
    thisNode.host = HostData.getLocalHostData(os)
    // TODO getTypeInfo(this)
    thisNode.process = ProcessData.getProcessData(process)
    thisNode.process.platform = 'node'
    thisNode.type = {
      name: 'RobotLabXManager',
      description: 'RobotLab-X Service Manager API',
      version: '0.0.1'
    }
    this.data.putNode(this.data.id, thisNode)

    // Handle a connection request from clients
    this.ws.on('connection', function connection(ws: any) {
      console.log('A client connected')

      ws.on('message', function incoming(message: any) {
        console.log('received: %s', message)

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
      '/images',
      express.static(path.join(__dirname, 'public/images'))
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
    router.put(`${apiPrefix}/register`, (req, res, next) => {
      console.log(req.body)
      this.data.putNode(req.body.id, req.body)
      let status = new Status()
      status.id = this.data.id
      status.source = 'runtime'
      status.level = 'info'
      status.detail = 'registered'
      res.json(status)
    })

    router.get(`${apiPrefix}/nodes`, (req, res, next) => {
      res.json(this.data)
    })

    router.get(`${apiPrefix}/os-info`, (req, res) => {
      const osInfo = {
        hostname: os.hostname(),
        platform: os.platform(),
        architecture: os.arch(),
        numberOfCPUs: os.cpus().length,
        networkInterfaces: os.networkInterfaces(),
        uptime: os.uptime(),
        freeMemory: os.freemem(),
        totalMemory: os.totalmem(),
        loadAverage: os.loadavg(),
        currentUser: os.userInfo()
      }

      res.json(osInfo)
    })

    router.get(`${apiPrefix}/stop/:process`, (req, res, next) => {
      const decoded = decodeURIComponent(req.params.process)
      const processModule = JSON.parse(decoded)

      console.info(`stop process ${process}`)

      res.json(process)
    })

    router.get(`${apiPrefix}/start/:process`, (req, res, next) => {
      const decoded = decodeURIComponent(req.params.process)
      const processModule = JSON.parse(decoded)

      const script = 'start.py'
      const cwd = `./process/${processModule}`

      console.info(`starting process ${cwd}/${processModule}`)

      // TODO get package.yml from processModule - check if
      // dependencies are met
      // host check
      // platform check - python version, pip installed, venv etc.
      // pip libraries and versions installed
      const pd: ProcessData = new ProcessData()

      console.info(`Starting process ${cwd}/${script}`)

      // spawn the process
      const childProcess = spawn('python', [script], { cwd })

      console.info(`process ${JSON.stringify(childProcess)}`)
      res.json(childProcess)
    })

    this.express.use('/', router)
  }
}

// export default new App().express
export default new App()
