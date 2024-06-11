import CloseIcon from "@mui/icons-material/Close"
import { Box, IconButton, List, ListItem, ListItemText, MenuItem, Paper, Select, Typography } from "@mui/material"
import React, { useState } from "react"

export default function Filters({ service, selectedFilter, setSelectedFilter, sendTo, fullname }) {
  const [selectedOption, setSelectedOption] = useState("")

  const handleSelectFilter = (index) => setSelectedFilter(index)
  const handleRemoveFilter = (index) => {
    sendTo(fullname, "remove_filter", service?.filters[index].name)
    sendTo(fullname, "broadcastState")
    setSelectedFilter(null)
  }

  const handleOptionChange = (event) => {
    setSelectedOption(event.target.value)
  }

  const selectedFilterDetails = selectedFilter !== null ? service?.filters[selectedFilter] : null

  return (
    <Box sx={{ width: "45%" }}>
      <Paper elevation={3} sx={{ p: 2, m: 2 }}>
        <h4>Filters</h4>
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
            {selectedFilterDetails.typeKey === "FaceDetect" && (
              <Box>
                <Typography variant="body1">Face Detection Type</Typography>
                <Select value={selectedOption} onChange={handleOptionChange} displayEmpty sx={{ mt: 1, width: "100%" }}>
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
          </Box>
        )}
      </Paper>
    </Box>
  )
}
