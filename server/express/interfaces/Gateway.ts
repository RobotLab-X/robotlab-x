import Message from "../models/Message"

export default interface Gateway {
  sendRemote(msg: Message): any
}
