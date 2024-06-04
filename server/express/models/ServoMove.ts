export default class ServoMove {
  // id of the process of the servo
  public id: string | null = null
  // name of the servo
  public name: string | null = null

  // Johnny-Five has string or number ... should just be string
  public pin: string | null = null

  public degrees: number | null = null
  public speed: number | null = null
  public steps: number | null = null

  constructor(id: string, name: string, degrees: number, speed: number, steps: number) {
    this.id = id
    this.name = name
    this.degrees = degrees
    this.speed = speed
    this.steps = steps
  }
}
