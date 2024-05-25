import Message from "express/models/Message"

export default interface Gateway {
  sendRemote(gatewayRouteId: string, msg: Message): void
}
