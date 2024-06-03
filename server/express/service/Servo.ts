import { getLogger } from "../framework/Log"
import Service from "../framework/Service"
import ServoMove from "../models/ServoMove"

const log = getLogger("Servo")

export default class Servo extends Service {
  config = {
    autoDisable: true,
    controller: "",
    center: 90,
    idleTimeout: 3000,
    speed: 50.0,
    pin: 9
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

  public moveTo(degrees: number, speed?: number): void {
    if (speed) {
      this.config.speed = speed
    }
    log.info(`Servo.moveTo: Moving to ${degrees} degrees at speed ${this.config.speed}`)
    this.invoke("moveTo", degrees, this.config.speed)
  }

  public publishServoMoveTo(degrees: number, speed?: number): ServoMove {
    return new ServoMove(this.id, this.name, degrees, speed, null)
  }
}
