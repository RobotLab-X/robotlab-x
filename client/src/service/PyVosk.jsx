import MicIcon from "@mui/icons-material/Mic"
import MicOffIcon from "@mui/icons-material/MicOff"
import PauseIcon from "@mui/icons-material/Pause"
import PlayArrowIcon from "@mui/icons-material/PlayArrow"
import {
  Box,
  ButtonBase,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography
} from "@mui/material"
import React, { useEffect, useState } from "react"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"
import PythonWizard from "../wizards/PythonWizard"

export default function PyVosk({ fullname }) {
  console.debug(`PyVosk ${fullname}`)

  const [selectedMic, setSelectedMic] = useState({})
  const [selectedBackend, setSelectedBackend] = useState("")
  const [isListening, setIsListening] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [apiKey, setApiKey] = useState("")
  const [apiUser, setApiUser] = useState("")
  const [apiLocation, setApiLocation] = useState("")

  const { useMessage, sendTo } = useStore()

  const recognizedTextMsg = useMessage(fullname, "publishText")

  const serviceMsg = useServiceSubscription(fullname, ["publishText"])

  const service = useProcessedMessage(serviceMsg)
  const recognizedText = useProcessedMessage(recognizedTextMsg)

  const backends = []

  const languages = [
    "pl",
    "ja",
    "tr",
    "cs",
    "eo",
    "all",
    "ko",
    "fa",
    "it",
    "de",
    "kz",
    "vn",
    "gu",
    "en-gb",
    "fr",
    "tg",
    "uz",
    "tl-ph",
    "cn",
    "pt",
    "es",
    "ru",
    "ca",
    "nl",
    "ua",
    "en-in",
    "hi",
    "el-gr",
    "en-us",
    "ar",
    "br",
    "sv"
  ]

  const backendsRequiringApiUser = ["ibm", "houndify"]
  const backendsRequiringApiKey = ["ibm", "houndify", "azure", "google_cloud", "whisper_api"]

  useEffect(() => {
    if (service?.config?.mic) {
      setSelectedMic(service?.config?.mic)
    }
    if (service?.config?.language) {
      setSelectedBackend(service?.config?.language)
    }
  }, [service, service?.config?.mic, service?.config?.language])

  useEffect(() => {
    if (service) {
      setIsPaused(service?.paused)
    }
  }, [service, service?.paused])

  useEffect(() => {
    if (service) {
      setIsListening(service?.listening)
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

  const handleLanguageChange = (event) => {
    const language = event.target.value
    console.info(`sending -> setBackend ${language}`)
    sendTo(fullname, "setLanguage", language)
    setSelectedBackend(language)
  }

  const handleApiKeyChange = (event) => {
    setApiKey(event.target.value)
    console.info(`sending -> setApiKey ${event.target.value}`)
    sendTo(fullname, "setApiKey", event.target.value)
  }

  const handleApiUserChange = (event) => {
    setApiUser(event.target.value)
    console.info(`sending -> setApiUser ${event.target.value}`)
    sendTo(fullname, "setApiUser", event.target.value)
  }

  const handleApiLocationChange = (event) => {
    setApiLocation(event.target.value)
    console.info(`sending -> setApiLocation ${event.target.value}`)
    sendTo(fullname, "setApiLocation", event.target.value)
  }

  if (!service?.installed) {
    return <PythonWizard fullname={fullname} />
  } else {
    return (
      <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "80%" }, mt: 2 }}>
        {service?.mics && (
          <FormControl fullWidth sx={{ mt: 2 }}>
            <InputLabel id="microphone-select-label">Microphone</InputLabel>
            <Select labelId="microphone-select-label" value={selectedMic} label="Microphone" onChange={handleMicChange}>
              {Object.entries(service.mics).map(([key, value]) => (
                <MenuItem key={key} value={key}>
                  {value}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        <FormControl fullWidth sx={{ mt: 2 }}>
          <InputLabel id="languages-select-label">Languages</InputLabel>
          <Select
            labelId="languages-select-label"
            value={selectedBackend}
            label="Languages"
            onChange={handleLanguageChange}
          >
            {languages.map((language) => (
              <MenuItem key={language} value={language}>
                {language}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {backendsRequiringApiUser.includes(selectedBackend) && (
          <TextField fullWidth sx={{ mt: 2 }} label="User" type="text" value={apiUser} onChange={handleApiUserChange} />
        )}

        {selectedBackend === "azure" && (
          <TextField
            fullWidth
            sx={{ mt: 2 }}
            label="Location"
            type="text"
            value={apiLocation}
            onChange={handleApiLocationChange}
          />
        )}

        {backendsRequiringApiKey.includes(selectedBackend) && (
          <TextField
            fullWidth
            sx={{ mt: 2 }}
            label="API Key"
            type="password"
            value={apiKey}
            onChange={handleApiKeyChange}
          />
        )}
        <Box sx={{ mt: 2, display: "flex", gap: 2, alignItems: "center" }}>
          <ButtonBase
            component={Paper}
            onClick={isListening ? handleStopListening : handleStartListening}
            sx={{ display: "flex", alignItems: "center", gap: 1, p: 1, cursor: "pointer" }}
          >
            <IconButton
              color={isListening ? "secondary" : "default"}
              onClick={isListening ? handleStopListening : handleStartListening}
            >
              {isListening ? <MicIcon /> : <MicOffIcon />}
            </IconButton>
            <Typography variant="body1">{isListening ? "Listening" : "Not Listening"}</Typography>
          </ButtonBase>
          <ButtonBase
            component={Paper}
            onClick={handlePauseResumeListening}
            sx={{ display: "flex", alignItems: "center", gap: 1, p: 1, cursor: "pointer" }}
          >
            <IconButton color={isPaused ? "default" : "secondary"}>
              {isPaused ? <PlayArrowIcon /> : <PauseIcon />}
            </IconButton>
            <Typography variant="body1">{isPaused ? "Paused" : "Not Paused"}</Typography>
          </ButtonBase>
        </Box>
        <Box sx={{ mt: 2 }}>
          <Typography variant="body1">Recognized: {recognizedText}</Typography>
        </Box>
      </Box>
    )
  }
}
