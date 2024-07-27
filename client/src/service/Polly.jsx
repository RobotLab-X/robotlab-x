import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import { Box, Button, MenuItem, Select, TextField, Typography } from "@mui/material"
import React, { useEffect, useState } from "react"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

// FIXME remove fullname with context provider
export default function Polly({ fullname }) {
  console.debug(`Polly ${fullname}`)

  const [editMode, setEditMode] = useState(false)
  const [text, setText] = useState("")
  const [secretId, setSecretId] = useState("")
  const [secretAccessKey, setSecretAccessKey] = useState("")
  const [selectedVoice, setSelectedVoice] = useState("")

  const { useMessage, sendTo } = useStore()
  const publishSpeakingMsg = useMessage(fullname, "publishSpeaking")
  const serviceMsg = useServiceSubscription(fullname, ["publishSpeaking"])
  const service = useProcessedMessage(serviceMsg)
  const spoken = useProcessedMessage(publishSpeakingMsg)

  useEffect(() => {
    if (service?.config) {
      setSecretId(service.config.secretId)
      setSecretAccessKey(service.config.secretAccessKey)
      setSelectedVoice(service.config.voice)
    }
  }, [service, fullname])

  const playAudio = () => {
    window.electron.playAudio(audioFile)
  }

  const toggleEditMode = () => {
    setEditMode(!editMode)
  }

  const handleSpeak = () => {
    sendTo(fullname, "speak", text)
  }

  const handleConfigChange = (event) => {
    const { id, value } = event.target
    if (id === "secretId") {
      setSecretId(value)
    } else if (id === "secretAccessKey") {
      setSecretAccessKey(value)
    }
  }

  const handleVoiceChange = (event) => {
    setSelectedVoice(event.target.value)
  }

  const handleSaveConfig = () => {
    sendTo(fullname, "applyConfigValue", "secretId", secretId)
    sendTo(fullname, "applyConfigValue", "secretAccessKey", secretAccessKey)
    sendTo(fullname, "applyConfigValue", "voice", selectedVoice)
    setEditMode(false)
  }

  return (
    <>
      <h3 style={{ display: "flex", alignItems: "center", cursor: "pointer" }} onClick={toggleEditMode}>
        Configuration
        {editMode ? <ExpandLessIcon /> : <ExpandMoreIcon />}
      </h3>
      {editMode ? (
        <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "80%" } }}>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "center" }}>
            <TextField
              label="Secret ID"
              id="secretId"
              type="password"
              variant="outlined"
              fullWidth
              margin="normal"
              value={secretId}
              onChange={handleConfigChange}
              sx={{ flex: 1 }} // Ensure consistent width
            />
            <TextField
              label="Secret Access Key"
              id="secretAccessKey"
              type="password"
              variant="outlined"
              fullWidth
              margin="normal"
              value={secretAccessKey}
              onChange={handleConfigChange}
              sx={{ flex: 1 }} // Ensure consistent width
            />
            <Select
              label="Voice"
              value={selectedVoice}
              onChange={handleVoiceChange}
              fullWidth
              margin="normal"
              sx={{ flex: 1 }}
            >
              {service?.voices.map((voice) => (
                <MenuItem key={voice.id} value={voice.id}>
                  {`${voice.name} (${voice.language}, ${voice.gender})`}
                </MenuItem>
              ))}
            </Select>
          </Box>

          <Box sx={{ mt: 2, display: "flex", gap: 2 }}>
            <Button variant="contained" color="primary" onClick={handleSaveConfig}>
              Save
            </Button>
          </Box>
        </Box>
      ) : null}

      <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "80%" } }}>
        <Box sx={{ m: 2 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            {spoken}
          </Typography>
          <Box>
            <TextField
              label="Text to Speak"
              variant="outlined"
              fullWidth
              margin="normal"
              value={text}
              onChange={(e) => setText(e.target.value)}
              sx={{ flex: 1 }} // Ensure consistent width
            />
          </Box>
          <Box>
            <Button variant="contained" color="primary" onClick={handleSpeak}>
              Speak
            </Button>
          </Box>
        </Box>
      </Box>
    </>
  )
}
