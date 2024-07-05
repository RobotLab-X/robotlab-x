import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import { Box, Button, TextField, Typography } from "@mui/material"
import React, { useState } from "react"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

// FIXME remove fullname with context provider
export default function Clock({ fullname }) {
  console.info(`Clock ${fullname}`)

  const [editMode, setEditMode] = useState(false)
  const { useMessage, sendTo } = useStore()
  // makes reference to the message object in store
  const epochMsg = useMessage(fullname, "publishEpoch")
  // creates subscriptions to topics and returns the broadcastState message reference
  const serviceMsg = useServiceSubscription(fullname, ["publishEpoch"])
  // processes the msg.data[0] and returns the data
  const service = useProcessedMessage(serviceMsg)
  const timestamp = useProcessedMessage(epochMsg)

  const toggleEditMode = () => {
    setEditMode(!editMode)
  }

  const handleStart = () => {
    sendTo(fullname, "startClock")
  }

  const handleStop = () => {
    sendTo(fullname, "stopClock")
  }

  // FIXME put all Configuration in a Component
  // can handle any config field change if the edit name matches the config name
  const handleConfigChange = (event) => {
    const { name, value, type } = event.target
    const newValue = type === "number" ? Number(value) : value
    // service?.config.intervalMs = newValue
    // setConfig((prevConfig) => ({
    //   ...prevConfig,
    //   [name]: newValue
    // }))
  }

  const handleSaveConfig = () => {
    // sendTo(fullname, "applyConfig", config)
    // sendTo(fullname, "saveConfig")
    // sendTo(fullname, "broadcastState")
    setEditMode(false)
  }

  let dateStr = (timestamp && new Date(timestamp).toLocaleString()) || ""

  return (
    <>
      <h3 style={{ display: "flex", alignItems: "center", cursor: "pointer" }} onClick={toggleEditMode}>
        Configuration
        {editMode ? <ExpandLessIcon /> : <ExpandMoreIcon />}
      </h3>
      {editMode ? (
        <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "80%" } }}>
          <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
            <TextField
              label="Interval (ms)"
              name="intervalMs"
              variant="outlined"
              fullWidth
              margin="normal"
              value={service?.config?.intervalMs}
              onChange={handleConfigChange}
              sx={{ flex: 1 }} // Ensure consistent width
            />
          </Box>

          <Box sx={{ mt: 2, display: "flex", gap: 2 }}>
            <Button variant="contained" color="primary" onClick={handleSaveConfig}>
              Save
            </Button>
          </Box>
        </Box>
      ) : null}

      <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "80%" } }}>
        <Box sx={{ m: 2 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            <span style={{ fontFamily: "Orbitron, Arial, sans-serif" }}> {dateStr}</span>
            <br />
            <span style={{ fontFamily: "Orbitron, Arial, sans-serif" }}>{timestamp}</span>
            <br />
            Interval {service?.config.intervalMs}&nbsp; (ms)
          </Typography>
          <Box>
            <Button variant="contained" color="primary" onClick={handleStart}>
              Start
            </Button>
            <Button variant="contained" color="secondary" onClick={handleStop} sx={{ ml: 2 }}>
              Stop
            </Button>
          </Box>
        </Box>
      </Box>
    </>
  )
}
