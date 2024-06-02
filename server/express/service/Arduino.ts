import { Board, Servo } from "johnny-five"
import { SerialPort } from "serialport"
import { getLogger } from "../framework/Log"
import Service from "../framework/Service"

const log = getLogger("Arduino")

export default class Arduino extends Service {
  config = {
    intervalMs: 1000,
    port: ""
  }

  protected board: Board = null
  protected boardInfo: any = null
  protected servo: Servo = null
  protected ports: string[] = []

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
    this.ready = false // not ready until board is connected
    this.getPorts()
  }

  // TODO attach("servo", Servo, { pin: 10 })

  connect(port: string): void {
    log.info(`Connecting to port: ${port}`)
    this.config.port = port

    const serialport = new SerialPort({
      baudRate: 57600,
      highWaterMark: 256,
      path: port
    })

    // if (this.board) {
    //   this.board.io.transport.close()
    //   this.board = null
    // }

    if (!this.board) {
      this.board = new Board({
        //         port: this.config.port,
        port: serialport,
        repl: false
      })
    }

    this.board.on("ready", () => {
      this.ready = true
      this.getBoardInfo()
      this.invoke("broadcastState")
    })

    // if (this.board.isReady) {
    //   console.log("Board is ready")

    //   // Create a new servo instance on pin 10
    //   const servo = new Servo(9)

    //   // Move the servo to 90 degrees
    //   servo.to(90)

    //   // Add your other servo control logic here
    //   this.board.wait(1000, () => {
    //     servo.to(120)
    //   })

    //   this.board.wait(2000, () => {
    //     servo.to(10)
    //   })
    // } else {
    //   log.error("Board is not ready")
    // }
  }

  moveTo(degrees: number): void {
    if (this.servo) {
      this.servo.to(degrees)
    }
  }

  disconnect(): void {
    this.board?.io?.close()
    this.ready = false
    this.board = null
    this.invoke("broadcastState")
  }

  public async getPorts(): Promise<string[]> {
    try {
      const portList = await SerialPort.list()
      this.ports = portList.map((port) => port.path)
      return this.ports
    } catch (error) {
      console.error("Error listing serial ports:", error)
      throw error
    }
  }

  public getBoardInfo(): any {
    log.info("Getting board info")

    if (this.board && this.board.isReady) {
      // const board = new Board({ port, repl: false });

      this.boardInfo = {
        id: this.board.id,
        port: this.board.port,
        io: {
          name: this.board.io.name,
          serialNumber: this.board.io.serialNumber,
          firmwareVersion: this.board.io.firmwareVersion,
          version: `${this.board.io.firmware.version.major}.${this.board.io.firmware.version.minor}`
        },
        serialNumber: this.board.io.serialNumber
      }
      log.info(`Board info: ${JSON.stringify(this.boardInfo)}`)
      this.invoke("broadcastState")
    } else {
      log.error("Board is not ready")
    }
    return this.boardInfo
  }

  // Not sure if this is the best way to exclude members from serialization
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      typeKey: this.typeKey,
      version: this.version,
      hostname: this.hostname,
      config: this.config,
      notifyList: this.notifyList,
      ports: this.ports,
      boardInfo: this.boardInfo,
      ready: this.ready
    }
  }
}
