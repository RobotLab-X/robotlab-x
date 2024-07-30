import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import { Box, Button, FormControl, InputLabel, MenuItem, Select, Slider, Typography } from "@mui/material"
import CodecUtil from "framework/CodecUtil"
import React, { useEffect, useState } from "react"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

export default function Servo({ name, fullname, id }) {
  console.debug(`Servo ${fullname}`)

  const { useMessage, sendTo } = useStore()
  const [value, setRange] = useState([0, 180])
  const [mainSliderValue, setMainSliderValue] = useState(90)
  const [speedValue, setSpeedValue] = useState(50)
  const [selectedController, setSelectedController] = useState("")
  const [selectedPin, setSelectedPin] = useState("")
  const [editMode, setEditMode] = useState(false)
  const publishServoMoveToMsg = useMessage(fullname, "publishServoMoveTo")
  const getServoControllersMsg = useMessage(fullname, "getServoControllers")
  const serviceMsg = useServiceSubscription(fullname, ["publishServoMoveTo", "getServoControllers"])
  const service = useProcessedMessage(serviceMsg)
  const publishServoMoveTo = useProcessedMessage(publishServoMoveToMsg)
  const getServoControllers = useProcessedMessage(getServoControllersMsg)

  const handleSaveConfig = () => {
    if (config) {
      config.prompt = currentPromptKey
      sendTo(fullname, "applyConfig", config)
      sendTo(fullname, "saveConfig")
      sendTo(fullname, "broadcastState")
      setEditMode(false)
    }
  }

  const toggleEditMode = () => {
    setEditMode(!editMode)
  }

  useEffect(() => {
    if (service?.config?.controller) {
      setSelectedController(service.config.controller)
    }
  }, [service?.config?.controller])

  useEffect(() => {
    if (service?.config?.pin) {
      setSelectedPin(service.config.pin)
    }
  }, [service?.config?.pin])

  useEffect(() => {
    if (service?.config?.min && service?.config?.max) {
      setRange([service.config.min, service.config.max])
    }
  }, [service?.config?.min, service?.config?.max])

  const handleControllerOpen = () => {
    sendTo(fullname, "getServoControllers")
  }

  useEffect(() => {
    handleControllerOpen()
  }, [])

  const handleMoveTo = (event, newValue) => {
    if (newValue < value[0]) {
      newValue = value[0]
    } else if (newValue > value[1]) {
      newValue = value[1]
    }
    sendTo(fullname, "moveTo", newValue)
    setMainSliderValue(newValue)
  }

  const handleRangeChange = (event, newValue) => {
    console.info(`handleRangeChange ${newValue}`)
    setRange(newValue)
    sendTo(fullname, "setMinMax", newValue[0], newValue[1])
  }

  const handleSpeedChange = (event, newValue) => {
    if (newValue > 199) {
      console.info("removing speed control")
      sendTo(fullname, "setSpeed", null)
    } else {
      sendTo(fullname, "setSpeed", newValue)
    }
    setSpeedValue(newValue)
  }

  const handleControllerChange = (event) => {
    setSelectedController(event.target.value)
    sendTo(fullname, "setController", event.target.value)
    sendTo(fullname, "broadcastState")
  }

  const handlePinChange = (event) => {
    setSelectedPin(event.target.value)
    sendTo(fullname, "setPin", event.target.value)
    sendTo(fullname, "broadcastState")
  }

  const handleToggleEnable = () => {
    if (service?.config?.enabled) {
      sendTo(fullname, "disable")
    } else {
      sendTo(fullname, "enable")
    }
    sendTo(fullname, "broadcastState")
  }

  const handleRest = () => {
    sendTo(fullname, "rest")
  }

  const handleStop = () => {
    sendTo(fullname, "stop")
  }

  const sliderStyles = {
    "& .MuiSlider-track": {
      background: "transparent"
    },
    "& .MuiSlider-thumb": {
      borderRadius: 3,
      height: 24,
      width: 8
    }
  }

  return (
    <Box>
      <h3 style={{ display: "flex", alignItems: "center", cursor: "pointer" }} onClick={toggleEditMode}>
        Configuration
        {editMode ? <ExpandLessIcon /> : <ExpandMoreIcon />}
      </h3>

      {editMode ? (
        <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "80%" } }}>
          <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <FormControl fullWidth sx={{ mt: 2, mr: 1 }}>
                <InputLabel id="controller-select-label">Controller</InputLabel>
                <Select
                  labelId="controller-select-label"
                  id="controller-select"
                  value={selectedController}
                  label="Controller"
                  onChange={handleControllerChange}
                  onOpen={handleControllerOpen}
                >
                  <MenuItem value="">
                    <em>None</em>
                  </MenuItem>
                  {getServoControllers?.map((controller, index) => {
                    const shortName = CodecUtil.getShortName(controller)
                    return (
                      <MenuItem key={index} value={shortName}>
                        {shortName}
                      </MenuItem>
                    )
                  })}
                </Select>
              </FormControl>
              <FormControl fullWidth sx={{ mt: 2, ml: 1 }}>
                <InputLabel id="pin-select-label">Pin</InputLabel>
                <Select
                  labelId="pin-select-label"
                  id="pin-select"
                  value={selectedPin}
                  label="Pin"
                  onChange={handlePinChange}
                >
                  {Array.from({ length: 58 }, (_, i) => (
                    <MenuItem key={i} value={i}>
                      {i}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Box display="flex" alignItems="center">
                <Typography variant="h6" sx={{ mr: 1 }}>
                  Speed
                </Typography>
                <Slider
                  value={speedValue}
                  onChange={handleSpeedChange}
                  aria-labelledby="speed-slider"
                  min={1}
                  max={200}
                  valueLabelDisplay="auto"
                  sx={{ width: 150 }}
                />
                <Typography variant="h6" sx={{ ml: 1 }}>
                  {speedValue}
                </Typography>
              </Box>
            </Box>
          </Box>
        </Box>
      ) : null}
      {editMode ? (
        <>
          <Typography variant="h6" sx={{ mr: 1 }}>
            Range {value[0]} - {value[1]}
          </Typography>
          <Slider
            value={value}
            onChange={handleRangeChange}
            valueLabelDisplay="auto"
            aria-labelledby="range-slider"
            min={0}
            max={180}
            sx={sliderStyles}
          />
        </>
      ) : null}

      <Typography variant="h2">{mainSliderValue}</Typography>

      <Typography variant="h6" sx={{ mr: 1 }}>
        Speed {speedValue}
      </Typography>

      <Slider
        value={mainSliderValue}
        onChange={(event, newValue) => handleMoveTo(event, newValue)}
        aria-label="Small"
        valueLabelDisplay="auto"
        track={false}
        min={0}
        max={180}
        sx={sliderStyles}
      />

      {service?.config && (
        <Box display="flex" justifyContent="flex-start" alignItems="center" mt={2}>
          <Button variant="contained" color="primary" onClick={handleToggleEnable}>
            {service?.config?.enabled ? "Disable" : "Enable"}
          </Button>
          <Button variant="contained" color="secondary" onClick={handleRest} sx={{ ml: 2 }}>
            Rest
          </Button>
          <Button variant="contained" color="error" onClick={handleStop} sx={{ ml: 2 }}>
            Stop
          </Button>
          {editMode && (
            <Button variant="contained" color="primary" onClick={handleSaveConfig} sx={{ ml: 2 }}>
              Save
            </Button>
          )}
        </Box>
      )}
    </Box>
  )
}
