import ArrowBackIcon from "@mui/icons-material/ArrowBack"
import CloseIcon from "@mui/icons-material/Close"
import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Paper,
  TextField
} from "@mui/material"
import React, { useEffect, useRef, useState } from "react"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

// FIXME remove fullname with context provider
export default function OpenCV({ fullname }) {
  const [editMode, setEditMode] = useState(false)
  const { useMessage, sendTo } = useStore()

  // makes reference to the message object in store
  const epochMsg = useMessage(fullname, "publishEpoch")

  // creates subscriptions to topics and returns the broadcastState message reference
  const serviceMsg = useServiceSubscription(fullname, ["publishEpoch"])

  // processes the msg.data[0] and returns the data
  const service = useProcessedMessage(serviceMsg)
  const timestamp = useProcessedMessage(epochMsg)

  // const [filters, setFilters] = useState([])
  const [possibleFilters] = useState(["Canny", "Yolo3", "FaceDetect", "FaceRecognition"])
  const [selectedFilterType, setSelectedFilterType] = useState(null)
  const [selectedFilter, setSelectedFilter] = useState(null)
  const [filterName, setFilterName] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const filterNameRef = useRef(null)

  const toggleEditMode = () => {
    setEditMode(!editMode)
  }

  const handleCapture = () => {
    sendTo(fullname, "capture")
    // FIXME - OpenCV.py should separate the command from status
    // and have both a capture (command) and capturing (status)
    sendTo(fullname, "broadcastState")
  }

  const handleStopCapture = () => {
    // if its a python service be true to Pep8 python method names
    sendTo(fullname, "stop_capture")
    sendTo(fullname, "broadcastState")
  }

  // FIXME put all Configuration in a Component
  const handleConfigChange = (event) => {
    const { name, value, type } = event.target
    const newValue = type === "number" ? Number(value) : value
  }

  const handleSaveConfig = () => {
    setEditMode(false)
  }

  const handleSelectFilterType = (filterType) => {
    setSelectedFilterType(filterType)
  }

  const handleOpenDialog = () => {
    if (selectedFilterType) {
      setDialogOpen(true)
    } else {
      console.error("No filter type selected")
    }
  }

  const handleCloseDialog = () => {
    setDialogOpen(false)
    setFilterName("")
  }

  const handleAddFilter = () => {
    if (filterName.trim() !== "") {
      // setFilters([...filters, { type: selectedFilterType, name: filterName }])\
      // So copilot always wants it to be kwargs and not positional arguments
      // maybe we should comply sometime ?
      // sendTo(fullname, "add_filter", { type: selectedFilterType, name: filterName })
      sendTo(fullname, "add_filter", filterName, selectedFilterType)
      sendTo(fullname, "broadcastState")
      handleCloseDialog()
    }
  }

  const handleSelectFilter = (index) => {
    setSelectedFilter(index)
  }

  const handleRemoveFilter = (index) => {
    // setFilters(filters.filter((_, i) => i !== index))
    sendTo(fullname, "remove_filter", service?.filters[index].name)
    sendTo(fullname, "broadcastState")
    setSelectedFilter(null)
  }

  const handleDialogKeyDown = (event) => {
    console.log(event.key)
    if (event.key === "Enter") {
      handleAddFilter()
      handleCloseDialog()
    }
  }

  useEffect(() => {
    if (dialogOpen) {
      filterNameRef.current?.focus()
    }
  }, [dialogOpen])

  return (
    <>
      <h3 style={{ display: "flex", alignItems: "center", cursor: "pointer" }} onClick={toggleEditMode}>
        Configuration
        {editMode ? <ExpandLessIcon /> : <ExpandMoreIcon />}
      </h3>
      {editMode ? (
        <Box sx={{ maxWidth: { sm: "100%", md: "80%" } }}>
          <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
            <TextField
              label="Interval (ms)"
              name="intervalMs"
              variant="outlined"
              fullWidth
              margin="normal"
              value={service?.config?.intervalMs}
              onChange={handleConfigChange}
              sx={{ flex: 1 }} // Ensure consistent width
            />
          </Box>

          <Box sx={{ mt: 2, display: "flex", gap: 2 }}>
            <Button variant="contained" color="primary" onClick={handleSaveConfig}>
              Save
            </Button>
          </Box>
        </Box>
      ) : null}

      <Box sx={{ display: "flex", justifyContent: "space-between", maxWidth: { xs: "100%", sm: "80%", md: "80%" } }}>
        <Box sx={{ width: "45%" }}>
          <Paper elevation={3} sx={{ p: 2, m: 2 }}>
            <h4>Filters</h4>
            <List>
              {(service?.filters ?? []).map((filter, index) => (
                <ListItem
                  key={index}
                  button
                  selected={index === selectedFilter}
                  onClick={() => handleSelectFilter(index)}
                >
                  <ListItemText primary={`${filter.name} (${filter.typeKey})`} />
                  {index === selectedFilter && (
                    <IconButton edge="end" onClick={() => handleRemoveFilter(index)}>
                      <CloseIcon />
                    </IconButton>
                  )}
                </ListItem>
              ))}
            </List>
          </Paper>
        </Box>

        <Box sx={{ width: "45%" }}>
          <Paper elevation={3} sx={{ p: 2, m: 2 }}>
            <h4>Possible Filters</h4>
            <List>
              {possibleFilters.map((filterType, index) => (
                <ListItem
                  key={index}
                  button
                  onClick={() => handleSelectFilterType(filterType)}
                  selected={filterType === selectedFilterType}
                >
                  <ListItemText primary={filterType} />
                </ListItem>
              ))}
            </List>
          </Paper>
        </Box>
      </Box>

      <Box sx={{ textAlign: "center", mt: 2 }}>
        <Button variant="contained" onClick={handleOpenDialog} startIcon={<ArrowBackIcon />}>
          Add Filter
        </Button>
      </Box>

      <Dialog open={dialogOpen} onClose={handleCloseDialog} onKeyDown={handleDialogKeyDown}>
        <DialogTitle>Add Filter</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Filter Name"
            type="text"
            fullWidth
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
            inputRef={filterNameRef}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog} color="primary">
            Cancel
          </Button>
          <Button onClick={handleAddFilter} color="primary">
            Add
          </Button>
        </DialogActions>
      </Dialog>

      <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "80%" } }}>
        <Paper elevation={3} sx={{ p: 2, m: 2 }}>
          <Box sx={{ m: 2 }}>
            <Box>
              {service?.capturing ? (
                <Button variant="contained" color="secondary" onClick={handleStopCapture} sx={{ ml: 2 }}>
                  Stop Capture
                </Button>
              ) : (
                <Button variant="contained" color="primary" onClick={handleCapture}>
                  Capture
                </Button>
              )}
            </Box>
          </Box>
        </Paper>
      </Box>
    </>
  )
}
