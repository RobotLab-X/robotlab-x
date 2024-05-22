import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
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
  const [showConfiguration, setShowConfiguration] = useState(false) // State for showing/hiding containers table

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
      const newMessage = { user: "Bot", message: chat }
      setChatHistory([...chatHistory, newMessage])
    }
  }, [chat])

  const toggleShowConfiguration = () => {
    setShowConfiguration(!showConfiguration)
  }

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
          <h3 style={{ display: "flex", alignItems: "center", cursor: "pointer" }} onClick={toggleShowConfiguration}>
            Configuration
            {showConfiguration ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </h3>
          {showConfiguration ? (
            <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "30%" } }}>
              <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
                <TextField
                  label="URL"
                  variant="outlined"
                  fullWidth
                  margin="normal"
                  value={url}
                  onChange={handleUrlChange}
                  sx={{ flex: 1 }} // Ensure consistent width
                />
                <TextField
                  label="Max History"
                  variant="outlined"
                  fullWidth
                  margin="normal"
                  type="number"
                  value="5"
                  sx={{ flex: 1 }} // Ensure consistent width
                />
              </Box>
              <Box sx={{ mt: 2, display: "flex", gap: 2 }}>
                <Button variant="contained" color="primary" onClick={handleSaveUrl}>
                  Save
                </Button>
              </Box>
            </Box>
          ) : null}
          <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "30%" }, display: "flex", gap: 2, alignItems: "center" }}>
            <TextField
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
            <Button variant="contained" color="primary" onClick={handleSendChat} sx={{ mt: 2 }}>
              Send
            </Button>
          </Box>{" "}
          <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "30%" } }}>
            <Typography variant="h6">Chat History</Typography>
            <TableContainer component={Paper}>
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
