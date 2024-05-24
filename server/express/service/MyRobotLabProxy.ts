import Service from "../framework/Service"
export default class MyRobotLabProxy extends Service {
  // MRL Service definition
  public service: any = null

  constructor(
    public id: string,
    public name: string,
    public typeKey: string,
    public version: string,
    public hostname: string
  ) {
    super(id, name, typeKey, version, hostname)
  }
}
