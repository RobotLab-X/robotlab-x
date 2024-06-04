import { Box, Slider, Typography } from "@mui/material"
import React, { useState } from "react"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

export default function Servo({ name, fullname, id }) {
  const [value, setValue] = React.useState([20, 80])
  const [mainSliderValue, setMainSliderValue] = React.useState(70)
  const [speedValue, setSpeedValue] = React.useState(50)

  const [editMode, setEditMode] = useState(false)

  const { useMessage, sendTo } = useStore()

  // makes reference to the message object in store
  const epochMsg = useMessage(fullname, "publishServoMoveTo")

  // creates subscriptions to topics and returns the broadcastState message reference
  const serviceMsg = useServiceSubscription(fullname, ["publishServoMoveTo"])

  // processes the msg.data[0] and returns the data
  const service = useProcessedMessage(serviceMsg)
  const timestamp = useProcessedMessage(epochMsg)

  const toggleEditMode = () => {
    setEditMode(!editMode)
  }

  const handleChange = (event, newValue) => {
    // Ensure the upper slider handle does not move between the min/max positions of the lower slider
    if (newValue < value[0]) {
      newValue = value[0]
    } else if (newValue > value[1]) {
      newValue = value[1]
    }
    setMainSliderValue(newValue)
  }

  const handleRangeChange = (event, newValue) => {
    setValue(newValue)
  }

  const handleSpeedChange = (event, newValue) => {
    setSpeedValue(newValue)
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
        onChange={(event, newValue) => handleChange(event, newValue)}
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
