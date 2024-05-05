import { Button, Typography } from "@mui/material"
import React, { useEffect, useState } from "react"
// import ReactJson from "react-json-view"
import { useStore } from "../store/store"
import { useServiceStore } from "../store/useServiceStore"

export default function Clock({ name, fullname, id }) {
  console.info(`Clock ${fullname}`)

  const { subscribeTo, unsubscribeFrom, epochMsg } = useServiceStore(fullname, "publishEpoch")
  const [timestamp, setTimestamp] = useState(null)
  const [epoch, setEpoch] = useState([])
  const sendTo = useStore((state) => state.sendTo)

  useEffect(() => {
    subscribeTo(name, "publishEpoch")
    return () => {
      // Cleanup on unmount
      unsubscribeFrom(name, "publishEpoch")
    }
  }, [subscribeTo, unsubscribeFrom, name])

  // Set and memoize the epoch message
  useEffect(() => {
    if (epochMsg) {
      console.log("New message:", epochMsg)
      setEpoch(epochMsg) // Directly use the new message
      setTimestamp(epochMsg.data[0])
    }
  }, [epochMsg])

  // Memoized rendering of the JSON data to optimize performance
  // const jsonData = useMemo(() => ({ epoch }), [epoch])

  const handleStart = () => {
    // TODO add interval
    sendTo(name, "startClock")
  }

  const handleStop = () => {
    sendTo(name, "stopClock")
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
      {/*
      <ReactJson src={jsonData} name="epochMsg" />
      */}
    </>
  )
}
