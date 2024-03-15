import bodyParser from 'body-parser'
import cors from 'cors'
import express from 'express'
import os from 'os'
import path from 'path'
import NameGenerator from './framework/NameGenerator'
import { HostData, NodeData, ProcessData } from './models/NodeData'
import { Status } from './models/Status'

const pm2 = require('@elife/pm2')

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
  protected data: AppData

  // Run configuration methods on the Express instance.
  constructor() {
    this.express = express()
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
    router.put('/api/v1/register', (req, res, next) => {
      console.log(req.body)
      this.data.putNode(req.body.id, req.body)
      let status = new Status()
      status.id = this.data.id
      status.source = 'runtime'
      status.level = 'info'
      status.detail = 'registered'
      res.json(status)
    })

    router.get('/api/v1/nodes', (req, res, next) => {
      res.json(this.data)
    })

    router.get('/os-info', (req, res) => {
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

    router.get('/stop', (req, res, next) => {
      process = pm2.stop(
        {
          name: 'nc'
        },
        (err: any, pid: any) => {
          console.info(`stopping process ${err} ${pid}`)
        }
      )

      // res.json({ message: json });
      // res.json({ message: "stopped nc" });
      console.info(`process ${process}`)
      res.json(process)
    })

    router.get('/start/:process', (req, res, next) => {
      // TODO - add optional arguments, and start executable, blocking non-blocking etc...

      // process = pm2.start({
      //     name: 'nc',
      //     script: '/usr/bin/nc',
      //     args: ['-l','7070'],
      //     log: 'nc.log'

      // })

      const decoded = decodeURIComponent(req.params.process)
      const processModule = JSON.parse(decoded)

      const script = 'start.py'
      const cwd = `./process/${processModule}`

      console.info(`starting process ${cwd}/${processModule}`)

      // TODO get requirements.json from processModule - check if
      // dependencies are met
      // host check
      // platform check - python version, pip installed, venv etc.
      // pip libraries and versions installed
      const pd: ProcessData = new ProcessData()

      // blocking vs non blocking process
      pm2.start(
        {
          name: `${processModule}-43908543`,
          script: 'start.py',
          // script: '/bin/nc.openbsd',
          restartAt: [],
          log: `./process/${processModule}/${processModule}.log`,
          cwd: cwd
        },
        (err: any, app: any) => {
          console.info(`process ${err} ${app.child.pid}`)
          console.info(`process ${err} ${JSON.stringify(app)}`)

          if (err) {
            console.error('Error starting app:', err)
            //pm2.disconnect();
            res.json({ message: 'error starting process' })
            return
          }

          console.info('launching bus')
          pm2.launchBus(function (err: any, bus: any) {
            bus.on('log:out', function (packet: any) {
              // STDOUT stream
              console.log(`[App:${packet.process.name}]`, packet.data)
            })

            bus.on('log:err', function (packet: any) {
              // STDERR stream
              console.error(`[App:${packet.process.name} ERROR]`, packet.data)
            })
          })
        }
      )

      // console.error(`process ${json}`)

      // console.error(`process ${json}`)

      // , (str: err, pid) => {
      //     console.error(err, pid)
      // })

      // let result = pm2.start({ script: 'server/express/App.j' }, function (err, apps) { });

      // res.json({ message: "started nc" });
      console.info(`process ${pd}`)
      res.json(pd)
    })

    this.express.use('/', router)
  }
}

export default new App().express
