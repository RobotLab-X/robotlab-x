
export class NodeData {
    protected id: string | null = null;
    public connections: string[];
    public host: HostData | null = null;
    public process: ProcessData | null = null;
    public type: NodeTypeData | null = null;

    constructor(id : string) {
        this.id = id;
        this.connections = [];
    }
}

export class NodeTypeData {
    public type: string | null = null;
    public description: string | null = null;
}
 
export class ProcessData {
    public pid: number | null = null;
    public name: string | null = null;
    public type: string | null = null;
    public shell: string | null = null;
    public memory: number | null = null;
    public cpu: number | null = null;
    public uptime: number | null = null;
    public status: string | null = null;
    public restarts: number | null = null;

    public static getProcessData( process: any): ProcessData {
        return {
            pid: process.pid,
            name: process.name,
            type: "node",
            shell: "bin/bash",
            memory: process.memory,
            cpu: process.cpu,
            uptime: process.uptime,
            status: process.status,
            restarts: process.restarts
        }
    }
}

export class HostData {
    public hostname: string | null = null;
    public platform: string | null = null;
    public architecture: string | null = null;
    public numberOfCPUs: number | null = null;
    public networkInterfaces: {} | null = null;
    public uptime: number | null = null;
    public freeMemory: number | null = null;
    public totalMemory: number | null = null;
    public loadAverage: number[] | null = null;
    public currentUser: {} | null = null;

    public static getLocalHostData(os:any): HostData {
        return {
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
    }
}


