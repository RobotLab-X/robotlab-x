import { Box, Button, FormControl, InputLabel, MenuItem, Popover, Select } from "@mui/material"
import CodecUtil from "framework/CodecUtil"
import React, { useEffect, useState } from "react"
import { ChromePicker } from "react-color"

import { useStore } from "store/store"
import useSubscription from "store/useSubscription"

// FIXME remove fullname with context provider
export default function NeoPixel({ fullname }) {
  console.info(`NeoPixel ${fullname}`)

  // color picker related
  const [color, setColor] = useState("#ff0000")
  const [anchorEl, setAnchorEl] = useState(null)
  const open = Boolean(anchorEl)

  const [editMode, setEditMode] = useState(false)
  const { sendTo } = useStore()

  const [selectedController, setSelectedController] = useState("")
  const [selectedPin, setSelectedPin] = useState("")

  const service = useSubscription(fullname, "broadcastState", true)
  const getServoControllers = useSubscription(fullname, "getServoControllers", true)

  const handleClick = (event) => {
    setAnchorEl(event.currentTarget)
  }

  const handleClose = () => {
    setAnchorEl(null)
  }

  useEffect(() => {
    if (service?.config?.controller) {
      setSelectedController(service.config.controller)
      setSpeedValue(service.config.speed)
    }
  }, [service?.config])

  useEffect(() => {
    if (service?.config?.pin) {
      setSelectedPin(service.config.pin)
    }
  }, [service?.config?.pin])

  const toggleEditMode = () => {
    setEditMode(!editMode)
  }

  const handleControllerOpen = () => {
    sendTo(fullname, "getServoControllers")
  }

  useEffect(() => {
    handleControllerOpen()
  }, [])

  const handleSaveConfig = () => {
    sendTo(fullname, "applyConfig", config)
    sendTo(fullname, "saveConfig")
    sendTo(fullname, "broadcastState")
    setEditMode(false)
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

  return (
    <Box>
      <Box>
        <FormControl fullWidth>
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

        <FormControl fullWidth>
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

      <Button variant="outlined" onClick={handleClick} sx={{ backgroundColor: color, color: "#fff" }}>
        Pick Color
      </Button>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <ChromePicker color={color} onChangeComplete={(newColor) => setColor(newColor.hex)} />
      </Popover>
    </Box>
  )
}
