import { Box, Button, FormControl, InputLabel, MenuItem, Select, Slider, Typography } from "@mui/material"
import CodecUtil from "framework/CodecUtil"
import React, { useEffect, useState } from "react"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

export default function Servo({ name, fullname, id }) {
  console.debug(`Servo ${fullname}`)

  const [value, setRange] = useState([0, 180])
  const [mainSliderValue, setMainSliderValue] = useState(90)
  const [speedValue, setSpeedValue] = useState(50)
  const [selectedController, setSelectedController] = useState("")
  const [selectedPin, setSelectedPin] = useState("")

  const { useMessage, sendTo } = useStore()

  const publishServoMoveToMsg = useMessage(fullname, "publishServoMoveTo")
  const getServoControllersMsg = useMessage(fullname, "getServoControllers")

  const serviceMsg = useServiceSubscription(fullname, ["publishServoMoveTo", "getServoControllers"])

  const service = useProcessedMessage(serviceMsg)
  const publishServoMoveTo = useProcessedMessage(publishServoMoveToMsg)
  const getServoControllers = useProcessedMessage(getServoControllersMsg)

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
      sendTo(fullname, "enable")
    } else {
      sendTo(fullname, "disable")
    }
    sendTo(fullname, "broadcastState")
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
          <Select labelId="pin-select-label" id="pin-select" value={selectedPin} label="Pin" onChange={handlePinChange}>
            {Array.from({ length: 58 }, (_, i) => (
              <MenuItem key={i} value={i}>
                {i}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h2">{mainSliderValue}</Typography>
        <Box display="flex" alignItems="center">
          <Typography variant="h6" sx={{ mr: 1 }}>
            Speed
          </Typography>
          <Slider
            value={speedValue}
            onChange={handleSpeedChange}
            aria-labelledby="speed-slider"
            min={0}
            max={100}
            valueLabelDisplay="auto"
            sx={{ width: 150 }}
          />
          <Typography variant="h6" sx={{ ml: 1 }}>
            {speedValue}
          </Typography>
        </Box>
      </Box>
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
      <Slider
        value={value}
        onChange={handleRangeChange}
        valueLabelDisplay="auto"
        aria-labelledby="range-slider"
        min={0}
        max={180}
        sx={sliderStyles}
      />
      {service?.config && (
        <Button variant="contained" color="primary" onClick={handleToggleEnable}>
          {service?.config?.enabled ? "Disable" : "Enable"}
        </Button>
      )}
    </Box>
  )
}
