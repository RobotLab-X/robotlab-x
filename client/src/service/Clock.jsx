import { Button, Typography } from "@mui/material"
import React, { useEffect, useState } from "react"
// import ReactJson from "react-json-view"
import { useStore } from "../store/store"

export default function Clock({ name, fullname, id }) {
  console.info(`Clock ${fullname}`)

  const { subscribeTo, unsubscribeFrom, useMessage } = useStore()

  // msg event callbacks
  const epochMsg = useMessage(fullname, "publishEpoch")

  const [timestamp, setTimestamp] = useState(null)
  const sendTo = useStore((state) => state.sendTo)

  useEffect(() => {
    // put subscribes here
    subscribeTo(fullname, "publishEpoch")
    return () => {
      // unsubscribe here
      // Cleanup on unmount
      unsubscribeFrom(fullname, "publishEpoch")
    }
  }, [subscribeTo, unsubscribeFrom, fullname])

  // Set and memoize the epoch message
  useEffect(() => {
    if (epochMsg) {
      console.log("new message:", epochMsg)
      setTimestamp(epochMsg.data[0])
    }
  }, [epochMsg])

  const handleStart = () => {
    // TODO add interval
    sendTo(fullname, "startClock")
  }

  const handleStop = () => {
    sendTo(fullname, "stopClock")
  }

  return (
    <>
      {epochMsg ? (
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
      {/*
      <ReactJson src={jsonData} name="epochMsg" />
      */}
    </>
  )
}
