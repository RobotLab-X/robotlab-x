import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"
import { useProcessedMessage } from "./useProcessedMessage"

const useServiceMethods = (fullname) => {
  const { useMessage } = useStore()
  useServiceSubscription(fullname, ["getMethods"])
  const message = useMessage(fullname, "getMethods")
  const processedMessage = useProcessedMessage(message)
  return processedMessage
}

export default useServiceMethods
