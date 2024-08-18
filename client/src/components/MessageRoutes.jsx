import AddIcon from "@mui/icons-material/Add"
import DeleteIcon from "@mui/icons-material/Delete"
import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import { Box, Checkbox, FormControlLabel, IconButton, Typography } from "@mui/material"
import NewMessageRouteDialog from "components/NewMessageRouteDialog"
import CodecUtil from "framework/CodecUtil"
import React, { useCallback, useState } from "react"
import { useStore } from "store/store"

const MessageRoutes = ({ fullname }) => {
  const [filterUIRoutes, setFilterUIRoutes] = useState(true) // State for checkbox to filter UI routes
  const [messageRouteDialogOpen, setMessageRouteDialogOpen] = useState(false)
  const [expanded, setExpanded] = useState(false) // State to track if the component is expanded or collapsed
  const [selectedRoute, setSelectedRoute] = useState(null) // State to track the selected route
  const { sendTo } = useStore()
  const registry = useStore((state) => state.services)
  const { getType } = useStore()
  const selectedService = registry[fullname]

  const handleMakeMessageRoute = useCallback(() => {
    setMessageRouteDialogOpen(true)
  }, [])

  const handleDeleteRoute = (topic, entry) => {
    // Implement your delete logic here
    console.log(`Delete route: ${topic} -> ${entry.callbackName}`)
    sendTo(fullname, "removeListener", topic, entry.callbackName, entry.callbackMethod)
  }

  const renderRoutes = () => {
    if (!selectedService?.notifyList) return null

    return Object.keys(selectedService.notifyList).map((topic) => (
      <Box key={topic} sx={{ marginBottom: "10px" }}>
        <Box sx={{ paddingLeft: "10px" }}>
          {selectedService.notifyList[topic]
            .filter((entry) => !filterUIRoutes || getType(entry.callbackName) !== "RobotLabXUI") // Conditionally filter based on checkbox
            .map((entry, index) => (
              <Box
                key={index}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "5px",
                  backgroundColor: selectedRoute === entry ? "#e0e0e0" : "transparent",
                  "&:hover": {
                    backgroundColor: "#f5f5f5",
                    cursor: "pointer"
                  }
                }}
                onClick={() => setSelectedRoute(entry)}
              >
                <Typography>
                  {entry.topicMethod} &rarr; {CodecUtil.getShortName(entry.callbackName)}.{entry.callbackMethod}{" "}
                </Typography>
                {selectedRoute === entry && (
                  <IconButton
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteRoute(topic, entry)
                    }}
                    aria-label="delete"
                    size="small"
                    sx={{ marginLeft: "10px" }}
                  >
                    <DeleteIcon />
                  </IconButton>
                )}
              </Box>
            ))}
        </Box>
      </Box>
    ))
  }

  const toggleExpanded = () => {
    setExpanded((prev) => !prev)
  }

  return (
    <Box>
      <h3 style={{ display: "flex", alignItems: "center", cursor: "pointer" }} onClick={toggleExpanded}>
        Message Routes
        {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
      </h3>
      {expanded && (
        <>
          <FormControlLabel
            control={
              <Checkbox
                checked={filterUIRoutes}
                onChange={() => setFilterUIRoutes((prev) => !prev)} // Toggle filter state
              />
            }
            label="Filter UI Routes"
            sx={{ marginLeft: "10px" }}
          />
          {renderRoutes()}
          <br />
          <IconButton onClick={handleMakeMessageRoute} aria-label="api">
            <AddIcon />
          </IconButton>
        </>
      )}
      <NewMessageRouteDialog open={messageRouteDialogOpen} setOpen={setMessageRouteDialogOpen} fullname={fullname} />
    </Box>
  )
}

export default MessageRoutes
