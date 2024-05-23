import Message from "express/models/Message"
import WebSocket from "ws" // Import WebSocket module
import { getLogger } from "../framework/Log"
import { Repo } from "../framework/Repo"
import Service from "../framework/Service"
import RobotLabXRuntime from "../service/RobotLabXRuntime"

const log = getLogger("MyRobotLabConnector")
export default class MyRobotLabConnector extends Service {
  private webSocket?: WebSocket // Optional WebSocket object

  connecting = false
  connected = false
  // FIXME - WRONG ! should all be handled through RobotLabXRuntime
  repo = new Repo()

  // FIXME remove the /api/messages - should be internal use only
  config = {
    wsUrl: "ws://localhost:8888/api/messages"
  }

  constructor(
    public id: string,
    public name: string,
    public typeKey: string,
    public version: string,
    public hostname: string
  ) {
    super(id, name, typeKey, version, hostname) // Call the base class constructor
    this.repo.load()
  }

  // Method to establish a WebSocket connection
  connect(wsUrl: string): void {
    log.info(`Attempting to connect to ${wsUrl}`)

    if (this.connecting || this.connected) {
      log.error("Already connected or connecting")
      return
    }
    this.connected = false
    this.connecting = true

    // Initialize WebSocket connection
    this.webSocket = new WebSocket(wsUrl)

    const that = this
    // Event handler when connection is open
    this.webSocket.on("open", () => {
      this.connecting = false
      this.connected = true
      log.info("Connection successful!")
      const runtime: RobotLabXRuntime = RobotLabXRuntime.getInstance()
      that.invoke("broadcastState")
      const addListenerOnServiceNamesMsg = {
        name: "runtime",
        method: "addListener",
        data: [
          '{"topicMethod":"getServiceNames","callbackName":"runtime@' +
            this.id +
            '","callbackMethod":"onServiceNames","class":"org.myrobotlab.framework.MRLListener"}'
        ],
        class: "org.myrobotlab.framework.Message"
      }

      const addListenerOnRegistered = {
        name: "runtime",
        method: "addListener",
        data: [
          '{"topicMethod":"registered","callbackName":"runtime@' +
            this.id +
            '","callbackMethod":"onRegistered","class":"org.myrobotlab.framework.MRLListener"}'
        ],
        class: "org.myrobotlab.framework.Message"
      }

      const addListenerOnReleased = {
        name: "runtime",
        method: "addListener",
        data: [
          '{"topicMethod":"released","callbackName":"runtime@' +
            this.id +
            '","callbackMethod":"onReleased","class":"org.myrobotlab.framework.MRLListener"}'
        ],
        class: "org.myrobotlab.framework.Message"
      }

      const addListenerOnService = {
        name: "runtime",
        method: "addListener",
        data: [
          '{"topicMethod":"getService","callbackName":"runtime@' +
            this.id +
            '","callbackMethod":"onService","class":"org.myrobotlab.framework.MRLListener"}'
        ],
        class: "org.myrobotlab.framework.Message"
      }

      const getServiceNamesMsg = {
        name: "runtime",
        method: "getServiceNames"
      }

      // could add all listeners here
      this.webSocket?.send(JSON.stringify(addListenerOnServiceNamesMsg))
      this.webSocket?.send(JSON.stringify(addListenerOnRegistered))
      this.webSocket?.send(JSON.stringify(addListenerOnReleased))
      this.webSocket?.send(JSON.stringify(addListenerOnService))

      // fire off a request for the service names
      // to get started
      this.webSocket?.send(JSON.stringify(getServiceNamesMsg))
    })

    // Event handler for receiving messages
    this.webSocket.on("message", (data) => {
      let str = data.toString()
      if (str == "X") {
        log.info("Received Atmosphere X")
        return
      }
      log.info(`mrl --> ${this.name} ${str}`)
      this.onMessageReceived(str)
    })

    // Handle errors
    this.webSocket.on("error", (error) => {
      console.error("WebSocket error:", error)
    })

    // Handle WebSocket closures
    this.webSocket.on("close", () => {
      log.info("WebSocket connection closed")
      this.connected = false
      this.connecting = false
      this.webSocket = undefined
    })
  }

  // Method to handle received messages
  private onMessageReceived(message: string) {
    try {
      let msg = JSON.parse(message)
      // double pars :(
      if (msg.data) {
        msg.data[0] = JSON.parse(msg.data[0])
      }
      if (msg.method == "onServiceNames") {
        this.onServiceNames(msg)
      } else if (msg.method == "describe") {
        log.info("describe message")
      } else if (msg.method == "addListener") {
        log.info("addListener message")
      } else if (msg.method == "onService") {
        let mrlService = msg.data[0]
        // let service = this.repo.getService(mrlService.id, mrlService.name, "MyRobotLabProxy", "0.0.1", "unknown")
        log.error(`mrlService ${JSON.stringify(mrlService)}`)
        log.error(`mrlService.name ${JSON.stringify(mrlService.name)}`)
        let service = this.repo.getService(mrlService.id, mrlService.name, "MyRobotLabProxy", "0.0.1", "unknown")
        log.error("HERE !!!!!!!!!!!!!!!!!!!!!!!!")
        RobotLabXRuntime.getInstance().register(service)
      } else {
        log.error(`Unhandled message: ${message}`)
      }
    } catch (error) {
      console.error("Failed to parse message:", error, message)
      return
    }
  }

  // Example method that could be triggered by an incoming message
  onServiceNames(msg: Message): void {
    log.info(`onServiceNames`)
    let serviceNames = msg.data[0]
    serviceNames.forEach((serviceName: string) => {
      log.info(`service name: ${serviceName}`)
      this.sendMessage({
        name: "runtime",
        method: "getService",
        data: ['"' + serviceName + '"']
      })
    })
  }

  // Method to send a message
  sendMessage(message: object) {
    if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
      this.webSocket.send(JSON.stringify(message))
    } else {
      console.error("WebSocket is not connected.")
    }
  }

  getRepo(): Repo {
    return this.repo
  }

  getConfigName(): string {
    return "default-test"
  }

  getConfigList(): string[] {
    return ["default-test"]
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      typeKey: this.typeKey,
      version: this.version,
      hostname: this.hostname,
      config: this.config,
      connected: this.connected,
      connecting: this.connecting
    }
  }
}
