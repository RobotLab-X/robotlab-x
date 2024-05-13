// Clock.jsx
import { Button, Typography } from "@mui/material"
import ReactJson from "react-json-view"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

// FIXME remove fullname with context provider
export default function Clock({ fullname }) {
  const { useMessage, sendTo } = useStore()

  // makes reference to the message object in store
  const epochMsg = useMessage(fullname, "publishEpoch")

  // creates subscriptions to topics and returns the broadcastState message reference
  const serviceMsg = useServiceSubscription(fullname, ["publishEpoch"])

  // processes the msg.data[0] and returns the data
  const service = useProcessedMessage(serviceMsg)
  const timestamp = useProcessedMessage(epochMsg)

  const handleStart = () => {
    sendTo(fullname, "startClock")
  }

  const handleStop = () => {
    sendTo(fullname, "stopClock")
  }

  return (
    <>
      {timestamp ? (
        <>
          <Typography variant="h6">Current Timestamp (ms): {timestamp}</Typography>
          <Typography variant="h6">Formatted Date/Time: {new Date(timestamp).toLocaleString()}</Typography>
        </>
      ) : (
        <Typography variant="h6">No timestamp available</Typography>
      )}
      <Button variant="contained" color="primary" onClick={handleStart}>
        Start
      </Button>
      <Button variant="contained" color="secondary" onClick={handleStop} style={{ marginLeft: "8px" }}>
        Stop
      </Button>
      <ReactJson src={service} name="service" />
    </>
  )
}
