import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import { Box, Button, Checkbox, FormControlLabel, MenuItem, Select, TextField, Typography } from "@mui/material"
import React, { useEffect, useState } from "react"
import useSubscription from "store/useSubscription"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"

export default function Polly({ fullname }) {
  console.debug(`Polly ${fullname}`)

  const [editMode, setEditMode] = useState(false)
  const [text, setText] = useState("")
  const [secretId, setSecretId] = useState("")
  const [region, setRegion] = useState("")
  const [secretAccessKey, setSecretAccessKey] = useState("")
  const [selectedVoice, setSelectedVoice] = useState("")
  const [autoClear, setAutoClear] = useState(true) // State to control auto-clear functionality
  const service = useSubscription(fullname, "broadcastState", true)
  const { useMessage, sendTo } = useStore()
  const publishSpeakingMsg = useMessage(fullname, "publishSpeaking")
  const spoken = useProcessedMessage(publishSpeakingMsg)

  useEffect(() => {
    if (service?.config) {
      setSecretId(service.config.secretId)
      setSecretAccessKey(service.config.secretAccessKey)
      setSelectedVoice(service.config.voice)
      setRegion(service.config.region)
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

    if (autoClear) {
      setText("") // Clear text if autoClear is enabled
    }
  }

  const handleConfigChange = (event) => {
    const { id, value } = event.target
    if (id === "secretId") {
      setSecretId(value)
    } else if (id === "secretAccessKey") {
      setSecretAccessKey(value)
    } else if (id === "region") {
      setRegion(value)
    }
  }

  const handleVoiceChange = (event) => {
    setSelectedVoice(event.target.value)
  }

  const handleSaveConfig = () => {
    service.config.secretId = secretId
    service.config.secretAccessKey = secretAccessKey
    service.config.voice = selectedVoice
    sendTo(fullname, "applyConfig", service.config)
    sendTo(fullname, "broadcastState")
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
            <TextField
              label="Region"
              id="region"
              type="text"
              variant="outlined"
              fullWidth
              margin="normal"
              value={region}
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

          <Box sx={{ mt: 2, display: "flex", gap: 2, justifyContent: "flex-end" }}>
            <Button variant="contained" color="primary" onClick={handleSaveConfig}>
              Apply
            </Button>
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
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleSpeak()
                }
              }}
              sx={{ flex: 1 }} // Ensure consistent width
            />
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", mt: 2 }}>
            <Button variant="contained" color="primary" onClick={handleSpeak}>
              Speak
            </Button>
            <FormControlLabel
              control={
                <Checkbox checked={autoClear} onChange={(e) => setAutoClear(e.target.checked)} color="primary" />
              }
              label="Auto-clear text"
              sx={{ ml: 2 }}
            />
          </Box>
        </Box>
      </Box>{" "}
    </>
  )
}
