import os from "os"
import { getLogger } from "../framework/LocalLog"
import Service from "../framework/Service"
var DockerOde = require("dockerode")

const log = getLogger("Docker")

export default class Docker extends Service {
  // Class properties
  private intervalId: NodeJS.Timeout | null = null

  private docker: any = null

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
  }

  startService(): void {
    super.startService()
    if (os.platform() === "win32") {
      this.docker = new DockerOde({ socketPath: "//./pipe/docker_engine" })
    } else {
      this.docker = new DockerOde({ socketPath: "/var/run/docker.sock" })
    }

    this.startPs()
  }

  stopService(): void {
    super.stopService()
    this.stopPs()
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
        log.debug(JSON.stringify(containerInfo))
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

  createAndStartContainer(imageName: string, containerName: string): void {
    const that = this
    // FIXME change it to a InstallLog object ?
    that.info(`${imageName} ${containerName}`)
    const createAndStartContainer = async (imageName: string, containerName: string) => {
      try {
        // Pull the image if it doesn't exist locally
        await new Promise((resolve, reject) => {
          this.docker.pull(imageName, (err: any, stream: any) => {
            if (err) {
              that.error(JSON.stringify(err))
              return reject(err)
            }
            that.docker.modem.followProgress(stream, onFinished, onProgress)

            function onFinished(err: any, output: any) {
              if (err) {
                that.error(JSON.stringify(err))
                return reject(err)
              }
              resolve(output)
              that.info(JSON.stringify(output))
            }
            function onProgress(event: any) {
              that.info(JSON.stringify(JSON.stringify(event)))
            }
          })
        })

        // // Create the container
        // const container = await this.docker.createContainer({
        //   Image: imageName,
        //   name: containerName,
        //   Tty: true // Allocate a pseudo-TTY
        // })

        // FIXME variable parameters
        const container = await this.docker.createContainer({
          Image: imageName,
          name: containerName,
          Tty: true, // Allocate a pseudo-TTY
          ExposedPorts: { "80/tcp": {} },
          HostConfig: {
            PortBindings: { "80/tcp": [{ HostPort: "8080" }] } // Map container port 80 to host port 8080
          }
        })

        await container.start()
        log.info(`Container ${containerName} started successfully.`)
      } catch (err) {
        that.error(JSON.stringify(err))
      }
    }
    createAndStartContainer(imageName, containerName)
  }

  deleteContainer(containerId: string): void {
    const that = this
    that.info(`Deleting container ${containerId}`)
    const deleteContainer = async (containerId: string) => {
      try {
        const container = this.docker.getContainer(containerId)
        // await container.stop() throws if already stopped
        await container.remove()
        that.info(`Container ${containerId} deleted successfully.`)
      } catch (err) {
        that.error(JSON.stringify(err))
      }
    }
    deleteContainer(containerId)
  }

  deleteImage(imageId: string): void {
    const that = this
    that.info(`Deleting image ${imageId}`)
    const deleteImage = async (imageId: string) => {
      try {
        const image = this.docker.getImage(imageId)
        await image.remove()
        that.info(`Image ${imageId} deleted successfully.`)
        that.invoke("getImages")
      } catch (err) {
        that.error(JSON.stringify(err))
      }
    }
    deleteImage(imageId)
  }

  pullImage(imageName: string): void {
    let that = this
    that.info(`Pulling image ${imageName}.`)
    this.docker.pull(imageName, function (err: any, stream: any) {
      if (err) {
        that.error(JSON.stringify(err))
        return console.error(err)
      }

      that.docker.modem.followProgress(stream, onFinished, onProgress)

      function onFinished(err: any, output: any) {
        if (err) {
          that.error(JSON.stringify(err))
          return console.error(err)
        }
        that.info(`Image pulled successfully.`)
        that.invoke("getImages")
      }

      function onProgress(event: any) {
        that.info(`${JSON.stringify(event)}`)
      }
    })
  }

  startContainer = async (containerId: string) => {
    const that = this
    that.info(`Starting container ${containerId}.`)
    try {
      const container = this.docker.getContainer(containerId)
      await container.start()
      that.info(`Container ${containerId} started successfully.`)
    } catch (err) {
      that.error(`Error starting container ${containerId}: ${err}`)
    }
  }

  runContainer = async (containerId: string) => {
    const that = this
    that.info(`Running container ${containerId}.`)
    try {
      const container = this.docker.getContainer(containerId)
      await container.run
      that.info(`Container ${containerId} started successfully.`)
    } catch (err) {
      that.error(`Error starting container ${containerId}: ${err}`)
    }
  }

  createAndRunContainer = async (imageId: string, containerName: string, cmd: string) => {
    const that = this
    that.info(`creating and starting container ${imageId} ${containerName}.`)
    try {
      const container = await this.docker.createContainer({
        Image: "alpine",
        Cmd: ["/bin/sh"],
        Tty: true,
        name: containerName
      })

      let result = await container.start()
      that.info(`start ${containerName} ${result}`)

      const exec = await container.exec({
        Cmd: ["/bin/sh"],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true
      })

      const stream = await exec.start({ hijack: true, stdin: true })

      // Attach container's output stream to the current process's stdout
      container.modem.demuxStream(stream, process.stdout, process.stderr)

      // Attach the current process's stdin to the container's input stream
      process.stdin.pipe(stream)

      // Make sure the container is removed when it's stopped
      container.wait().then(() => {
        container.remove()
      })

      that.info(`Container ${containerName} started successfully.`)
    } catch (err) {
      that.error(`Error starting container ${containerName}: ${err}`)
    }
  }

  stopContainer = async (containerId: string) => {
    const that = this
    that.info(`Stopping container ${containerId}.`)
    try {
      const container = this.docker.getContainer(containerId)
      await container.stop()
      that.info(`Container ${containerId} stopped successfully.`)
    } catch (err) {
      that.error(`Error stopping container ${containerId}:${err}`)
    }
  }

  getImages(): any[] {
    let that = this
    this.docker.listImages(function (err: any, images: any) {
      if (err) {
        that.error(`Listing images error ${err}`)
        return
      }

      log.debug("All images:")
      images.forEach(function (imageInfo: any) {
        log.debug(JSON.stringify(imageInfo))
      })

      that.images = images
      that.invoke("publishImages", images)
    })
    return this.containers
  }

  publishImages(images: any): any[] {
    return this.images
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
      ...super.toJSON()
    }
  }
}
