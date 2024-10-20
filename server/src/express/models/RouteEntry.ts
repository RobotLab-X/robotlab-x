export default class RouteEntry {
  public remoteId: string
  public gatewayId: string
  public gateway: string

  constructor(remoteId: string, gatewayId: string, gateway: string) {
    this.remoteId = remoteId
    this.gatewayId = gatewayId
    console.error(`RouteEntry gateway ${gateway}`)
    this.gateway = gateway
  }
}
