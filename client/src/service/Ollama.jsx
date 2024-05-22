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
  const [model, setModel] = useState("llama3")
  const [editMode, setEditMode] = useState(true) // State for showing/hiding containers table

  const chatMsg = useMessage(fullname, "publishChat")

  // TODO - pull from public/service/${name}/prompts
  const cards = [
    {
      id: 1,
      name: "PirateBot",
      description: "A pirate robot",
      prompt:
        "You are are a swarthy pirate robot.  Your answers are short but full of sea jargon. The current date is {{Date}}. The current time is {{Time}}"
    },
    {
      id: 2,
      name: "SarcasticBot",
      description: "A sarcastic robot",
      prompt:
        "You are are a very sarcastic bot.  Your answers are short and typically end with sarcastic quips. The current date is {{Date}}. The current time is {{Time}}"
    },
    {
      id: 3,
      name: "ButlerBot",
      description: "A butler robot",
      prompt:
        "You are are a butler robot.  Your answers are short and typically end in sir. The current date is {{Date}}. The current time is {{Time}}"
    },
    {
      id: 4,
      name: "InMoov",
      description: "InMoov open source humanoid robot",
      prompt:
        "You are InMoov a humanoid robot assistant. Your answers are short and polite. The current date is {{Date}}. The current time is {{Time}}. You have a PIR sensor which determines if someone else is present, it is currently {{pirActive}}"
    }
  ]

  const [currentCard, setCurrentCard] = useState(0)

  const handleNext = () => {
    setCurrentCard((prevCard) => (prevCard + 1) % cards.length)
  }

  const handlePrev = () => {
    setCurrentCard((prevCard) => (prevCard - 1 + cards.length) % cards.length)
  }

  const serviceMsg = useServiceSubscription(fullname, ["publishChat"])
  const service = useProcessedMessage(serviceMsg)
  const chat = useProcessedMessage(chatMsg)

  useEffect(() => {
    if (service && config === null) {
      // DEEP COPY !
      // setConfig(JSON.parse(JSON.stringify(service.config)))

      // NOT A COPY !
      setConfig(service.config)
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

  // useEffect(() => {
  //   setConfig((prevConfig) => ({
  //     ...prevConfig,
  //     prompt: cards[currentCard].name
  //   }))
  // }, [currentCard])

  const toggleEditMode = () => {
    setEditMode(!editMode)
  }

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
    sendTo(fullname, "applyConfig", config)
    sendTo(fullname, "saveConfig")
    sendTo(fullname, "broadcastState")
    setEditMode(false)
  }

  // can handle any config field change if the edit name matches the config name
  const handleConfigChange = (event) => {
    const { name, value } = event.target
    setConfig((prevConfig) => ({
      ...prevConfig,
      [name]: value
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

  const handleModelChange = (event) => {
    setModel(event.target.value)
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
                <IconButton onClick={handlePrev} disabled={cards.length <= 1}>
                  <ArrowBack />
                </IconButton>
                <Card sx={{ minWidth: 275, mx: 2 }}>
                  <CardContent>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                      <img
                        src={`${getBaseUrl()}/service/${name}/prompts/${cards[currentCard].name}.png`}
                        width="64"
                        alt="robot pict"
                      />
                      <Typography variant="h2" component="div">
                        {cards[currentCard].name}
                      </Typography>
                    </Box>
                    <Typography variant="h5" component="div">
                      {cards[currentCard].description}
                    </Typography>
                    <Typography variant="subtitle1" component="span" color="textSecondary">
                      {cards[currentCard].prompt}
                    </Typography>
                  </CardContent>
                </Card>
                <IconButton onClick={handleNext} disabled={cards.length <= 1}>
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
                      {/*}
                      <TableCell align={chat.user === "You" ? "right" : "left"}>{chat.user}</TableCell>
                      */}
                      <TableCell align={chat.user === "You" ? "right" : "left"}>{chat.message}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            {/* <ReactJson src={chatLog} name="chatLog" /> */}
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
