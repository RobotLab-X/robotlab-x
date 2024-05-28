// Clock.jsx
import { Box, Button, Paper, Typography } from "@mui/material"
import React from "react"

export default function Clock({ service, epoch, handleStart, handleStop }) {
  return (
    <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "30%" } }}>
      <Paper elevation={3} sx={{ p: 2, m: 2 }}>
        <Box sx={{ m: 2 }}>
          <Typography variant="h4" sx={{ mb: 2 }}>
            Interval (ms) <br /> {service?.config.interval}&nbsp;
          </Typography>
          <Typography variant="h4" sx={{ mb: 2 }}>
            Timestamp (ms) <br /> {epoch}&nbsp;
          </Typography>
          <Typography variant="h4" sx={{ mb: 2 }}>
            Formatted Date/Time <br /> {epoch}&nbsp;
          </Typography>
          <Box>
            <Button variant="contained" color="primary" onClick={handleStart}>
              Start
            </Button>
            <Button variant="contained" color="secondary" onClick={handleStop} sx={{ ml: 2 }}>
              Stop
            </Button>
          </Box>
        </Box>
      </Paper>
    </Box>
  )
}
