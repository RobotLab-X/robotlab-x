import { Box, Button, Paper } from "@mui/material"
import React from "react"

export default function CaptureControl({ service, handleCapture, handleStopCapture }) {
  return (
    <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "80%" } }}>
      <Paper elevation={3} sx={{ p: 2, m: 2 }}>
        <Box sx={{ m: 2 }}>
          <Box>
            {service?.capturing ? (
              <Button variant="contained" color="secondary" onClick={handleStopCapture} sx={{ ml: 2 }}>
                Stop Capture
              </Button>
            ) : (
              <Button variant="contained" color="primary" onClick={handleCapture}>
                Capture
              </Button>
            )}
          </Box>
        </Box>
      </Paper>
    </Box>
  )
}
