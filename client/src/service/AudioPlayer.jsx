import PauseIcon from "@mui/icons-material/Pause"
import PlayArrowIcon from "@mui/icons-material/PlayArrow"
import RepeatIcon from "@mui/icons-material/Repeat"
import RepeatOneIcon from "@mui/icons-material/RepeatOne"
import StopIcon from "@mui/icons-material/Stop"
import { Box, Grid, IconButton, TextField, Typography } from "@mui/material"
import React, { useState } from "react"
import { useStore } from "store/store"
import useSubscription from "store/useSubscription"

export default function AudioPlayer({ fullname }) {
  const [currentAudioFile, setCurrentAudioFile] = useState("")
  const [isRepeating, setIsRepeating] = useState(false)
  const service = useSubscription(fullname, "broadcastState", true)
  const currentlyPlayingAudioFile = useSubscription(fullname, "publishAudioStarted")

  const { sendTo } = useStore()

  const handleStart = () => {
    sendTo(fullname, "play", currentAudioFile)
  }

  const handlePause = () => {
    sendTo(fullname, "pause")
  }

  const handleStop = () => {
    sendTo(fullname, "stop")
  }

  const handleRepeat = () => {
    sendTo(fullname, "setIsRepeating", !isRepeating)
    setIsRepeating(!isRepeating)
  }

  const getFileName = (filePath) => {
    return filePath ? filePath.split(/[/\\]/).pop() : "" // Extracts filename from any path format
  }

  return (
    <Box sx={{ p: 2, border: "1px solid gray", borderRadius: "8px" }}>
      <Typography variant="h6" gutterBottom>
        Audio Player {currentlyPlayingAudioFile ? "playing: " + getFileName(currentlyPlayingAudioFile) : ""}
      </Typography>
      <TextField
        fullWidth
        variant="outlined"
        value={currentAudioFile}
        onChange={(e) => setCurrentAudioFile(e.target.value)}
        placeholder="Enter audio file path"
        sx={{ mb: 2 }}
      />
      <Grid container spacing={2} justifyContent="center">
        <Grid item>
          <IconButton color="primary" onClick={handleStart}>
            <PlayArrowIcon />
          </IconButton>
        </Grid>
        <Grid item>
          <IconButton color="secondary" onClick={handlePause}>
            <PauseIcon />
          </IconButton>
        </Grid>
        <Grid item>
          <IconButton color="error" onClick={handleStop}>
            <StopIcon />
          </IconButton>
        </Grid>
        <Grid item>
          <IconButton color="default" onClick={handleRepeat}>
            {isRepeating ? <RepeatIcon /> : <RepeatOneIcon />}
          </IconButton>
        </Grid>
      </Grid>
    </Box>
  )
}
