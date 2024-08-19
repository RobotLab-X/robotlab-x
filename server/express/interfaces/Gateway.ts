import Message from "../models/Message"

export default interface Gateway {
  fullname: string
  sendRemote(msg: Message): any
}
