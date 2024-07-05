import ServoMove from "express/models/ServoMove"
import { readdir } from "fs"
import { Board, Pin, Servo } from "johnny-five"
import { platform } from "os"
import { SerialPort } from "serialport"
import { promisify } from "util"
import { getLogger } from "../framework/Log"
import Service from "../framework/Service"

const readdirAsync = promisify(readdir)
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

  protected servosImpl: { [id: string]: Servo } = {}

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

  stopService(): void {
    this.disconnect()
    super.stopService()
  }

  connect(port: string): void {
    try {
      log.info(`Connecting to port: ${port}`)

      if (this.serialPort && port !== this.config.port) {
        log.info("Already connected to a port. Disconnecting.")
        this.disconnect()
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

      this.board.on("error", (err: any) => {
        console.error("Board error:", err)
        this.disconnect()
      })

      this.board.on("fail", (event: any) => {
        console.error("Board fail:", event.message)
        this.disconnect()
      })

      this.board.on("info", (event: any) => {
        console.log("Board info:", event.message)
      })
    } catch (error) {
      log.error(`Error connecting to board: ${error}`)
    }
  }

  disconnect(): void {
    try {
      if (this.serialPort && this.serialPort.isOpen) {
        log.error("Closing serial port !!!!!!!!!!")
        this.serialPort.close()
      }
      this.ready = false
      // delete this.board ... frustrating
      this.board = null
      this.serialPort = null
      this.invoke("broadcastState")
    } catch (error) {
      log.error(`Error disconnecting from board:${error}`)
    }
  }

  public async getPorts(): Promise<string[]> {
    try {
      if (platform() === "linux") {
        const files = await readdirAsync("/dev")
        this.ports = files.filter((file) => file.startsWith("ttyACM")).map((file) => `/dev/${file}`)
      } else {
        const portList = await SerialPort.list()
        this.ports = portList.map((port: any) => port.path).filter((path: any) => !path.startsWith("/dev/ttyS"))
      }
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

  servoWrite(pin: string, value: number): void {
    log.info(`Servo writing to pin ${pin} value: ${value}`)

    // create a servo if it doesn't already exist
    if (this.ready && !this.servosImpl[pin]) {
      const servo = new Servo({
        pin,
        board: this.board
      })
      this.servosImpl[pin] = servo
    } else if (this.ready && this.servosImpl[pin]) {
      // this.servosImpl[pin].to(value, 3000)  pos, [ms], [rate]
      this.servosImpl[pin].to(value)
    } else {
      log.error(`cannot write to servo ready: ${this.ready} servo: ${this.servosImpl[pin]}`)
    }
  }

  onServoMoveTo(servoMove: ServoMove): void {
    this.servoWrite(servoMove.pin, servoMove.degrees)
  }
  toJSON() {
    return {
      ...super.toJSON(),
      ports: this.ports,
      boardInfo: this.boardInfo,
      ready: this.ready,
      pins: this.pins,
      boardType: this.boardType
    }
  }
}
