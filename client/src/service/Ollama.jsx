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
import { useProcessedMessage } from "hooks/useProcessedMessage"
import { useStore } from "store/store"
import useServiceSubscription from "store/useServiceSubscription"
import OllamaWizard from "wizards/OllamaWizard"

// FIXME remove fullname with context provider
export default function Ollama({ fullname }) {
  const { useMessage, sendTo } = useStore()
  // const [service, setService] = useState(null)
  const [isEditingUrl, setIsEditingUrl] = useState(false)
  const [url, setUrl] = useState("")
  const [installUrl, setInstallUrl] = useState("")
  const [chatInput, setChatInput] = useState("")
  const [chatHistory, setChatHistory] = useState([])
  const [model, setModel] = useState("llama3")
  const [chatLog, setChatLog] = useState([])

  const chatMsg = useMessage(fullname, "publishChat")

  // creates subscriptions to topics and returns the broadcastState message reference
  const serviceMsg = useServiceSubscription(fullname, ["publishChat"])

  // processes the msg.data[0] and returns the data
  const service = useProcessedMessage(serviceMsg)
  const chat = useProcessedMessage(chatMsg)

  useEffect(() => {
    // setService(processedService)
    if (!installUrl && service?.config?.url) {
      setUrl(service.config.url)
      setInstallUrl(service.config.url) // Ensure installUrl is also initialized
    }
  }, [service])

  useEffect(() => {
    if (chat) {
      // Add the new message to the log
      console.log("new install log msg:", chat)
      setChatLog((log) => [...log, chat])
      const newMessage = { user: "Bot", message: chat }
      setChatHistory([...chatHistory, newMessage])
    }
  }, [chat])

  const handleFinishInstall = () => {
    const updatedService = { ...service, config: { ...service.config, installed: true, url: installUrl } }
    //     setService(updatedService)
    sendTo(fullname, "applyConfig", updatedService.config)
    sendTo(fullname, "saveConfig")
    sendTo(fullname, "broadcastState")
  }

  const handleEditUrl = () => {
    setIsEditingUrl(true)
  }

  const handleSaveUrl = () => {
    const updatedService = { ...service, config: { ...service.config, url } }
    //     setService(updatedService)
    setIsEditingUrl(false)
    sendTo(fullname, "applyConfig", updatedService.config)
    sendTo(fullname, "saveConfig")
    sendTo(fullname, "broadcastState")
  }

  const handleUrlChange = (event) => {
    setUrl(event.target.value)
  }

  const handleInstallUrlChange = (event) => {
    setInstallUrl(event.target.value)
  }

  const handleChatInputChange = (event) => {
    setChatInput(event.target.value)
  }

  const handleSendChat = () => {
    if (chatInput.trim() !== "") {
      // sendTo(fullname, "getResponse", { model: model, message: chatInput })
      sendTo(fullname, "chat", chatInput)
      const newMessage = { user: "You", message: chatInput }
      setChatHistory([...chatHistory, newMessage])
      // Optionally, send the message to the backend here
      setChatInput("")
    }
  }

  const handleModelChange = (event) => {
    setModel(event.target.value)
  }

  return (
    <>
      <br />
      <div className="multi-step-form">
        {!service?.config?.installed && service && (
          <OllamaWizard
            installUrl={installUrl}
            handleInstallUrlChange={handleInstallUrlChange}
            handleFinishInstall={handleFinishInstall}
          />
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
              <MenuItem value="llama3">llama3</MenuItem>
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
                  sx={{ maxWidth: { xs: "100%", sm: "80%", md: "30%" } }} // Ensure consistent width
                />
                <Button variant="contained" color="primary" onClick={handleSaveUrl} sx={{ mt: 2 }}>
                  Save
                </Button>
              </>
            ) : (
              <>
                <Typography variant="body1" sx={{ maxWidth: { xs: "100%", sm: "80%", md: "30%" } }}>
                  URL: {service.config.url}
                </Typography>
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
          {/* <ReactJson src={chatLog} name="chatLog" /> */}
        </>
      )}
    </>
  )
}
