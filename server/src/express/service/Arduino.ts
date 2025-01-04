import { readdir } from "fs"
import { Board, Pin, Servo } from "johnny-five"
import { platform } from "os"
import { SerialPort } from "serialport"
import { promisify } from "util"
import { getLogger } from "../framework/LocalLog"
import Service from "../framework/Service"
import ServoMove from "../models/ServoMove"
const pixel = require("node-pixel")

const readdirAsync = promisify(readdir)
const log = getLogger("Arduino")

// FIXME - move to NeoPixel.ts
interface Flash {
  pin: string
  color: any
  interval: number
  repetitions: number
  type?: string // default is "simple"
  pixels?: number[] // If null or empty, flash all pixels; otherwise, flash specified pixels
}

/**
 * Arduino service class using the johnny-five library
 * to communicate with an Arduino board
 * https://johnny-five.io/api/servo/
 * https://johnny-five.io/api/pin/
 */
export default class Arduino extends Service {
  config = {
    // port string
    port: "",
    connect: false // if true, connect to the port on start
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

  protected neopixelsImpl: { [id: string]: any } = {}

  protected boardType: string = ""

  /**
   * Serial port instance
   */
  protected serialPort: SerialPort = null

  private neoPixelStates: Map<string, { flashInterval?: NodeJS.Timeout; [key: string]: any }> = new Map()

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

  applyConfig(config: any) {
    console.log("applyConfig", config)
    super.applyConfig(config)
    if (this.config.connect) {
      this.connect(config.port)
    }
  }

  connect(port: string): void {
    try {
      log.info(`Connecting to port: ${port}`)

      if (this.serialPort && port !== this.config.port) {
        log.info("Already connected to a port. Disconnecting.")
        this.disconnect()
      }

      if (!port) {
        log.warn("No port specified.")
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
    this.config.connect = true
  }

  disconnect(): void {
    try {
      this.config.connect = false
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

  async getPorts(): Promise<string[]> {
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

  getBoardInfo(): any {
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

  getPins(): any {
    return this.pins
  }

  write(pin: number, value: number): void {
    log.info(`Writing to pin ${pin} value: ${value}`)
    if (this.ready) {
      log.info(`${JSON.stringify(this.pins[pin])}`)
      this.pinsImpl[pin].write(value)
    } else {
      log.error("Board is not ready")
    }
  }

  printServoDetails(servo: any) {
    const fieldsToPrint = [
      "id",
      "pin",
      "range",
      "invert",
      // "history",
      "interval",
      "isMoving",
      "last",
      "position",
      "value",
      "startAt"
    ]

    const output: any = {}

    for (const field of fieldsToPrint) {
      // Check if the field exists on the servo object
      if (servo.hasOwnProperty(field)) {
        try {
          output[field] = servo[field]
        } catch (err) {
          output[field] = "[Error accessing field]"
        }
      } else {
        output[field] = "[Field not present]"
      }
    }

    console.log("Servo Details:")
    console.log(JSON.stringify(output, null, 2))
  }

  servoWrite(pin: string, angle: number, speed: number = null): void {
    log.info(`Servo writing to pin ${pin} value: ${angle} speed: ${speed}`)

    // create a servo if it doesn't already exist
    if (this.ready && !this.servosImpl[pin]) {
      const servo = new Servo({
        pin,
        board: this.board
      })
      this.servosImpl[pin] = servo
    } else if (this.ready && this.servosImpl[pin]) {
      // this.servosImpl[pin].to(value, 3000)  pos, [ms], [rate]

      const servo = this.servosImpl[pin]

      log.info(`Servo ${this.printServoDetails(servo)}`)

      const currentAngle = servo?.last?.degrees

      // Check if the specified angle is the same as the current angle
      if (angle === currentAngle) {
        log.info("Servo is already at the specified angle.")
        return
      }

      if (speed !== null) {
        // Calculate the distance to move and the time required based on speed
        const distance = Math.abs(angle - currentAngle)
        const ms = (distance / speed) * 1000

        // Move the servo to the target angle over the calculated time
        log.info(`Moving servo from ${servo.value} on pin ${pin} to ${angle} over ${ms} ms at ${speed} speed`)
        servo.to(angle, ms, 500)
      } else {
        // Move the servo directly to the target angle
        servo.to(angle)
      }
    } else {
      log.error(`cannot write to servo ready: ${this.ready} servo: ${this.servosImpl[pin]}`)
    }
  }

  onServoMoveTo(servoMove: ServoMove): void {
    this.servoWrite(servoMove.pin, servoMove.degrees, servoMove.speed)
  }

  onNeoPixel(pin: string, r: number, g: number, b: number, w: number) {
    console.log("onNeopixel", r, g, b, w)
    const neopixel = this.getNeoPixel(pin)
    if (neopixel) {
      neopixel.setPixelColor({ r, g, b, w })
      neopixel.show()
    } else {
      log.error(`neopixel ${pin} not found`)
    }
  }

  attachNeoPixel(pin: string, length: number) {
    if (this.neopixelsImpl[pin]) {
      return this.neopixelsImpl[pin]
    } else {
      const neopixel = new pixel.Strip({
        board: this.board,
        controller: "FIRMATA",
        strips: [{ pin: pin, length: length }] // this is preferred form for definition
        // gamma: 2.8, // set to a gamma that works nicely for WS2812
      })
      this.neopixelsImpl[pin] = neopixel
      return neopixel
    }
  }

  getNeoPixel(pin: string) {
    if (!this.neopixelsImpl[pin]) {
      log.error(`neopixel ${pin} not found`)
      return null
    }

    return this.neopixelsImpl[pin]
  }

  /**
   *
   * @param pin - pin number of the neopixel
   * @param color - can be of the form "#ff0000", "rgb(0, 255, 0)", or [255, 255, 0]
   */
  neoPixelColor(pin: string, color: any) {
    console.log("neoPixelColor", color)
    const strip = this.getNeoPixel(pin)
    if (strip) {
      strip.color(color)
      strip.show()
    } else {
      log.error(`neopixel ${pin} not found`)
    }
  }

  neoPixelSet(pin: string, number: number, color: any) {
    const strip = this.getNeoPixel(pin)
    if (strip) {
      strip.pixel(number).color(color)
      strip.show()
    } else {
      log.error(`neopixel ${pin} not found`)
    }
  }

  neoPixelFlash(flash: Flash) {
    const { pin, color, interval, repetitions, type = "simple", pixels = [] } = flash
    const strip = this.getNeoPixel(pin)

    if (!strip) {
      log.error(`neopixel ${pin} not found`)
      return
    }

    // Stop any existing animations for the given pin
    this.neoPixelOff(pin)

    let count = 0
    const flashInterval = setInterval(() => {
      if (count >= repetitions && type !== "brightness") {
        this.neoPixelOff(pin)
        return
      }

      if (type === "simple") {
        const isOn = count % 2 === 0

        if (pixels.length > 0) {
          // Flash only specified pixels
          pixels.forEach((pixelNumber) => {
            this.neoPixelSet(pin, pixelNumber, isOn ? color : [0, 0, 0])
          })
        } else {
          // Flash entire strip
          this.neoPixelColor(pin, isOn ? color : [0, 0, 0])
        }
      } else if (type === "brightness") {
        // Randomly adjust brightness while keeping the color the same
        const brightnessFactor = Math.random() * 0.5 + 0.1 // Random brightness between 50% and 100%
        const adjustedColor = Array.isArray(color) ? color.map((c) => Math.round(c * brightnessFactor)) : color

        if (pixels.length > 0) {
          pixels.forEach((pixelNumber) => {
            this.neoPixelSet(pin, pixelNumber, adjustedColor)
          })
        } else {
          this.neoPixelColor(pin, adjustedColor)
        }
      } else {
        log.warn(`Flash type "${type}" not implemented.`)
      }

      count++
    }, interval)

    // Store the state for the pin
    this.neoPixelStates.set(pin, { flashInterval })
  }

  neoPixelOff(pin: string) {
    const state = this.neoPixelStates.get(pin)

    if (state) {
      // Stop the flashing interval if it exists
      if (state.flashInterval) {
        clearInterval(state.flashInterval)
      }

      // Stop the shift interval if it exists
      if (state.shiftInterval) {
        clearInterval(state.shiftInterval)
      }

      // Turn off the strip
      const strip = this.getNeoPixel(pin)
      if (strip) {
        strip.off()
      }

      // Remove the state entry
      this.neoPixelStates.delete(pin)
    } else {
      log.error(`neopixel ${pin} not found or no active state`)
    }
  }

  neoPixelShift(pin: string, amt: number, wrap: boolean = false, interval?: number) {
    const strip = this.getNeoPixel(pin)

    if (!strip) {
      log.error(`neopixel ${pin} not found`)
      return
    }

    // Stop any existing shift interval for this pin
    // this.neoPixelOff(pin)

    const shiftPixels = () => {
      if (amt > 0) {
        log.info(`neopixel ${pin} shifting ${amt} forward`)
        strip.shift(amt, pixel.FORWARD, wrap)
      } else if (amt < 0) {
        log.info(`neopixel ${pin} shifting ${amt} backward`)
        strip.shift(Math.abs(amt), pixel.BACKWARD, wrap)
      }
      strip.show()
    }

    // Perform initial shift
    shiftPixels()

    // If interval is set, create a repeating shift interval
    let shiftIntervalId: NodeJS.Timeout | null = null
    if (typeof interval === "number" && interval > 0) {
      shiftIntervalId = setInterval(shiftPixels, interval)
    }

    // Store the shift interval in neoPixelStates
    this.neoPixelStates.set(pin, { shiftInterval: shiftIntervalId })
  }

  // neoPixelFade(pin: string, color: any, time: number) {
  //   const strip = this.getNeoPixel(pin)
  //   if (strip) {
  //     strip.fade(color, time)
  //     strip.show()
  //   } else {
  //     log.error(`neopixel ${pin} not found`)
  //   }
  // }

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
