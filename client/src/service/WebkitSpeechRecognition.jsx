import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import { Box, Button, FormControl, IconButton, InputLabel, MenuItem, Select, Typography } from "@mui/material"
import { useProcessedMessage } from "hooks/useProcessedMessage"
import React, { useEffect, useState } from "react"
import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition"
import { useStore } from "store/store"
import useServiceSubscription from "store/useServiceSubscription"

// FIXME remove fullname with context provider
export default function WebkitSpeechRecognition({ fullname }) {
  console.debug(`WebkitSpeechRecognition ${fullname}`)

  const [editMode, setEditMode] = useState(false)
  const [language, setLanguage] = useState("en-US") // Default language
  const { useMessage, sendTo } = useStore()
  const epochMsg = useMessage(fullname, "publishEpoch")
  const serviceMsg = useServiceSubscription(fullname, ["publishEpoch"])
  const service = useProcessedMessage(serviceMsg)
  const timestamp = useProcessedMessage(epochMsg)

  const toggleEditMode = () => {
    setEditMode(!editMode)
  }

  const handleStart = () => {
    sendTo(fullname, "startWebkitSpeechRecognition")
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

  let dateStr = (timestamp && new Date(timestamp).toLocaleString()) || ""

  const { transcript, listening, resetTranscript, browserSupportsSpeechRecognition } = useSpeechRecognition()

  useEffect(() => {
    if (!listening) {
      const timer = setTimeout(() => {
        if (!listening) {
          SpeechRecognition.startListening({ continuous: true, language })
        }
      }, 1000)
      return () => clearTimeout(timer)
    }
  }, [listening, language])

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
      <Box sx={{ display: "flex", alignItems: "center", cursor: "pointer" }} onClick={toggleEditMode}>
        <Typography variant="h6">Configuration</Typography>
        <IconButton>{editMode ? <ExpandLessIcon /> : <ExpandMoreIcon />}</IconButton>
      </Box>
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
          onClick={() => SpeechRecognition.startListening({ continuous: true, language })}
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
