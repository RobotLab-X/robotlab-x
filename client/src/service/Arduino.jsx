import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import { Box, Button, Paper, TextField, Typography } from "@mui/material"
import React, { useState } from "react"
import SerialPortSelector from "../components/serialport/SerialPortSelector"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

// FIXME remove fullname with context provider
export default function Arduino({ fullname }) {
  const [editMode, setEditMode] = useState(false)

  const { useMessage, sendTo } = useStore()

  // makes reference to the message object in store
  const digitalReadMsg = useMessage(fullname, "digitalRead")

  // creates subscriptions to topics and returns the broadcastState message reference
  const serviceMsg = useServiceSubscription(fullname, ["analogRead", "digitalRead"])

  // processes the msg.data[0] and returns the data
  const service = useProcessedMessage(serviceMsg)
  const digitalRead = useProcessedMessage(digitalReadMsg)

  const toggleEditMode = () => {
    setEditMode(!editMode)
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

  // Map of mode values to their corresponding names in Johnny-Five
  const modeNames = {
    0: "R", // INPUT -> R
    1: "W", // OUTPUT -> W
    2: "ANALOG",
    3: "PWM",
    4: "SERVO",
    5: "SHIFT",
    6: "I2C",
    7: "ONEWIRE",
    8: "STEPPER",
    9: "UNKNOWN",
    10: "IGNORE",
    11: "PULSE",
    12: "CONTROL",
    13: "PWM_HIGH_RES"
  }

  return (
    <>
      <h3 style={{ display: "flex", alignItems: "center", cursor: "pointer" }} onClick={toggleEditMode}>
        Configuration
        {editMode ? <ExpandLessIcon /> : <ExpandMoreIcon />}
      </h3>
      {editMode ? (
        <Box>
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
        <Paper elevation={3} sx={{ p: 2, m: 2 }}>
          <SerialPortSelector fullname={fullname} ports={service?.ports ?? []} ready={service?.ready ?? false} />
          <Box sx={{ m: 2 }}></Box>

          {/* Display pin buttons */}
          {service?.pins?.map((pin) => (
            <Box key={pin.index} sx={{ mb: 2 }}>
              <Typography variant="h6">Pin {pin.index}</Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0, m: 0 }}>
                {pin.supportedModes.map((mode, index) => (
                  <Button
                    key={mode}
                    variant="outlined"
                    size="small"
                    sx={{
                      m: 0,
                      p: "4px 8px", // Add some padding inside the buttons
                      minWidth: "30px",
                      borderRadius: 0, // Square corners
                      borderLeft: index === 0 ? "1px solid rgba(0, 0, 0, 0.23)" : "none", // Add left border only to the first button
                      "&:not(:last-of-type)": {
                        borderRight: "none" // Remove right border for all but the last button
                      }
                    }}
                  >
                    {modeNames[mode]}
                  </Button>
                ))}
              </Box>
              <Typography variant="body2">Current Value: {pin.value}</Typography>
            </Box>
          ))}
        </Paper>
      </Box>
    </>
  )
}
