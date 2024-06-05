import { getLogger } from "../framework/Log"
import Service from "../framework/Service"
import ServoMove from "../models/ServoMove"
import RobotLabXRuntime from "./RobotLabXRuntime"

const log = getLogger("Servo")

export default class Servo extends Service {
  config = {
    autoDisable: true,
    controller: "",
    center: 90,
    idleTimeout: 3000,
    speed: 50.0,
    pin: "9"
  }

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
    return new ServoMove(this.id, this.name, this.config.pin, degrees, speed, null)
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
    this.removeListener("publishServoMoveTo", controller, "onServoMoveTo")
  }

  /**
   *  Set the controller for the servo
   * @param controller
   * @example ["uno"]
   */
  setController(controller: string): void {
    this.addListener("publishServoMoveTo", controller, "onServoMoveTo")
  }

  /**
   *  Set the current pin for the servo
   * @returns pin
   */
  setPin(pin: string): void {
    this.config.pin = pin
  }
}
