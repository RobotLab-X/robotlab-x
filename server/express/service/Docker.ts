import { getLogger } from "../framework/Log"
import Service from "../framework/Service"
var DockerOde = require("dockerode")

const log = getLogger("Docker")

export default class Docker extends Service {
  // Class properties
  private intervalId: NodeJS.Timeout | null = null

  private docker = new DockerOde({ socketPath: "/var/run/docker.sock" })
  // private docker = new DockerOde()

  private containers: any = []

  private images: any = []

  config = {
    showAll: false
  }

  constructor(
    public id: string,
    public name: string,
    public typeKey: string,
    public version: string,
    public hostname: string
  ) {
    super(id, name, typeKey, version, hostname) // Call the base class constructor if needed
    // this.config = { intervalMs: 1000 }
    this.startPs()
  }

  showAll(all: boolean) {
    this.config.showAll = all
  }

  ps(): any[] {
    let that = this
    this.docker.listContainers({ all: this.config.showAll }, function (err: any, containers: any) {
      if (err) {
        log.error("Error listing containers:", err)
        return
      }

      log.info("All running containers:")
      containers.forEach(function (containerInfo: any) {
        log.info(JSON.stringify(containerInfo))
      })
      that.containers = containers
      that.invoke("publishPs")
    })
    return this.containers
  }

  publishPs(): any[] {
    const epoch = Date.now()
    log.info(`Docker.publishPs: ${epoch}`)
    return this.containers
  }

  pullImage(imageName: string): void {
    let that = this
    this.docker.pull(imageName, function (err: any, stream: any) {
      if (err) {
        return console.error(err)
      }

      that.docker.modem.followProgress(stream, onFinished, onProgress)

      function onFinished(err: any, output: any) {
        if (err) {
          that.invoke("publishError", err)
          return console.error(err)
        }
        console.log("Image pulled successfully")
        that.invoke("publishFinished", err)
      }

      function onProgress(event: any) {
        that.invoke("publishProgress", event)
      }
    })
  }

  listImages(): any[] {
    let that = this
    this.docker.listImages(function (err: any, images: any) {
      if (err) {
        log.error("Error listing images:", err)
        return
      }

      log.info("All images:")
      images.forEach(function (imageInfo: any) {
        log.info(JSON.stringify(imageInfo))
      })

      that.images = images
      that.invoke("publishImages", images)
    })
    return this.containers
  }

  publishImages(images: any): any[] {
    return this.images
  }

  publishError(str: any): any {
    log.error(str)
    return str
  }

  publishProgress(str: any): any {
    log.info(str)
    return str
  }

  publishFinished(str: any): any {
    log.info(str)
    return str
  }

  // Method to start the clock timer
  public startPs(): void {
    // Ensure no other timer is running before starting a new one
    if (this.intervalId === null) {
      this.intervalId = setInterval(() => this.invoke("ps"), 3000)
    } else {
      log.warn("Docker.startPs: Timer is already running")
    }
  }

  // Method to stop the clock timer
  public stopPs(): void {
    if (this.intervalId !== null) {
      log.info("Docker.stopPs: Stopping timer")
      clearInterval(this.intervalId)
      this.intervalId = null
    } else {
      log.warn("Docker.stopPs: Timer is not running")
    }
  }

  // Not sure if this is the best way to exclude members from serialization
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      typeKey: this.typeKey,
      version: this.version,
      hostname: this.hostname,
      config: this.config
    }
  }
}
