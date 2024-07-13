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
  availableModels
}) => {
  const [selectedModelDescription, setSelectedModelDescription] = useState("")

  const toggleEditMode = () => setEditMode(!editMode)

  useEffect(() => {
    const selectedModel = availableModels.find((library) => library.name === config?.model)
    setSelectedModelDescription(selectedModel?.description || "")
  }, [config?.model, availableModels])

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
                {availableModels.map((library) => (
                  <MenuItem key={library.name} value={library.name}>
                    {library.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {selectedModelDescription && (
              <Card sx={{ ml: 2, flex: 2 }}>
                <CardContent>
                  <Typography variant="body1">{selectedModelDescription}</Typography>
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
