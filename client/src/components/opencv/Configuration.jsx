import { Box, Button, FormControl, InputLabel, MenuItem, Select } from "@mui/material"
import React from "react"
import { useStore } from "store/store"

export default function Configuration({ service, handleConfigChange, handleSaveConfig }) {
  const { useMessage, sendTo } = useStore()

  const handleCameraIndexChange = (event) => {
    console.log("Selected camera index:", event.target.value)
    sendTo(service?.fullname, "set_camera", event.target.value)
    handleConfigChange(event)
  }

  return (
    <Box sx={{ maxWidth: { sm: "100%", md: "80%" } }}>
      <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
        <FormControl sx={{ minWidth: 100 }} margin="normal">
          <InputLabel id="camera-index-label">Camera</InputLabel>
          <Select
            labelId="camera-index-label"
            id="camera-index"
            name="cameraIndex"
            value={service?.config?.camera_index}
            onChange={handleCameraIndexChange}
            variant="outlined"
            disabled={service?.capturing}
          >
            {[...Array(10).keys()].map((index) => (
              <MenuItem key={index} value={index}>
                {index}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>
      <Box sx={{ mt: 2, display: "flex", gap: 2 }}>
        <Button variant="contained" color="primary" onClick={handleSaveConfig}>
          Save
        </Button>
      </Box>
    </Box>
  )
}
