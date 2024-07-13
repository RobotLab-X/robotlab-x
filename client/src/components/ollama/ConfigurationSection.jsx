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
import React, { useEffect, useState } from "react"
import PromptCard from "./PromptCard"

const ConfigurationSection = ({
  config,
  handleConfigChange,
  handleSaveConfig,
  handlePrev,
  handleNext,
  promptKeys,
  currentPromptKey,
  currentPrompt,
  editMode,
  setEditMode,
  getBaseUrl,
  name,
  localModels,
  availableModels
}) => {
  const [selectedModelDetails, setSelectedModelDetails] = useState({ name: "", description: "" })

  const toggleEditMode = () => setEditMode(!editMode)

  useEffect(() => {
    const selectedModel =
      availableModels.find((model) => model.name === config?.model) ||
      localModels.find((model) => model.name === config?.model)
    if (selectedModel) {
      setSelectedModelDetails({
        name: selectedModel.name,
        description: selectedModel.description || JSON.stringify(selectedModel.details, null, 2)
      })
    } else {
      setSelectedModelDetails({ name: "", description: "" })
    }
  }, [config?.model, availableModels, localModels])

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
              <InputLabel id="model-select-label">Model</InputLabel>
              <Select
                labelId="model-select-label"
                id="model-select"
                name="model"
                value={config?.model}
                onChange={handleConfigChange}
                label="Model"
              >
                {availableModels.concat(localModels).map((model) => (
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
          <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
            <TextField
              label="URL"
              name="url"
              variant="outlined"
              fullWidth
              margin="normal"
              value={config?.url ?? ""}
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
              value={config?.maxHistory ?? 0}
              onChange={handleConfigChange}
              sx={{ flex: 1 }}
            />
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", mt: 5 }}>
            <IconButton onClick={handlePrev} disabled={promptKeys.length <= 1}>
              <ArrowBack />
            </IconButton>
            <PromptCard
              currentPromptKey={currentPromptKey}
              currentPrompt={currentPrompt}
              getBaseUrl={getBaseUrl}
              name={name}
            />
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
