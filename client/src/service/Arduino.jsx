import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import { Box, Button, FormControlLabel, Paper, Slider, Switch, TextField, Typography } from "@mui/material"
import React, { useState } from "react"
import SerialPortSelector from "../components/serialport/SerialPortSelector"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

export default function Arduino({ id, fullname, name }) {
  console.debug(`Arduino ${fullname}`)

  const [editMode, setEditMode] = useState(false)
  const [pwmValue, setPwmValue] = useState({})
  const [digitalValue, setDigitalValue] = useState({})
  const [servoValue, setServoValue] = useState({})
  const [pulseTime, setPulseTime] = useState({})
  const [activeMode, setActiveMode] = useState({})

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
    setPwmValue((prev) => ({ ...prev, [pinIndex]: newValue ?? 0 }))
  }

  const handleDigitalChange = (event, pinIndex) => {
    const newValue = event.target.checked ? 1 : 0
    setDigitalValue((prev) => ({ ...prev, [pinIndex]: newValue }))
    sendTo(fullname, "write", pinIndex, newValue)
  }

  const handleServoChange = (event, newValue, pinIndex) => {
    setServoValue((prev) => ({ ...prev, [pinIndex]: newValue ?? 0 }))
    sendTo(fullname, "servoWrite", pinIndex, newValue ?? 0)
  }

  const handlePulseButton = (pinIndex) => {
    sendTo(fullname, "pulseRead", { pin: pinIndex })
    // Mock pulse time for illustration
    setPulseTime((prev) => ({ ...prev, [pinIndex]: Math.floor(Math.random() * 1000) }))
  }

  const handleModeSelect = (pinIndex, mode) => {
    setActiveMode((prev) => ({ ...prev, [pinIndex]: mode }))
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
              value={service?.config?.intervalMs ?? ""}
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

      <Box>
        <Paper elevation={3} sx={{ p: 2, m: 2 }}>
          <SerialPortSelector
            portInfo={{
              fullname: fullname,
              port: service?.config?.port ?? "",
              ports: service?.ports ?? [],
              isConnected: service?.ready ?? false
            }}
          />
          <Box sx={{ m: 2 }}>
            {service && service?.boardType && (
              <img
                src={`${getRepoUrl()}/arduino/${service?.boardType}.png`}
                alt={service.name}
                style={{ verticalAlign: "middle" }}
              />
            )}
          </Box>

          {service?.pins?.map((pin) => {
            if (pin.index === 0 || pin.index === 1) return null
            return (
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
                        backgroundColor: activeMode[pin.index] === mode ? "rgba(0, 0, 0, 0.08)" : "inherit"
                      }}
                      onClick={() => handleModeSelect(pin.index, mode)}
                    >
                      {modeNames[mode]}
                    </Button>
                  ))}
                </Box>
                {activeMode[pin.index] === 3 && (
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
                {activeMode[pin.index] === 4 && (
                  <Box sx={{ mt: 2 }}>
                    <Slider
                      value={servoValue[pin.index] ?? 0}
                      min={0}
                      max={180}
                      onChange={(event, newValue) => handleServoChange(event, newValue, pin.index)}
                      valueLabelDisplay="auto"
                      sx={{ color: "orange" }}
                    />
                  </Box>
                )}
                {activeMode[pin.index] === 1 && (
                  <Box sx={{ mt: 2 }}>
                    0 &nbsp;&nbsp;&nbsp;
                    <FormControlLabel
                      control={
                        <Switch
                          checked={digitalValue[pin.index] === 1}
                          onChange={(event) => handleDigitalChange(event, pin.index)}
                        />
                      }
                    />{" "}
                    1
                  </Box>
                )}
                {activeMode[pin.index] === 11 && (
                  <Box sx={{ mt: 2 }}>
                    <Button variant="contained" color="primary" onClick={() => handlePulseButton(pin.index)}>
                      Pulse
                    </Button>
                    <Typography variant="body2" sx={{ mt: 1 }}>
                      Time: {pulseTime[pin.index] ?? "N/A"} µs
                    </Typography>
                  </Box>
                )}
              </Box>
            )
          })}
        </Paper>
      </Box>
    </>
  )
}
