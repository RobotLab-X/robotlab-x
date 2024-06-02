import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import { Box, Button, Paper, Slider, TextField, Typography } from "@mui/material"
import React, { useState } from "react"
import SerialPortSelector from "../components/serialport/SerialPortSelector"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

export default function Arduino({ fullname }) {
  const [editMode, setEditMode] = useState(false)
  const [pwmValue, setPwmValue] = useState({})
  const [showSlider, setShowSlider] = useState({})

  const { useMessage, sendTo } = useStore()

  const digitalReadMsg = useMessage(fullname, "digitalRead")

  const serviceMsg = useServiceSubscription(fullname, ["analogRead", "digitalRead"])

  const service = useProcessedMessage(serviceMsg)
  const digitalRead = useProcessedMessage(digitalReadMsg)

  const getRepoUrl = useStore((state) => state.getRepoUrl)

  const toggleEditMode = () => {
    setEditMode(!editMode)
  }

  const handleConfigChange = (event) => {
    const { name, value, type } = event.target
    const newValue = type === "number" ? Number(value) : value
  }

  const handleSaveConfig = () => {
    setEditMode(false)
  }

  const handlePwmChange = (event, newValue, pinIndex) => {
    setPwmValue((prev) => ({ ...prev, [pinIndex]: newValue }))
  }

  const toggleSlider = (pinIndex) => {
    setShowSlider((prev) => ({ ...prev, [pinIndex]: !prev[pinIndex] }))
  }

  const modeNames = {
    0: "R",
    1: "W",
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
              sx={{ flex: 1 }}
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
          <Box sx={{ m: 2 }}>
            {service && service?.boardType && (
              <img
                src={`${getRepoUrl()}/Arduino/${service?.boardType}.png`}
                alt={service.name}
                style={{ verticalAlign: "middle" }}
              />
            )}
          </Box>

          {service?.pins?.map((pin) => (
            <Box key={pin.index} sx={{ mb: 2 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Typography variant="h6">
                  Pin {pin.index} &nbsp;&nbsp; Value: {pin.value}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0, m: 0 }}>
                {pin.supportedModes.map((mode, index) => (
                  <Button
                    key={mode}
                    variant="outlined"
                    size="small"
                    sx={{
                      m: 0,
                      p: "4px 8px",
                      minWidth: "30px",
                      borderRadius: 0,
                      borderLeft: index === 0 ? "1px solid rgba(0, 0, 0, 0.23)" : "none",
                      "&:not(:last-of-type)": {
                        borderRight: "none"
                      },
                      backgroundColor: showSlider[pin.index] && mode === 3 ? "rgba(0, 0, 0, 0.08)" : "inherit"
                    }}
                    onClick={() => mode === 3 && toggleSlider(pin.index)}
                  >
                    {modeNames[mode]}
                  </Button>
                ))}
              </Box>
              {showSlider[pin.index] && (
                <Box sx={{ mt: 2 }}>
                  <Slider
                    value={pwmValue[pin.index] ?? 0}
                    min={0}
                    max={254}
                    onChange={(event, newValue) => handlePwmChange(event, newValue, pin.index)}
                    valueLabelDisplay="auto"
                  />
                </Box>
              )}
            </Box>
          ))}
        </Paper>
      </Box>
    </>
  )
}
