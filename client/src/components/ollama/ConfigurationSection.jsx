import { ArrowBack, ArrowForward } from "@mui/icons-material"
import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import { Box, Button, FormControl, IconButton, InputLabel, MenuItem, Select, TextField } from "@mui/material"
import React from "react"
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
  name
}) => {
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
              value={config?.url ?? ""}
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
              value={config?.maxHistory ?? 0}
              onChange={handleConfigChange}
              sx={{ flex: 1 }} // Ensure consistent width
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
