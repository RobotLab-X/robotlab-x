import CloseIcon from "@mui/icons-material/Close"
import {
  Box,
  Button,
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Slider,
  Typography
} from "@mui/material"
import React, { useState } from "react"

export default function Filters({ service, selectedFilter, setSelectedFilter, sendTo, fullname }) {
  const selectedFilterDetails = selectedFilter !== null ? service?.filters[selectedFilter] : null

  const [selectedOption, setSelectedOption] = useState("")

  const handleSelectFilter = (index) => setSelectedFilter(index)
  const handleRemoveFilter = (index) => {
    sendTo(fullname, "remove_filter", service?.filters[index].name)
    sendTo(fullname, "broadcastState")
    setSelectedFilter(null)
  }

  const [lowerThreshold, setLowerThreshold] = useState(0)
  const [upperThreshold, setUpperThreshold] = useState(255)
  const [kernel, setKernel] = useState(3)

  const handleLowerThresholdChange = (event, newValue) => {
    setLowerThreshold(newValue)
  }

  const handleUpperThresholdChange = (event, newValue) => {
    setUpperThreshold(newValue)
  }

  const handleKernelChange = (event) => {
    setKernel(event.target.value)
  }

  const cascadeChange = (event) => {
    // setSelectedOption(event.target.value)
    sendTo(fullname, "apply_filter_config", selectedFilterDetails.name, {
      cascade_path: event.target.value
    })
    sendTo(fullname, "broadcastState")
  }

  const handleApply = () => {
    console.log("handleApply")
    // Add logic to apply these values where needed
  }

  return (
    <Box sx={{ width: "45%" }}>
      <Paper elevation={3} sx={{ p: 2, m: 2 }}>
        <h4>Filters here {JSON.stringify(selectedFilterDetails)}</h4>
        <List>
          {(service?.filters ?? []).map((filter, index) => (
            <ListItem key={index} button selected={index === selectedFilter} onClick={() => handleSelectFilter(index)}>
              <ListItemText primary={`${filter.name} (${filter.typeKey})`} />
              {index === selectedFilter && (
                <IconButton edge="end" onClick={() => handleRemoveFilter(index)}>
                  <CloseIcon />
                </IconButton>
              )}
            </ListItem>
          ))}
        </List>
        {selectedFilterDetails && (
          <Box sx={{ mt: 2 }}>
            {selectedFilterDetails.typeKey === "OpenCVFilterFaceDetect" && (
              <Box>
                <Typography variant="body1">Face Detection Type</Typography>
                <Select
                  value={selectedOption || selectedFilterDetails?.config?.cascade_path}
                  onChange={cascadeChange}
                  displayEmpty
                  sx={{ mt: 1, width: "100%" }}
                >
                  <MenuItem value="haarcascade_frontalface_default.xml">haarcascade_frontalface_default.xml</MenuItem>
                  <MenuItem value="haarcascade_frontalface_alt.xml">haarcascade_frontalface_alt.xml</MenuItem>
                  <MenuItem value="haarcascade_frontalface_alt2.xml">haarcascade_frontalface_alt2.xml</MenuItem>
                  <MenuItem value="haarcascade_frontalface_alt_tree.xml">haarcascade_frontalface_alt_tree.xml</MenuItem>
                  <MenuItem value="haarcascade_profileface.xml">haarcascade_profileface.xml</MenuItem>
                  <MenuItem value="haarcascade_eye.xml">haarcascade_eye.xml</MenuItem>
                  <MenuItem value="haarcascade_eye_tree_eyeglasses.xml">haarcascade_eye_tree_eyeglasses.xml</MenuItem>
                  <MenuItem value="haarcascade_smile.xml">haarcascade_smile.xml</MenuItem>
                  <MenuItem value="haarcascade_upperbody.xml">haarcascade_upperbody.xml</MenuItem>
                  <MenuItem value="haarcascade_fullbody.xml">haarcascade_fullbody.xml</MenuItem>
                  <MenuItem value="haarcascade_lowerbody.xml">haarcascade_lowerbody.xml</MenuItem>
                  <MenuItem value="haarcascade_russian_plate_number.xml">haarcascade_russian_plate_number.xml</MenuItem>
                  <MenuItem value="haarcascade_hand.xml">haarcascade_hand.xml</MenuItem>
                  <MenuItem value="haarcascade_leye.xml">haarcascade_leye.xml</MenuItem>
                </Select>
              </Box>
            )}

            {selectedFilterDetails.typeKey === "OpenCVFilterCanny" && (
              <Box sx={{ width: 300, padding: 2 }}>
                <Typography variant="h6">Threshold Settings</Typography>
                <Typography variant="body1">Lower Threshold</Typography>
                <Slider
                  value={lowerThreshold}
                  onChange={handleLowerThresholdChange}
                  min={0}
                  max={255}
                  valueLabelDisplay="auto"
                />
                <Typography variant="body1">Upper Threshold</Typography>
                <Slider
                  value={upperThreshold}
                  onChange={handleUpperThresholdChange}
                  min={0}
                  max={255}
                  valueLabelDisplay="auto"
                  track="inverted"
                />
                <Typography variant="body1">Kernel</Typography>
                <Select value={kernel} onChange={handleKernelChange} fullWidth>
                  {[3, 5, 7, 11].map((value) => (
                    <MenuItem key={value} value={value}>
                      {value}
                    </MenuItem>
                  ))}
                </Select>
              </Box>
            )}

            <Box sx={{ mt: 2 }}>
              <Button variant="contained" color="primary" onClick={handleApply}>
                Apply
              </Button>
            </Box>
          </Box>
        )}
      </Paper>
    </Box>
  )
}
