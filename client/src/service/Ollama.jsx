import { ArrowBack, ArrowForward } from "@mui/icons-material"
import ArrowUpwardOutlined from "@mui/icons-material/ArrowUpwardOutlined"
import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import {
  Box,
  Button,
  Card,
  CardContent,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
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
export default function Ollama({ name, fullname, id }) {
  const { useMessage, sendTo } = useStore()
  const getBaseUrl = useStore((state) => state.getBaseUrl)
  const [config, setConfig] = useState(null)
  const [chatInput, setChatInput] = useState("")
  const [chatHistory, setChatHistory] = useState([])
  const [editMode, setEditMode] = useState(false)

  const chatMsg = useMessage(fullname, "publishChat")

  const [prompts, setPrompts] = useState({})
  const [promptKeys, setPromptKeys] = useState([])
  const [currentPromptIndex, setCurrentPromptIndex] = useState(0)

  const serviceMsg = useServiceSubscription(fullname, ["publishChat"])
  const service = useProcessedMessage(serviceMsg)
  const chat = useProcessedMessage(chatMsg)

  // backend update resets the config
  useEffect(() => {
    if (service /* && config === null */) {
      // DEEP COPY !
      // setConfig(JSON.parse(JSON.stringify(service.config)))
      setPrompts(service.prompts)
      // NOT A COPY !
      setConfig(service.config)
    }
  }, [service])

  useEffect(() => {
    if (service?.prompts) {
      setPrompts(service.prompts)
      setPromptKeys(Object.keys(service.prompts))
    }
  }, [service])

  const handleNext = () => {
    setCurrentPromptIndex((prevIndex) => (prevIndex + 1) % promptKeys.length)
  }

  const handlePrev = () => {
    setCurrentPromptIndex((prevIndex) => (prevIndex - 1 + promptKeys.length) % promptKeys.length)
  }

  const currentPromptKey = promptKeys[currentPromptIndex]
  const currentPrompt = prompts[currentPromptKey]

  useEffect(() => {
    if (config?.prompt) {
      const cardIndex = promptKeys.indexOf(config.prompt)
      if (cardIndex !== -1) {
        setCurrentPromptIndex(cardIndex)
      }
    }
  }, [config?.prompt, promptKeys])

  useEffect(() => {
    if (chat) {
      // Add the new message to the log
      console.log("new install log msg:", chat)
      const newMessage = { user: "Bot", message: chat }
      setChatHistory([...chatHistory, newMessage])
    }
  }, [chat])

  const toggleEditMode = () => {
    setEditMode(!editMode)
  }

  // could probably be normalized with handleSaveConfig
  const handleFinishInstall = () => {
    // const updatedService = { ...service, config: { ...service.config, installed: true, url: installUrl } }
    //     setService(updatedService)
    config.installed = true
    sendTo(fullname, "applyConfig", config)
    sendTo(fullname, "saveConfig")
    sendTo(fullname, "broadcastState")
  }

  const handleSaveConfig = () => {
    // const updatedService = { ...service, config: { ...service.config, url, maxHistory } }
    //     setService(updatedService)
    config.prompt = currentPromptKey
    sendTo(fullname, "applyConfig", config)
    sendTo(fullname, "saveConfig")
    sendTo(fullname, "broadcastState")
    setEditMode(false)
  }

  // can handle any config field change if the edit name matches the config name
  const handleConfigChange = (event) => {
    const { name, value, type } = event.target
    const newValue = type === "number" ? Number(value) : value
    setConfig((prevConfig) => ({
      ...prevConfig,
      [name]: newValue
    }))
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

  return (
    <>
      <br />
      <div className="multi-step-form">
        {!service?.config?.installed && service && (
          <OllamaWizard
            config={config}
            handleConfigChange={handleConfigChange}
            handleFinishInstall={handleFinishInstall}
          />
        )}
      </div>
      {service?.config?.installed && service && (
        <>
          <h3 style={{ display: "flex", alignItems: "center", cursor: "pointer" }} onClick={toggleEditMode}>
            Configuration
            {editMode ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </h3>
          {editMode ? (
            <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "30%" } }}>
              <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
                <FormControl variant="outlined" sx={{ minWidth: 200 }}>
                  <InputLabel id="model-select-label">Model</InputLabel>
                  <Select
                    labelId="model-select-label"
                    id="model-select"
                    name="model"
                    value={config?.model}
                    onChange={handleConfigChange}
                    label="Model"
                  >
                    <MenuItem value="llama3">llama3</MenuItem>
                    <MenuItem value="llama2">llama2</MenuItem>
                    <MenuItem value="phi-beta">phi-beta</MenuItem>
                  </Select>
                </FormControl>
              </Box>

              <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
                <TextField
                  label="URL"
                  name="url"
                  variant="outlined"
                  fullWidth
                  margin="normal"
                  value={config?.url}
                  onChange={handleConfigChange}
                  sx={{ flex: 1 }} // Ensure consistent width
                />
                <TextField
                  label="Max History"
                  name="maxHistory"
                  variant="outlined"
                  fullWidth
                  margin="normal"
                  type="number"
                  value={config?.maxHistory}
                  onChange={handleConfigChange}
                  sx={{ flex: 1 }} // Ensure consistent width
                />
              </Box>

              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", mt: 5 }}>
                <IconButton onClick={handlePrev} disabled={promptKeys.length <= 1}>
                  <ArrowBack />
                </IconButton>
                <Card sx={{ minWidth: 275, mx: 2 }}>
                  <CardContent>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                      <img
                        src={`${getBaseUrl()}/service/${name}/prompts/${currentPromptKey}.png`}
                        width="64"
                        alt="robot pict"
                      />
                      <Typography variant="h2" component="div">
                        {currentPromptKey}
                      </Typography>
                    </Box>
                    <Typography variant="h5" component="div">
                      {currentPrompt.description}
                    </Typography>
                    <Typography variant="subtitle1" component="span" color="textSecondary">
                      {currentPrompt.prompt}
                    </Typography>
                  </CardContent>
                </Card>
                <IconButton onClick={handleNext} disabled={promptKeys.length <= 1}>
                  <ArrowForward />
                </IconButton>
              </Box>

              <Box sx={{ mt: 2, display: "flex", gap: 2 }}>
                <Button variant="contained" color="primary" onClick={handleSaveConfig}>
                  Save
                </Button>
              </Box>
            </Box>
          ) : null}

          <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "30%" } }}>
            <TableContainer component={Paper}>
              <Table>
                <TableBody>
                  {chatHistory.map((chat, index) => (
                    <TableRow key={index}>
                      <TableCell align={chat.user === "You" ? "right" : "left"}>{chat.message}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
          <Box sx={{ width: { xs: "100%", sm: "80%", md: "30%" } }}>
            <TextField
              sx={{ width: "100%" }}
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
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton color="primary" onClick={handleSendChat}>
                      <ArrowUpwardOutlined />
                    </IconButton>
                  </InputAdornment>
                )
              }}
            />
          </Box>
        </>
      )}
    </>
  )
}
