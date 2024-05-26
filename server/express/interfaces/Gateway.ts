import Message from "express/models/Message"

export default interface Gateway {
  sendRemote(msg: Message): any
}
