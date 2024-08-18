import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import { Box, Button, FormControl, InputLabel, Link, MenuItem, Select, Typography } from "@mui/material"
import { useProcessedMessage } from "hooks/useProcessedMessage"
import React, { useEffect, useRef, useState } from "react"
import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition"
import { useStore } from "store/store"
import useServiceSubscription from "store/useServiceSubscription"

export default function WebkitSpeechRecognition({ fullname }) {
  console.debug(`WebkitSpeechRecognition ${fullname}`)

  const [editMode, setEditMode] = useState(false)
  const [language, setLanguage] = useState("en-US") // Default language
  const [microphones, setMicrophones] = useState([]) // List of available microphones
  const [selectedMicrophone, setSelectedMicrophone] = useState("") // Selected microphone
  const { useMessage, sendTo } = useStore()
  const epochMsg = useMessage(fullname, "publishEpoch")
  const serviceMsg = useServiceSubscription(fullname, ["publishEpoch"])
  const service = useProcessedMessage(serviceMsg)
  const timestamp = useProcessedMessage(epochMsg)
  const getBaseUrl = useStore((state) => state.getBaseUrl)

  const previousTranscriptRef = useRef("")

  const toggleEditMode = () => {
    setEditMode(!editMode)
  }

  const handleStart = () => {
    sendTo(fullname, "startWebkitSpeechRecognition", { microphone: selectedMicrophone })
  }

  const handleStop = () => {
    sendTo(fullname, "stopWebkitSpeechRecognition")
  }

  const handleConfigChange = (event) => {
    const { name, value, type } = event.target
    const newValue = type === "number" ? Number(value) : value
    // Handle configuration change logic here
  }

  const handleSaveConfig = () => {
    // Handle saving configuration logic here
    setEditMode(false)
  }

  const handleLanguageChange = (event) => {
    setLanguage(event.target.value)
  }

  const handleMicrophoneChange = (event) => {
    setSelectedMicrophone(event.target.value)
  }

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      const mics = devices.filter((device) => device.kind === "audioinput")
      setMicrophones(mics)
      if (mics.length > 0) {
        setSelectedMicrophone(mics[0].deviceId) // Set the default microphone
      }
    })
  }, [])

  let dateStr = (timestamp && new Date(timestamp).toLocaleString()) || ""

  const {
    transcript,
    interimTranscript,
    finalTranscript,
    resetTranscript,
    listening,
    browserSupportsSpeechRecognition,
    isMicrophoneAvailable
  } = useSpeechRecognition()

  useEffect(() => {
    if (!listening) {
      const timer = setTimeout(() => {
        if (!listening) {
          SpeechRecognition.startListening({ continuous: true, language, deviceId: selectedMicrophone })
        }
      }, 1000)
      return () => clearTimeout(timer)
    }
  }, [listening, language, selectedMicrophone])

  useEffect(() => {
    if (finalTranscript) {
      console.log("Final Transcript:", finalTranscript)
      sendTo(fullname, "publishText", finalTranscript)
      resetTranscript()
    }
  }, [finalTranscript])

  if (!browserSupportsSpeechRecognition) {
    return <Typography variant="body1">Browser doesn't support speech recognition.</Typography>
  }

  const supportedLanguages = [
    { code: "en-US", label: "English (United States)" },
    { code: "es-ES", label: "Spanish (Spain)" },
    { code: "fr-FR", label: "French (France)" },
    { code: "de-DE", label: "German (Germany)" },
    { code: "it-IT", label: "Italian (Italy)" },
    { code: "ja-JP", label: "Japanese (Japan)" },
    { code: "ko-KR", label: "Korean (Korea)" },
    { code: "pt-BR", label: "Portuguese (Brazil)" },
    { code: "ru-RU", label: "Russian (Russia)" },
    { code: "zh-CN", label: "Chinese (China)" }
    // Add more supported languages here
  ]

  return (
    <>
      <Typography variant="h6">
        {window.electron ? (
          <>
            This service must run in a browser; currently, it is running in Electron. Click the following link to open
            the browser:{" "}
            <Link href={getBaseUrl()} target="_blank" rel="noopener noreferrer">
              {getBaseUrl()}
            </Link>
          </>
        ) : (
          ""
        )}
      </Typography>

      <Typography variant="h6">Transcript: {transcript}</Typography>

      <Typography variant="h6">Final Transcript: {finalTranscript}</Typography>

      <Typography variant="h6">Interim Transcript: {interimTranscript}</Typography>

      <h3 style={{ display: "flex", alignItems: "center", cursor: "pointer" }} onClick={toggleEditMode}>
        Configuration
        {editMode ? <ExpandLessIcon /> : <ExpandMoreIcon />}
      </h3>
      {editMode && (
        <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "80%" } }}>
          <FormControl fullWidth margin="normal">
            <InputLabel>Language</InputLabel>
            <Select value={language} onChange={handleLanguageChange} label="Language">
              {supportedLanguages.map((lang) => (
                <MenuItem key={lang.code} value={lang.code}>
                  {lang.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth margin="normal">
            <InputLabel>Microphone</InputLabel>
            <Select value={selectedMicrophone} onChange={handleMicrophoneChange} label="Microphone">
              {microphones.map((mic) => (
                <MenuItem key={mic.deviceId} value={mic.deviceId}>
                  {mic.label || `Microphone ${mic.deviceId}`}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Box sx={{ mt: 2, display: "flex", gap: 2 }}>
            <Button variant="contained" color="primary" onClick={handleSaveConfig}>
              Save
            </Button>
          </Box>
        </Box>
      )}

      <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "80%" }, mt: 2 }}>
        <Typography variant="body1">Microphone: {listening ? "on" : "off"}</Typography>
        <Button
          variant="contained"
          color="primary"
          onClick={() => SpeechRecognition.startListening({ continuous: true, language, deviceId: selectedMicrophone })}
          sx={{ mt: 1, mr: 1 }}
        >
          Start
        </Button>
        <Button variant="contained" color="secondary" onClick={SpeechRecognition.stopListening} sx={{ mt: 1, mr: 1 }}>
          Stop
        </Button>
        <Button variant="outlined" onClick={resetTranscript} sx={{ mt: 1 }}>
          Reset
        </Button>
        <Typography variant="body1" sx={{ mt: 2 }}>
          {transcript}
        </Typography>
      </Box>
    </>
  )
}
