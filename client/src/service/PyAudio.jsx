import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import MicIcon from "@mui/icons-material/Mic"
import MicOffIcon from "@mui/icons-material/MicOff"
import PauseIcon from "@mui/icons-material/Pause"
import PlayArrowIcon from "@mui/icons-material/PlayArrow"
import {
  Box,
  Button,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography
} from "@mui/material"
import React, { useEffect, useState } from "react"
import PyAudioWizard from "wizards/PyAudioWizard"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

export default function PyAudio({ fullname }) {
  console.info(`PyAudio ${fullname}`)

  const [editMode, setEditMode] = useState(false)
  const [selectedMic, setSelectedMic] = useState({})
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)

  const { useMessage, sendTo } = useStore()

  // Makes reference to the message object in store
  const serviceMsg = useServiceSubscription(fullname, ["publishEpoch"])

  // Processes the msg.data[0] and returns the data
  const service = useProcessedMessage(serviceMsg)

  useEffect(() => {
    // mic selected state
    if (service?.config?.mic) {
      setSelectedMic(service?.config?.mic)
    }
  }, [service, service?.config?.mic])

  useEffect(() => {
    // backend update to set paused state
    if (service) {
      setIsPaused(service.config.paused)
    }
  }, [service, service?.config?.paused])

  useEffect(() => {
    // backend update to set recording state
    if (service) {
      setIsRecording(service.config.recording)
    }
  }, [service, service?.config?.recording])

  const toggleEditMode = () => {
    setEditMode(!editMode)
  }

  const handleStartRecording = () => {
    sendTo(fullname, "startRecording")
    // setIsRecording(true)
    // setIsPaused(false)
  }

  const handleStopRecording = () => {
    sendTo(fullname, "stopRecording")
    // setIsRecording(false)
    // setIsPaused(false)
  }

  const handlePauseResumeRecording = () => {
    if (isPaused) {
      sendTo(fullname, "resumeRecording")
    } else {
      sendTo(fullname, "pauseRecording")
    }
    // setIsPaused(!isPaused)
  }

  const handleMicChange = (event) => {
    const mic = event.target.value
    // setSelectedMic(mic)
    console.info(`sending ->setMicrophone ${mic}`)
    sendTo(fullname, "setMicrophone", mic)
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

  if (!service?.installed) {
    return <PyAudioWizard fullname={fullname} />
  } else {
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
                value={selectedMic}
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

        {service?.mics && (
          <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "80%" }, mt: 2 }}>
            <FormControl fullWidth>
              <InputLabel id="microphone-select-label">PyAudio</InputLabel>
              <Select labelId="microphone-select-label" value={selectedMic} label="PyAudio" onChange={handleMicChange}>
                {Object.entries(service.mics).map(([key, value]) => (
                  <MenuItem key={key} value={key}>
                    {value}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        )}
        <Box sx={{ mt: 2, display: "flex", gap: 2, alignItems: "center" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <IconButton
              color={isRecording ? "secondary" : "default"}
              onClick={isRecording ? handleStopRecording : handleStartRecording}
            >
              {isRecording ? <MicIcon /> : <MicOffIcon />}
            </IconButton>
            <Typography variant="body1">{isRecording ? "Recording" : "Not Recording"}</Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <IconButton color={isPaused ? "default" : "secondary"} onClick={handlePauseResumeRecording}>
              {isPaused ? <PlayArrowIcon /> : <PauseIcon />}
            </IconButton>
            <Typography variant="body1">{isPaused ? "Paused" : "Not Paused"}</Typography>
          </Box>
        </Box>
      </>
    )
  }
}
