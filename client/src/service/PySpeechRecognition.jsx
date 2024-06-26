import MicIcon from "@mui/icons-material/Mic"
import MicOffIcon from "@mui/icons-material/MicOff"
import PauseIcon from "@mui/icons-material/Pause"
import PlayArrowIcon from "@mui/icons-material/PlayArrow"
import { Box, FormControl, IconButton, InputLabel, MenuItem, Select, TextField, Typography } from "@mui/material"
import React, { useEffect, useState } from "react"
import PySpeechRecognitionWizard from "wizards/PySpeechRecognitionWizard"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

export default function PySpeechRecognition({ fullname }) {
  const [selectedMic, setSelectedMic] = useState({})
  const [selectedBackend, setSelectedBackend] = useState("")
  const [isListening, setIsListening] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [apiKey, setApiKey] = useState("")
  const [apiUser, setApiUser] = useState("")
  const [apiLocation, setApiLocation] = useState("")

  const { useMessage, sendTo } = useStore()

  // Makes reference to the message object in store
  const serviceMsg = useServiceSubscription(fullname, ["publishEpoch"])

  // Processes the msg.data[0] and returns the data
  const service = useProcessedMessage(serviceMsg)

  const backends = [
    "google",
    "sphinx",
    "ibm",
    "bing",
    "houndify",
    "wit",
    "azure",
    "google_cloud",
    "vosk",
    "whisper",
    "whisper_api"
  ]

  const backendsRequiringApiUser = ["ibm", "houndify"]
  const backendsRequiringApiKey = ["ibm", "houndify", "azure", "google_cloud", "whisper_api"]

  useEffect(() => {
    // mic selected state
    if (service?.config?.mic) {
      setSelectedMic(service?.config?.mic)
    }
    // backend selected state
    if (service?.config?.backend) {
      setSelectedBackend(service?.config?.backend)
    }
  }, [service, service?.config?.mic, service?.config?.backend])

  useEffect(() => {
    // backend update to set paused state
    if (service) {
      setIsPaused(service?.config?.paused)
    }
  }, [service, service?.config?.paused])

  useEffect(() => {
    // backend update to set listening state
    if (service) {
      setIsListening(service?.listening) // the state not the command
    }
  }, [service, service?.listening])

  const handleStartListening = () => {
    sendTo(fullname, "startListening")
  }

  const handleStopListening = () => {
    sendTo(fullname, "stopListening")
  }

  const handlePauseResumeListening = () => {
    if (isPaused) {
      sendTo(fullname, "resumeListening")
    } else {
      sendTo(fullname, "pauseListening")
    }
  }

  const handleMicChange = (event) => {
    const mic = event.target.value
    console.info(`sending -> setMicrophone ${mic}`)
    sendTo(fullname, "setMicrophone", mic)
  }

  const handleBackendChange = (event) => {
    const backend = event.target.value
    console.info(`sending -> setBackend ${backend}`)
    sendTo(fullname, "setBackend", backend)
    setSelectedBackend(backend)
  }

  const handleApiKeyChange = (event) => {
    setApiKey(event.target.value)
    console.info(`sending -> setApiKey ${event.target.value}`)
    sendTo(fullname, "setApiKey", event.target.value)
  }

  const handleApiUserChange = (event) => {
    setApiKey(event.target.value)
    console.info(`sending -> setApiUser ${event.target.value}`)
    sendTo(fullname, "setApiUser", event.target.value)
  }

  const handleApiLocationChange = (event) => {
    setApiKey(event.target.value)
    console.info(`sending -> setApiLocation ${event.target.value}`)
    sendTo(fullname, "setApiLocation", event.target.value)
  }

  if (!service?.installed) {
    return <PySpeechRecognitionWizard fullname={fullname} />
  } else {
    return (
      <>
        {service?.mics && (
          <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "80%" }, mt: 2 }}>
            <FormControl fullWidth>
              <InputLabel id="microphone-select-label">Microphone</InputLabel>
              <Select
                labelId="microphone-select-label"
                value={selectedMic}
                label="Microphone"
                onChange={handleMicChange}
              >
                {Object.entries(service.mics).map(([key, value]) => (
                  <MenuItem key={key} value={key}>
                    {value}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        )}
        <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "80%" }, mt: 2 }}>
          <FormControl fullWidth>
            <InputLabel id="backend-select-label">Backend</InputLabel>
            <Select
              labelId="backend-select-label"
              value={selectedBackend}
              label="Backend"
              onChange={handleBackendChange}
            >
              {backends.map((backend) => (
                <MenuItem key={backend} value={backend}>
                  {backend}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
        {backendsRequiringApiUser.includes(selectedBackend) && (
          <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "80%" }, mt: 2 }}>
            <TextField fullWidth label="User" type="text" value={apiUser} onChange={handleApiUserChange} />
          </Box>
        )}

        {selectedBackend === "azure" && (
          <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "80%" }, mt: 2 }}>
            <TextField fullWidth label="Location" type="text" value={apiLocation} onChange={handleApiLocationChange} />
          </Box>
        )}

        {backendsRequiringApiKey.includes(selectedBackend) && (
          <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "80%" }, mt: 2 }}>
            <TextField fullWidth label="API Key" type="password" value={apiKey} onChange={handleApiKeyChange} />
          </Box>
        )}
        <Box sx={{ mt: 2, display: "flex", gap: 2, alignItems: "center" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <IconButton
              color={isListening ? "secondary" : "default"}
              onClick={isListening ? handleStopListening : handleStartListening}
            >
              {isListening ? <MicIcon /> : <MicOffIcon />}
            </IconButton>
            <Typography variant="body1">{isListening ? "Listening" : "Not Listening"}</Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <IconButton color={isPaused ? "default" : "secondary"} onClick={handlePauseResumeListening}>
              {isPaused ? <PlayArrowIcon /> : <PauseIcon />}
            </IconButton>
            <Typography variant="body1">{isPaused ? "Paused" : "Not Paused"}</Typography>
          </Box>
        </Box>
      </>
    )
  }
}
