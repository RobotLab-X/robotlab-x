import {
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography
} from "@mui/material"
import React, { useEffect, useState } from "react"
// import ReactJson from "react-json-view"
import StepWizard from "react-step-wizard"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

// FIXME remove fullname with context provider
export default function Ollama({ fullname }) {
  const { useMessage, sendTo } = useStore()
  const [service, setService] = useState(null)
  const [isEditingUrl, setIsEditingUrl] = useState(false)
  const [url, setUrl] = useState("")
  const [installUrl, setInstallUrl] = useState("")
  const [chatInput, setChatInput] = useState("")
  const [chatHistory, setChatHistory] = useState([])
  const [model, setModel] = useState("Model 1")

  // makes reference to the message object in store
  const epochMsg = useMessage(fullname, "publishEpoch")

  // creates subscriptions to topics and returns the broadcastState message reference
  const serviceMsg = useServiceSubscription(fullname, ["publishEpoch"])

  // processes the msg.data[0] and returns the data
  const processedService = useProcessedMessage(serviceMsg)

  useEffect(() => {
    setService(processedService)
    if (processedService?.config?.url) {
      setUrl(processedService.config.url)
    }
  }, [processedService])

  const handleFinishInstall = () => {
    const updatedService = { ...service, config: { ...service.config, installed: true, url: installUrl } }
    setService(updatedService)
    sendTo(fullname, "applyConfig", updatedService.config)
    sendTo(fullname, "saveConfig")
  }

  const handleEditUrl = () => {
    setIsEditingUrl(true)
  }

  const handleSaveUrl = () => {
    const updatedService = { ...service, config: { ...service.config, url } }
    setService(updatedService)
    setIsEditingUrl(false)
    sendTo(fullname, "applyConfig", updatedService.config)
    sendTo(fullname, "saveConfig")
  }

  const handleUrlChange = (event) => {
    setInstallUrl(event.target.value)
  }

  const handleChatInputChange = (event) => {
    setChatInput(event.target.value)
  }

  const handleSendChat = () => {
    if (chatInput.trim() !== "") {
      const newMessage = { user: "You", message: chatInput }
      setChatHistory([...chatHistory, newMessage])
      // Optionally, send the message to the
      // backend here
      setChatInput("")
    }
  }

  const handleModelChange = (event) => {
    setModel(event.target.value)
  }

  const Step1 = ({ nextStep }) => (
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
        placeholder={service?.config?.url}
        defaultValue={service?.config?.url}
        onChange={(e) => setInstallUrl(e.target.value)}
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
      <br />
      <div className="multi-step-form">
        {!service?.config?.installed && service && (
          <StepWizard>
            <Step1 />
            <Step3 />
          </StepWizard>
        )}
      </div>
      {service?.config?.installed && (
        <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
          <FormControl variant="outlined" sx={{ minWidth: 200 }}>
            <InputLabel id="model-select-label">Model</InputLabel>
            <Select
              labelId="model-select-label"
              id="model-select"
              value={model}
              onChange={handleModelChange}
              label="Model"
            >
              <MenuItem value="llama3">lama3</MenuItem>
              <MenuItem value="llama2">llama2</MenuItem>
              <MenuItem value="phi-beta">phi-beta</MenuItem>
            </Select>
          </FormControl>
        </Box>
      )}
      {service?.config?.installed && service && (
        <>
          <Box sx={{ mt: 4 }}>
            <Typography variant="h5">Service Configuration</Typography>
            {isEditingUrl ? (
              <>
                <TextField
                  label="URL"
                  variant="outlined"
                  fullWidth
                  margin="normal"
                  value={url}
                  onChange={handleUrlChange}
                />
                <Button variant="contained" color="primary" onClick={handleSaveUrl} sx={{ mt: 2 }}>
                  Save
                </Button>
              </>
            ) : (
              <>
                <Typography variant="body1">URL: {service.config.url}</Typography>
                <Button variant="contained" color="secondary" onClick={handleEditUrl} sx={{ mt: 2 }}>
                  Edit
                </Button>
              </>
            )}
          </Box>

          <Box sx={{ mt: 4 }}>
            <TextField
              sx={{ maxWidth: { xs: "100%", sm: "80%", md: "30%" } }}
              label="Type your message"
              variant="outlined"
              fullWidth
              margin="normal"
              value={chatInput}
              onChange={handleChatInputChange}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleSendChat()
                }
              }}
            />
            <br />
            <Button variant="contained" color="primary" onClick={handleSendChat} sx={{ mt: 2 }}>
              Send
            </Button>
          </Box>
          <Box sx={{ mt: 4 }}>
            <Typography variant="h6">Chat History</Typography>
            <TableContainer component={Paper} sx={{ maxWidth: { xs: "100%", sm: "80%", md: "30%" } }}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>User</TableCell>
                    <TableCell>Message</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {chatHistory.map((chat, index) => (
                    <TableRow key={index}>
                      <TableCell>{chat.user}</TableCell>
                      <TableCell>{chat.message}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
          {/*<ReactJson src={service} name="service" />*/}
        </>
      )}
    </>
  )
}
