import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import MicIcon from "@mui/icons-material/Mic"
import { Box, Button, FormControl, IconButton, InputLabel, MenuItem, Select, TextField } from "@mui/material"
import React, { useEffect, useState } from "react"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

export default function Microphone({ fullname }) {
  const [editMode, setEditMode] = useState(false)
  const [microphones, setMicrophones] = useState([])
  const [selectedMic, setSelectedMic] = useState("")
  const [isRecording, setIsRecording] = useState(false)

  const { useMessage, sendTo } = useStore()

  // Makes reference to the message object in store
  const serviceMsg = useServiceSubscription(fullname, ["publishEpoch"])

  // Processes the msg.data[0] and returns the data
  const service = useProcessedMessage(serviceMsg)

  useEffect(() => {
    // Function to list available microphones
    const listMicrophones = async () => {
      const response = await fetch("/api/listMicrophones") // Assuming you have an API endpoint to list microphones
      const mics = await response.json()
      setMicrophones(mics)
    }

    listMicrophones()
  }, [])

  const toggleEditMode = () => {
    setEditMode(!editMode)
  }

  const handleStartRecording = () => {
    sendTo(fullname, "startRecording")
    setIsRecording(true)
  }

  const handleStopRecording = () => {
    sendTo(fullname, "stopRecording")
    setIsRecording(false)
  }

  const handleMicChange = (event) => {
    const mic = event.target.value
    setSelectedMic(mic)
    sendTo(fullname, "selectMicrophone", { mic })
  }

  const handleConfigChange = (event) => {
    const { name, value, type } = event.target
    const newValue = type === "number" ? Number(value) : value
    // Handle configuration change
  }

  const handleSaveConfig = () => {
    setEditMode(false)
    // Save the configuration
  }

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

      <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "80%" }, mt: 2 }}>
        <FormControl fullWidth>
          <InputLabel id="microphone-select-label">Microphone</InputLabel>
          <Select labelId="microphone-select-label" value={selectedMic} label="Microphone" onChange={handleMicChange}>
            {microphones.map((mic, index) => (
              <MenuItem key={index} value={mic}>
                {mic}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      <Box sx={{ mt: 2 }}>
        <IconButton
          color={isRecording ? "secondary" : "default"}
          onClick={isRecording ? handleStopRecording : handleStartRecording}
        >
          <MicIcon />
        </IconButton>
      </Box>
    </>
  )
}
