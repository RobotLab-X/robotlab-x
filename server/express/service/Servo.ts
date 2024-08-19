import { getLogger } from "../framework/Log"
import Service from "../framework/Service"
import ServoMove from "../models/ServoMove"
import RobotLabXRuntime from "./RobotLabXRuntime"

const log = getLogger("Servo")

export default class Servo extends Service {
  config = {
    autoDisable: true,
    controller: "",
    enabled: true,
    rest: 90,
    idleTimeout: 3000,
    speed: 50.0,
    pin: "",
    min: 0,
    max: 180
  }

  lastActivityTs: number = null

  constructor(
    public id: string,
    public name: string,
    public typeKey: string,
    public version: string,
    public hostname: string
  ) {
    super(id, name, typeKey, version, hostname)
  }

  /**
   *  Move the servo to a specific position at a specific speed
   * @param degrees - required position to move to
   * @param speed - optional if not supplied config.speed is used
   */
  moveTo(degrees: number, speed?: number): void {
    if (speed) {
      this.config.speed = speed
    }
    log.info(`Servo.moveTo: Moving to ${degrees} degrees at speed ${this.config.speed}`)
    if (!this.config.enabled) {
      log.info(`Servo.moveTo: Disabled - not moving`)
      return
    }
    this.invoke("publishServoMoveTo", degrees, this.config.speed)
  }

  /**
   * Attach the servo to a specific controller
   * @param controller - controller to attach to
   * @example ["uno"]
   */
  attach(controller: string): void {
    log.info(`Servo.attach: Attaching to controller ${controller}`)
    // FIXME !!! - not a "single" controller - publish like all other services !!!!
    this.config.controller = controller
    this.addListener("publishServoMoveTo", controller, "onServoMoveTo")
  }

  /**
   * Publishing point for a Servo move - invoked internally
   * @param degrees
   * @param speed
   * @returns
   */
  publishServoMoveTo(degrees: number, speed?: number): ServoMove {
    log.info(`Servo.publishServoMoveTo: Moving to ${degrees} degrees at speed ${speed}`)
    this.lastActivityTs = new Date().getTime()
    return new ServoMove(this.id, this.name, this.config.pin, degrees, speed, null)
  }

  /**
   * Min and max of input range
   * @param min
   * @param max
   */
  setMinMax(min: number, max: number) {
    this.config.min = min
    this.config.max = max
  }

  /**
   * Get the current set of possible controllers
   * @returns names of the controllers
   */
  getServoControllers(): string[] {
    return RobotLabXRuntime.getInstance().getServicesFromInterface("onServoMoveTo")
  }

  /**
   *  Remove the servo from a specific controller
   * @param controller
   * @example ["uno"]
   */
  removeController(controller: string): void {
    if (this.config.controller === controller) {
      this.config.controller = null
    }
    this.removeListener("publishServoMoveTo", controller, "onServoMoveTo")
  }

  /**
   *  Set the controller for the servo
   * @param controller
   * @example ["uno"]
   */
  setController(controller: string): void {
    log.info(`Servo.setController: Setting controller to ${controller}`)
    this.config.controller = controller
    this.addListener("publishServoMoveTo", controller, "onServoMoveTo")
  }

  /**
   *  Set the current pin for the servo
   * @returns pin
   */
  setPin(pin: string): void {
    this.config.pin = pin
  }

  setSpeed(speed: number): void {
    this.config.speed = speed
  }

  /**
   * Set the current rest position for the servo
   * @param rest - position to set the rest to
   */
  setRest(rest: number): void {
    this.config.rest = rest
  }

  /**
   * A position set by the user to be the rest position of the servo
   */
  rest(): void {
    this.moveTo(this.config.rest)
  }

  enable() {
    this.config.enabled = true
  }

  disable() {
    this.config.enabled = false
  }

  isEnabled() {
    return this.config.enabled
  }

  setEnabled(enabled: boolean) {
    this.config.enabled = enabled
  }
}
