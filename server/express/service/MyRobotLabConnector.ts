import WebSocket from "ws" // Import WebSocket module
import { getLogger } from "../framework/Log"
import Service from "../framework/Service"
import Message from "../models/Message"
import MyRobotLabProxy from "../service/MyRobotLabProxy"
import RobotLabXRuntime from "../service/RobotLabXRuntime"

const log = getLogger("MyRobotLabConnector")
export default class MyRobotLabConnector extends Service {
  private webSocket?: WebSocket = null // Optional WebSocket object

  connecting: boolean = false

  connected: boolean = false

  mrlId: string = null

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
  }

  disconnect() {
    log.info(`disconneting from ${this.config.wsUrl}`)

    if (this.webSocket) {
      this.webSocket.close()
    }
    this.webSocket = null
    this.connected = false
    this.connecting = false
    this.invoke("broadcastState")
  }

  // Method to establish a WebSocket connection
  connect(wsUrl: string): void {
    log.info(`Attempting to connect to ${wsUrl}`)
    this.config.wsUrl = wsUrl

    if (this.connecting || this.connected) {
      log.error("Already connected or connecting")
      return
    }
    this.connected = false
    this.connecting = true

    if (this.webSocket) {
      log.info("Already connected")
      return
    }

    // Initialize WebSocket connection
    this.webSocket = new WebSocket(wsUrl)

    const that = this
    // Event handler when connection is open
    this.webSocket.on("open", () => {
      log.info("Connection successful!")
      this.connecting = false
      this.connected = true
      const runtime: RobotLabXRuntime = RobotLabXRuntime.getInstance()

      // FIXME - can possibly have a "temporary" holding area for connections
      // until a remoteId is established
      // CANNOT BE ADDED UNTIL WE HAVE A REMOTE ID
      // Store.getInstance().addClientConnection(remoteId, wsUrl, this.webSocket)
      // runtime.addConnection()
      // runtime.addRoute(this)

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
      this.invoke("broadcastState")
    })
  }

  /**
   * me <--- mrl method to handle received messages from mrl instance
   * Decode the message (twice) and address and route it to the correct service
   * @param message
   * @returns
   */
  private onMessageReceived(message: string) {
    try {
      // double decode
      let msg = JSON.parse(message)
      if (msg.data) {
        for (let i = 0; i < msg.data.length; i++) {
          msg.data[i] = JSON.parse(msg.data[i])
        }
      }

      log.info(`---> ${this.name} <--- mrl ${msg.name}.${msg.method} from ${msg.sender}`)

      if (msg.method == "onServiceNames") {
        this.onServiceNames(msg)
      } else if (msg.method == "describe") {
        log.info("describe message")
      } else if (msg.method == "addListener") {
        log.info("addListener message")
      } else if (msg.method == "onService") {
        let mrlService = msg.data[0]

        if (mrlService.name == "runtime") {
          RobotLabXRuntime.getInstance().registerConnection(
            this.fullname,
            mrlService.id,
            this.config.wsUrl,
            "outbound",
            this.webSocket
          )
        }

        // FIXME - try to make "unknown" type
        // THIS IS REALLY JUST A PLACE HOLDER WITH NAME AND ID INFO

        let service: MyRobotLabProxy = new MyRobotLabProxy(
          mrlService.id,
          mrlService.name,
          "MyRobotLabProxy",
          "0.0.1",
          "unknown"
        )

        this.mrlId = mrlService.id
        // service.service = mrlService
        service.proxyTypeKey = mrlService?.serviceType?.simpleName ?? "Unknown"
        service.connectorName = this.name
        service.connectorId = this.id
        // TODO - add MrlType to the root of the MyRobotLabProxy
        log.info(`==== proxy registering ${JSON.stringify(mrlService.name)} ====`)
        RobotLabXRuntime.getInstance().register(service)
      } else {
        log.error(
          `---> message for proxy: sender ${msg.sender} (${msg.name}.${msg.method} <--- ${msg.sender} ${JSON.stringify(msg.data)}`
        )
        this.invokeMsg(msg)
        // MRL identifies this proxy as "name":"runtime@webgui-client" ... which it broadcasts to all
        // not willing to fix it !!!

        // Make a RLX proxy message wrapper for the decoded MRL message

        // Address the message correctly (mrl does not address the message correctly)
        // So the connector must maintain a notifyList for all mrl services
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

  getConfigName(): string {
    return "default-test"
  }

  getConfigList(): string[] {
    return ["default-test"]
  }

  /**
   * rlx ---> mrl
   * Encode the message and send it to the mrl remote process
   * @param msg rlx message
   */
  public sendRemote(msg: Message): any {
    // Message sent to proxy service
    log.error(`mrl <--- rlx sendRemote name ${msg.name} method ${msg.method} data ${msg.data ?? ""}`)
    // let proxy: Service = RobotLabXRuntime.getInstance().getService(msg.name)
    // proxy.invoke("onMessage", msg)

    // Encode each item in the msg.data array
    if (msg.data) {
      msg.data = msg.data.map((item) => JSON.stringify(item))
    }

    // Message sent to remote service
    let json = JSON.stringify(msg)
    this.webSocket.send(json)
    return null
  }

  publishMessage(mrlMessage: any) {
    return mrlMessage
  }

  toJSON() {
    return {
      ...super.toJSON(),
      connected: this.connected,
      connecting: this.connecting,
      mrlId: this.mrlId
    }
  }
}
