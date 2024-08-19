import { useEffect, useState } from "react"
import { useStore } from "store/store"

const useSubscription = (fullname, topic, init = false) => {
  const { subscribeTo, unsubscribeFrom, useMessage, sendTo } = useStore()
  const message = useMessage(fullname, topic)
  const [processedMessage, setProcessedMessage] = useState(null)

  useEffect(() => {
    if (!fullname) {
      console.error("fullname null in useSubscription!")
      return null
    }

    // Subscribe to the main topic
    subscribeTo(fullname, topic)

    // Send the initial request for the main topic
    if (init) {
      sendTo(fullname, topic)
    }

    return () => {
      // Unsubscribe from the main topic on unmount
      // don't unsubscribe until minimally you have a reference count on each topic
      // unsubscribeFrom(fullname, topic)
    }
  }, [subscribeTo, unsubscribeFrom, sendTo, fullname, topic])

  useEffect(() => {
    if (message) {
      // Process the received message
      setProcessedMessage(message?.data[0])
    }
  }, [message])

  return processedMessage
}

export default useSubscription
