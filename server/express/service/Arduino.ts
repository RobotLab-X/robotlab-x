import { Board, Pin, Servo } from "johnny-five"
import { SerialPort } from "serialport"
import { getLogger } from "../framework/Log"
import Service from "../framework/Service"

const log = getLogger("Arduino")
/**
 * Arduino service class using the johnny-five library
 * to communicate with an Arduino board
 * https://johnny-five.io/api/servo/
 * https://johnny-five.io/api/pin/
 */
export default class Arduino extends Service {
  config = {
    intervalMs: 1000,
    // port string
    port: ""
  }

  protected board: Board = null
  protected boardInfo: any = null
  protected servo: Servo = null
  /**
   * list of ports available on the host
   */
  protected ports: string[] = []

  /**
   * serializable list of pins on the board
   */
  protected pins: any[] = []

  /**
   * non serializable list of pins on the board
   */
  protected pinsImpl: Pin[] = []

  protected boardType: string = ""

  /**
   * Serial port instance
   */
  protected serialPort: SerialPort = null

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

  connect(port: string): void {
    try {
      log.info(`Connecting to port: ${port}`)

      if (this.serialPort) {
        log.info("Already connected to a port. Disconnecting first.")
        return
      }

      this.config.port = port

      const serialport = new SerialPort({
        baudRate: 57600,
        // The size of the read and write buffers defaults to 64k.
        highWaterMark: 256,
        path: port
      })

      this.serialPort = serialport

      if (!this.board) {
        this.board = new Board({
          port: serialport,
          repl: false
        })
      }

      this.board.on("ready", () => {
        this.ready = true
        this.getBoardInfo()
        this.invoke("broadcastState")
      })

      this.board.on("error", (err) => {
        console.error("Board error:", err)
        this.disconnect()
      })

      this.board.on("fail", (event) => {
        console.error("Board fail:", event.message)
        this.disconnect()
      })

      this.board.on("info", (event) => {
        console.log("Board info:", event.message)
      })
    } catch (error) {
      log.error(`Error connecting to board: ${error}`)
    }
  }

  moveTo(degrees: number): void {
    if (this.servo) {
      this.servo.to(degrees)
    }
  }

  disconnect(): void {
    try {
      if (this.serialPort && this.serialPort.isOpen) {
        this.serialPort.close()
      }
      this.ready = false
      this.board = null
      this.serialPort = null
      this.invoke("broadcastState")
    } catch (error) {
      log.error(`Error disconnecting from board:${error}`)
    }
  }

  public async getPorts(): Promise<string[]> {
    try {
      const portList = await SerialPort.list()
      this.ports = portList.map((port) => port.path).filter((path) => !path.startsWith("/dev/ttyS"))
      return this.ports
    } catch (error) {
      console.error("Error listing serial ports:", error)
      throw error
    }
  }

  public getBoardInfo(): any {
    log.info("Getting board info")

    if (this.board && this.board.isReady) {
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

      const pinCount = this.board.io.pins.length

      if (pinCount === 20) {
        this.boardType = "Uno"
      } else if (pinCount === 70) {
        this.boardType = "Mega"
      } else if (this.board.io.name.includes("Arduino") && pinCount === 14) {
        this.boardType = "Nano" // or Micro
      } else {
        this.boardType = "Unknown"
      }

      this.createPins()

      log.info(`Board info: ${JSON.stringify(this.boardInfo)}`)
      this.invoke("broadcastState")
    } else {
      log.error("Board is not ready")
    }
    return this.boardInfo
  }

  private createPins(): any {
    if (!this.board || !this.board.isReady) {
      log.error("Board is not ready")
      return null
    }

    this.pins = this.board.io.pins.map((pin: any, index: number) => {
      return {
        index,
        supportedModes: pin.supportedModes,
        mode: pin.mode,
        value: pin.value,
        state: pin.state
      }
    })

    this.pinsImpl = this.board.io.pins.map((pinDescription: any, index: number) => {
      return new Pin(index)
    })

    return this.pins
  }

  public getPins(): any {
    return this.pins
  }

  public write(pin: number, value: number): void {
    log.info(`Writing to pin ${pin} value: ${value}`)
    if (this.ready) {
      log.info(`${JSON.stringify(this.pins[pin])}`)
      this.pinsImpl[pin].write(value)
    } else {
      log.error("Board is not ready")
    }
  }

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
      ready: this.ready,
      pins: this.pins,
      boardType: this.boardType
    }
  }
}
