import { Box, TextField, Typography } from "@mui/material"
import React from "react"

export default function ProgramAB({ service, handleInputSubmit, inputValue, setInputValue, response }) {
  const handleInputChange = (event) => {
    setInputValue(event.target.value)
  }

  return (
    <Box sx={{ maxWidth: "600px", mx: "auto", mt: 4 }}>
      <Typography variant="h4" gutterBottom>
        Program AB
      </Typography>
      {response && (
        <Box sx={{ mb: 2, p: 2, backgroundColor: "#f5f5f5", borderRadius: "4px" }}>
          <Typography variant="body2" component="pre">
            {response?.botName}: {response?.msg}
          </Typography>
        </Box>
      )}
      <TextField
        label="Type your message"
        variant="outlined"
        fullWidth
        margin="normal"
        value={inputValue}
        onChange={handleInputChange}
        onKeyDown={handleInputSubmit}
        sx={{ mt: 2 }}
      />
    </Box>
  )
}
