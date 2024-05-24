// MyRobotLabProxy.jsx
import { Typography } from "@mui/material"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

// FIXME remove fullname with context provider
export default function MyRobotLabProxy({ name, fullname, id }) {
  const { useMessage, sendTo } = useStore()

  // makes reference to the message object in store
  const epochMsg = useMessage(fullname, "publishEpoch")

  // creates subscriptions to topics and returns the broadcastState message reference
  const serviceMsg = useServiceSubscription(fullname, ["publishEpoch"])

  // processes the msg.data[0] and returns the data
  const service = useProcessedMessage(serviceMsg)

  return (
    <>
      <Typography variant="h6">My Robot Lab Service</Typography>
    </>
  )
}
