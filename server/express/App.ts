import bodyParser from 'body-parser';
import express from 'express';
import cors from 'cors';
import path from 'path';
import products from './data/products.json';
import os from 'os';
import NameGenerator from './framework/NameGenerator'
import {NodeData, HostData} from './models/NodeData'

const pm2 = require('@elife/pm2')

class AppData {
    public id : string;
    private nodes: { [id: string]: NodeData } = {};

    /**
     * Adds a new NodeData instance to the collection.
     * @param {string} id - The unique identifier for the node.
     * @param {NodeData} node - The NodeData instance to add.
     */
    public addNode( id: string, node: NodeData) {
        this.nodes[id] = node;
    }

    /**
     * Retrieves a NodeData instance by its ID.
     * @param {string} id - The ID of the node to retrieve.
     * @returns {NodeData} The NodeData instance.
     */
    public getNode( id: string) {
        return this.nodes[id];
    }
}

// Creates and configures an ExpressJS web server2.
class App {

    // ref to Express instance
    public express: express.Application;
    protected data: AppData;

    // Run configuration methods on the Express instance.
    constructor() {
        this.express = express();
        this.middleware();
        this.routes();
        this.data = new AppData();
        this.data.id = NameGenerator.getName();
        let thisNode = new NodeData(this.data.id);
        thisNode.host = HostData.getLocalHostData(os);
        this.data.addNode(this.data.id, thisNode);
    }

    // Configure Express middleware.
    private middleware(): void {
        // this.express.use(logger("dev"));
        this.express.use(cors());
        this.express.use('/images', express.static(path.join(__dirname, 'public/images')));
        this.express.use(bodyParser.json());
        this.express.use(bodyParser.urlencoded({ extended: false }));
    }

    // Configure API endpoints.
    private routes(): void {
        /* This is just to get up and running, and to make sure what we've got is
         * working so far. This function will change when we start to add more
         * API endpoints */
        const router = express.Router();
        // placeholder route handler
        router.get("/products", (req, res, next) => {
            console.log(process.env)
            res.json(products);
        });

        router.get("/nodes", (req, res, next) => {
            res.json(this.data);
        });

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
            };
          
            res.json(osInfo);
          });

        router.get("/stop", (req, res, next) => {
            process = pm2.stop({
                name: 'nc'
            }, (err: any, pid: any) => {
                console.info(`stopping process ${err} ${pid}`)
            })

            // res.json({ message: json });
            // res.json({ message: "stopped nc" });
            console.info(`process ${process}`)
            res.json(process);

        });

        router.get("/start", (req, res, next) => {

            // process = pm2.start({
            //     name: 'nc',
            //     script: '/usr/bin/nc',
            //     args: ['-l','7070'],
            //     log: 'nc.log'

            // })

            // blocking vs non blocking process
            process = pm2.start({
                name: 'nc',
                script: 'hello_world.py',
                // script: '/bin/nc.openbsd',
                restartAt:[],
                log: 'nc.log',
                cwd: './'

            }, (err: any, pid: any) => {
                console.info(`starting process ${err} ${pid}`)
            })

            // console.error(`process ${json}`)

            // console.error(`process ${json}`)

            // , (str: err, pid) => {
            //     console.error(err, pid)
            // })

            // let result = pm2.start({ script: 'server/express/App.j' }, function (err, apps) { });

            // res.json({ message: "started nc" });
            console.info(`process ${process}`)
            res.json(process);
        });

        this.express.use("/", router);
    }
}

export default new App().express;