// hooks/useServiceSubscription.js
import { useEffect } from "react"
import { useStore } from "../store/store"

const useServiceSubscription = (fullname, additionalSubscriptions = []) => {
  const { subscribeTo, unsubscribeFrom, useMessage, sendTo } = useStore()
  const serviceMsg = useMessage(fullname, "broadcastState")

  useEffect(() => {
    // Subscribe to broadcastState and any additional topics
    subscribeTo(fullname, "broadcastState")
    additionalSubscriptions.forEach((sub) => {
      subscribeTo(fullname, sub)
    })

    // Send the broadcastState request once on mount
    sendTo(fullname, "broadcastState")
    // console.error(`useServiceSubscription: ${fullname}`)

    // Unsubscribe on component unmount
    return () => {
      unsubscribeFrom(fullname, "broadcastState")
      additionalSubscriptions.forEach((sub) => {
        unsubscribeFrom(fullname, sub)
      })
    }
  }, [subscribeTo, unsubscribeFrom, sendTo, fullname]) // Removed additionalSubscriptions from dependencies to prevent re-triggering

  return serviceMsg
}

export default useServiceSubscription
