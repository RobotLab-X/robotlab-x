import { Box, Button } from "@mui/material"
import React from "react"

export default function CaptureControl({ service, handleCapture, handleStopCapture }) {
  return (
    <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "80%" } }}>
      <Box>
        {service?.capturing ? (
          <Button variant="contained" color="secondary" onClick={handleStopCapture} sx={{ ml: 4 }}>
            Stop Capture
          </Button>
        ) : (
          <Button variant="contained" color="primary" onClick={handleCapture} sx={{ ml: 4 }}>
            Capture
          </Button>
        )}
      </Box>
    </Box>
  )
}
