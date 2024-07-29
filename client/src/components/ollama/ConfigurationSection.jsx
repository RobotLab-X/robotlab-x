import { ArrowBack, ArrowForward } from "@mui/icons-material"
import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import {
  Box,
  Button,
  Card,
  CardContent,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography
} from "@mui/material"
import { useProcessedMessage } from "hooks/useProcessedMessage"
import React, { useEffect, useState } from "react"
import { useStore } from "store/store"
import useServiceSubscription from "store/useServiceSubscription"
import PromptCard from "./PromptCard"

const ConfigurationSection = ({ fullname }) => {
  const { sendTo } = useStore()
  const getBaseUrl = useStore((state) => state.getBaseUrl)
  const [config, setConfig] = useState(null)
  const [prompts, setPrompts] = useState({})
  const [promptKeys, setPromptKeys] = useState([])
  const [currentPromptIndex, setCurrentPromptIndex] = useState(0)
  const [editMode, setEditMode] = useState(false)
  const [selectedModelDetails, setSelectedModelDetails] = useState({ name: "", description: "" })
  const [selectedAvailableModel, setSelectedAvailableModel] = useState("")

  const serviceMsg = useServiceSubscription(fullname, ["publishChat", "publishRequest", "publishResponse"])
  const service = useProcessedMessage(serviceMsg)

  useEffect(() => {
    if (service) {
      setConfig(service.config)
      setPrompts(service.prompts)
      setPromptKeys(Object.keys(service.prompts))
    }
  }, [service])

  useEffect(() => {
    if (config?.prompt) {
      const cardIndex = promptKeys.indexOf(config.prompt)
      if (cardIndex !== -1) {
        setCurrentPromptIndex(cardIndex)
      }
    }
  }, [config?.prompt, promptKeys])

  useEffect(() => {
    if (config) {
      const selectedModel = service.localModels.find((model) => model.name === config.model)
      if (selectedModel) {
        setSelectedModelDetails({
          name: selectedModel.name,
          description: selectedModel.description || JSON.stringify(selectedModel.details, null, 2)
        })
      } else {
        setSelectedModelDetails({ name: "", description: "" })
      }
    }
  }, [config, service?.localModels])

  const handleNext = () => {
    setCurrentPromptIndex((prevIndex) => (prevIndex + 1) % promptKeys.length)
  }

  const handlePrev = () => {
    setCurrentPromptIndex((prevIndex) => (prevIndex - 1 + promptKeys.length) % promptKeys.length)
  }

  const handleLocalModelList = () => {
    sendTo(fullname, "listModels")
  }

  const currentPromptKey = promptKeys[currentPromptIndex]
  const currentPrompt = prompts[currentPromptKey]

  const handlePullModel = () => {
    if (selectedAvailableModel) {
      sendTo(fullname, "pullModel", selectedAvailableModel)
    }
  }

  const handleSaveConfig = () => {
    if (config) {
      config.prompt = currentPromptKey
      sendTo(fullname, "applyConfig", config)
      sendTo(fullname, "saveConfig")
      sendTo(fullname, "broadcastState")
      setEditMode(false)
    }
  }

  const handleConfigChange = (event) => {
    const { name, value, type } = event.target
    const newValue = type === "number" ? Number(value) : value
    setConfig((prevConfig) => ({
      ...prevConfig,
      [name]: newValue
    }))
  }

  const toggleEditMode = () => setEditMode(!editMode)

  return (
    <>
      <h3 style={{ display: "flex", alignItems: "center", cursor: "pointer" }} onClick={toggleEditMode}>
        Configuration
        {editMode ? <ExpandLessIcon /> : <ExpandMoreIcon />}
      </h3>
      {editMode ? (
        <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "80%" } }}>
          <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
            <FormControl variant="outlined" sx={{ minWidth: 200, flex: 1 }}>
              <InputLabel id="local-model-select-label">Local Model</InputLabel>
              <Select
                labelId="local-model-select-label"
                id="local-model-select"
                name="model"
                value={config?.model || ""}
                onChange={handleConfigChange}
                onClick={handleLocalModelList}
                label="Local Model"
              >
                {service.localModels.map((model) => (
                  <MenuItem key={model.name} value={model.name}>
                    {model.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {selectedModelDetails.name && (
              <Card sx={{ ml: 2, flex: 2 }}>
                <CardContent>
                  <Typography variant="h6">{selectedModelDetails.name}</Typography>
                  <Typography variant="body1">{selectedModelDetails.description}</Typography>
                </CardContent>
              </Card>
            )}
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
            <FormControl variant="outlined" sx={{ minWidth: 200, flex: 1 }}>
              <InputLabel id="available-model-select-label">Available Model</InputLabel>
              <Select
                labelId="available-model-select-label"
                id="available-model-select"
                name="availableModel"
                value={selectedAvailableModel}
                onChange={(event) => setSelectedAvailableModel(event.target.value)}
                label="Available Model"
              >
                {service.availableModels.map((model) => (
                  <MenuItem key={model.name} value={model.name}>
                    {model.name} - {model.description}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {selectedAvailableModel && (
              <Button variant="contained" color="primary" onClick={handlePullModel} sx={{ ml: 2 }}>
                Pull
              </Button>
            )}
          </Box>
          <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
            <TextField
              label="URL"
              name="url"
              variant="outlined"
              fullWidth
              margin="normal"
              value={config?.url || ""}
              onChange={handleConfigChange}
              sx={{ flex: 1 }}
            />
            <TextField
              label="Max History"
              name="maxHistory"
              variant="outlined"
              fullWidth
              margin="normal"
              type="number"
              value={config?.maxHistory || 0}
              onChange={handleConfigChange}
              sx={{ flex: 1 }}
            />
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", mt: 5 }}>
            <IconButton onClick={handlePrev} disabled={promptKeys.length <= 1}>
              <ArrowBack />
            </IconButton>
            <PromptCard currentPromptKey={currentPromptKey} currentPrompt={currentPrompt} getBaseUrl={getBaseUrl} />
            <IconButton onClick={handleNext} disabled={promptKeys.length <= 1}>
              <ArrowForward />
            </IconButton>
          </Box>
          <Box sx={{ mt: 2, display: "flex", justifyContent: "flex-end", gap: 2 }}>
            <Button variant="contained" color="primary" onClick={handleSaveConfig}>
              Save
            </Button>
          </Box>
        </Box>
      ) : null}
    </>
  )
}

export default ConfigurationSection
