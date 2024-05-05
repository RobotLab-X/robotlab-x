import CodecUtil from "../framework/CodecUtil"
import { useStore } from "./store"

export const useServiceStore = (fullname, method) => {
  const subscribeTo = useStore((state) => state.subscribeTo)
  const unsubscribeFrom = useStore((state) => state.unsubscribeFrom) // Assuming you have this function available in your store
  const epochMsg = useStore((state) => state.messages[`${fullname}.${CodecUtil.getCallbackTopicName(method)}`])
  return { subscribeTo, unsubscribeFrom, epochMsg }
}
