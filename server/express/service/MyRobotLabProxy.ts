import Service from "../framework/Service"
export default class MyRobotLabProxy extends Service {
  public uniqueId = "WOOT!"

  constructor(
    public id: string,
    public name: string,
    public typeKey: string,
    public version: string,
    public hostname: string
  ) {
    super(id, name, typeKey, version, hostname) // Call the base class constructor if needed
  }

  onUptime(msg: string): string {
    console.log(`WOOOHOOO !!! ${this.name}.onUptime called ${msg}`)
    return msg
  }
}
