import MicIcon from "@mui/icons-material/Mic"
import MicOffIcon from "@mui/icons-material/MicOff"
import PauseIcon from "@mui/icons-material/Pause"
import PlayArrowIcon from "@mui/icons-material/PlayArrow"
import { Box, IconButton, Typography } from "@mui/material"
import React, { useEffect, useState } from "react"
import PySpeechRecognitionWizard from "wizards/PySpeechRecognitionWizard"
import MicrophoneSelect from "../components/MicrophoneSelect"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

export default function PySpeechRecognition({ fullname }) {
  const [selectedMic, setSelectedMic] = useState({})
  const [isListening, setIsListening] = useState(false)
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
      setIsPaused(service?.config?.paused)
    }
  }, [service, service?.config?.paused])

  useEffect(() => {
    // backend update to set listening state
    if (service) {
      setIsListening(service?.config?.listening)
    }
  }, [service, service?.config?.listening])

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
    console.info(`sending ->setMicrophone ${mic}`)
    sendTo(fullname, "setMicrophone", mic)
  }

  if (!service?.installed) {
    return <PySpeechRecognitionWizard fullname={fullname} />
  } else {
    return (
      <>
        {service?.mics && (
          <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "80%" }, mt: 2 }}>
            <MicrophoneSelect mics={service.mics} selectedMic={selectedMic} handleMicChange={handleMicChange} />
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
