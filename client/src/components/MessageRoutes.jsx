import AddIcon from "@mui/icons-material/Add"
import { Box, Checkbox, FormControlLabel, IconButton, Typography } from "@mui/material"
import NewMessageRouteDialog from "components/NewMessageRouteDialog"
import CodecUtil from "framework/CodecUtil"
import React, { useCallback, useState } from "react"
import { useStore } from "store/store"

const MessageRoutes = ({ fullname }) => {
  const [filterUIRoutes, setFilterUIRoutes] = useState(true) // State for checkbox to filter UI routes
  const [messageRouteDialogOpen, setMessageRouteDialogOpen] = useState(false)
  const registry = useStore((state) => state.services)
  const { getType } = useStore()
  const selectedService = registry[fullname]

  const handleMakeMessageRoute = useCallback(() => {
    setMessageRouteDialogOpen(true)
  }, [])

  const renderRoutes = () => {
    if (!selectedService?.notifyList) return null

    return Object.keys(selectedService.notifyList).map((topic) => (
      <Box key={topic} sx={{ marginBottom: "10px" }}>
        <Box sx={{ paddingLeft: "10px" }}>
          {selectedService.notifyList[topic]
            .filter((entry) => !filterUIRoutes || getType(entry.callbackName) !== "RobotLabXUI") // Conditionally filter based on checkbox
            .map((entry, index) => (
              <Typography key={index}>
                {entry.topicMethod} &rarr; {CodecUtil.getShortName(entry.callbackName)}.{entry.callbackMethod}{" "}
              </Typography>
            ))}
        </Box>
      </Box>
    ))
  }

  return (
    <Box>
      <h3>
        Message Routes
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
      </h3>
      {renderRoutes()}
      <br />
      <IconButton onClick={handleMakeMessageRoute} aria-label="api">
        <AddIcon />
      </IconButton>

      <NewMessageRouteDialog open={messageRouteDialogOpen} setOpen={setMessageRouteDialogOpen} fullname={fullname} />
    </Box>
  )
}

export default MessageRoutes
