import { Box, FormControl, InputLabel, MenuItem, Select, Slider, Typography } from "@mui/material"
import CodecUtil from "framework/CodecUtil"
import React, { useEffect, useState } from "react"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

export default function Servo({ name, fullname, id }) {
  const [value, setValue] = useState([20, 80])
  const [mainSliderValue, setMainSliderValue] = useState(70)
  const [speedValue, setSpeedValue] = useState(50)
  const [selectedController, setSelectedController] = useState("")
  const [selectedPin, setSelectedPin] = useState("")

  const { useMessage, sendTo } = useStore()

  // makes reference to the message object in store
  const publishServoMoveToMsg = useMessage(fullname, "publishServoMoveTo")
  const getServoControllersMsg = useMessage(fullname, "getServoControllers")

  // creates subscriptions to topics and returns the broadcastState message reference
  const serviceMsg = useServiceSubscription(fullname, ["publishServoMoveTo", "getServoControllers"])

  // processes the msg.data[0] and returns the data
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

  const handleControllerOpen = () => {
    // Fetch the currently available controllers
    sendTo(fullname, "getServoControllers")
  }

  useEffect(() => {
    // Fetch the currently available controllers when the component mounts
    handleControllerOpen()
  }, [])

  const handleMoveTo = (event, newValue) => {
    // Ensure the upper slider handle does not move between the min/max positions of the lower slider
    if (newValue < value[0]) {
      newValue = value[0]
    } else if (newValue > value[1]) {
      newValue = value[1]
    }
    sendTo(fullname, "moveTo", newValue)
    setMainSliderValue(newValue)
  }

  const handleRangeChange = (event, newValue) => {
    setValue(newValue)
  }

  const handleSpeedChange = (event, newValue) => {
    setSpeedValue(newValue)
  }

  const handleControllerChange = (event) => {
    setSelectedController(event.target.value)
    // This must simply addListener of the appropriate name etc
    sendTo(fullname, "setController", event.target.value)
    sendTo(fullname, "broadcastState")
  }

  const handlePinChange = (event) => {
    setSelectedPin(event.target.value)
    // This must simply removeListener of the appropriate name etc
    sendTo(fullname, "setPin", event.target.value)
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
    <Box sx={{ width: { xs: "100%", sm: "100%", md: "30%" } }}>
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
        max={100}
        sx={sliderStyles}
      />
      <Slider
        value={value}
        onChange={handleRangeChange}
        valueLabelDisplay="auto"
        aria-labelledby="range-slider"
        min={0}
        max={100}
        sx={sliderStyles}
      />
    </Box>
  )
}
