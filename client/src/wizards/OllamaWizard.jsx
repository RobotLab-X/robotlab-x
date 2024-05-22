// OllamaWizard.jsx
import { Box, Button, TextField, Typography } from "@mui/material"
import React from "react"
import StepWizard from "react-step-wizard"

// Step1 Component
const Step1 = ({ nextStep, config, handleConfigChange }) => (
  <Box>
    <Typography variant="h4" gutterBottom>
      Ollama API URL
    </Typography>
    <Typography variant="body2" gutterBottom>
      The Ollama base API URL is needed to connect and query the API.
    </Typography>
    <TextField
      label="URL"
      name="url"
      id="url"
      variant="outlined"
      fullWidth
      margin="normal"
      value={config?.url}
      onChange={handleConfigChange}
      sx={{ maxWidth: { xs: "100%", sm: "80%", md: "30%" } }} // Ensure consistent width
    />
    <Button variant="contained" color="primary" onClick={nextStep} sx={{ mt: 2 }}>
      Next
    </Button>
  </Box>
)

// Step3 Component
const Step3 = ({ previousStep, handleFinishInstall }) => (
  <Box>
    <Typography variant="h4" gutterBottom>
      Done!
    </Typography>
    <Typography variant="body1" gutterBottom>
      You should be ready to use the Ollama service now.
    </Typography>
    <Box sx={{ mt: 2 }}>
      <Button variant="contained" color="secondary" onClick={previousStep} sx={{ mr: 2 }}>
        Previous
      </Button>
      <Button variant="contained" color="primary" onClick={handleFinishInstall}>
        Finish
      </Button>
    </Box>
  </Box>
)

const OllamaWizard = ({ config, handleConfigChange, handleFinishInstall }) => (
  <StepWizard>
    <Step1 config={config} handleConfigChange={handleConfigChange} />
    <Step3 handleFinishInstall={handleFinishInstall} />
  </StepWizard>
)

export default OllamaWizard
