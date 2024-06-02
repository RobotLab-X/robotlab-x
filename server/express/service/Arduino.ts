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
  protected pins: string[] = []

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

      // get board info
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

      // get pin info
      this.getPinInfo()

      log.info(`Board info: ${JSON.stringify(this.boardInfo)}`)
      this.invoke("broadcastState")
    } else {
      log.error("Board is not ready")
    }
    return this.boardInfo
  }

  public getPinInfo(): any {
    if (!this.board || !this.board.isReady) {
      log.error("Board is not ready")
      return null
    }

    this.pins = this.board.io.pins.map((pin: any, index: number) => {
      return {
        index,
        supportedModes: pin.supportedModes,
        mode: pin.mode,
        value: pin.value
      }
    })

    // If your board has string identifiers for pins, create a dictionary
    // const pinDictionary = {};
    // for (const pin of pinInfo) {
    //   pinDictionary[`pin${pin.index}`] = pin;
    // }

    // If the board has numeric pin identifiers, return an array
    // return Array.isArray(this.board.io.pins) ? pinInfo : pinDictionary;
    return this.pins
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
      ready: this.ready,
      pins: this.pins
    }
  }
}
