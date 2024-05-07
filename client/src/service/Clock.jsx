// Clock.jsx
import { Button, Typography } from "@mui/material"
import React, { useEffect, useState } from "react"
import ReactJson from "react-json-view"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

export default function Clock({ fullname }) {
  const { useMessage, sendTo } = useStore()
  const epochMsg = useMessage(fullname, "publishEpoch")

  const serviceMsg = useServiceSubscription(fullname, ["publishEpoch"])

  const [timestamp, setTimestamp] = useState(null)
  const [service, setService] = useState({})

  useEffect(() => {
    if (epochMsg) {
      console.log("new epoch message:", epochMsg)
      setTimestamp(epochMsg.data[0])
    }
    if (serviceMsg) {
      console.log("new service message:", serviceMsg)
      setService(serviceMsg.data[0])
    }
  }, [epochMsg, serviceMsg])

  const handleStart = () => {
    sendTo(fullname, "startClock")
  }

  const handleStop = () => {
    sendTo(fullname, "stopClock")
  }

  return (
    <>
      <Typography variant="h6">Clock: {fullname}</Typography>
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
