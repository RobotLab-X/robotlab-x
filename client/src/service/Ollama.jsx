import { Box, Button, TextField, Typography } from "@mui/material"
import React, { useEffect, useState } from "react"
import ReactJson from "react-json-view"
import StepWizard from "react-step-wizard"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

// FIXME remove fullname with context provider
export default function Ollama({ fullname }) {
  const { useMessage, sendTo } = useStore()
  const [service, setService] = useState(null)

  // makes reference to the message object in store
  const epochMsg = useMessage(fullname, "publishEpoch")

  // creates subscriptions to topics and returns the broadcastState message reference
  const serviceMsg = useServiceSubscription(fullname, ["publishEpoch"])

  // processes the msg.data[0] and returns the data
  const processedService = useProcessedMessage(serviceMsg)

  useEffect(() => {
    setService(processedService)
  }, [processedService])

  const handleFinishInstall = () => {
    const updatedService = { ...service, config: { ...service.config, installed: true } }
    setService(updatedService)
    sendTo(fullname, "applyConfig", updatedService.config)
    sendTo(fullname, "saveConfig")
  }

  const Step1 = ({ nextStep }) => (
    <Box>
      <Typography variant="h4" gutterBottom>
        Ollama API URL
      </Typography>
      <Typography variant="body2" gutterBottom>
        The Ollama API URL is needed to connect and query the API.
      </Typography>
      <TextField
        label="URL"
        name="url"
        id="url"
        variant="outlined"
        fullWidth
        margin="normal"
        placeholder="http://localhost:11434/v1/chat/completions"
        defaultValue="http://localhost:11434/v1/chat/completions"
      />
      <Button variant="contained" color="primary" onClick={nextStep} sx={{ mt: 2 }}>
        Next
      </Button>
    </Box>
  )

  const Step3 = ({ previousStep }) => (
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

  return (
    <>
      <div className="multi-step-form">
        {!service?.config?.installed && service && (
          <StepWizard>
            <Step1 />
            <Step3 />
          </StepWizard>
        )}
      </div>
      {service && <ReactJson src={service} name="service" />}
    </>
  )
}
