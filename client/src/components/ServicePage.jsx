import loadable from "@loadable/component"
import DeleteIcon from "@mui/icons-material/Delete"
import SettingsIcon from "@mui/icons-material/Settings"
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Typography
} from "@mui/material"
import React, { useState } from "react"
import ReactJson from "react-json-view"
import { useStore } from "../store/store"

// TODO - React.lazy vs react-loadable
export default function ServicePage(props) {
  const registry = useStore((state) => state.registry)
  let service = registry[props.fullname]
  let type = service.typeKey
  const getRepoUrl = useStore((state) => state.getRepoUrl)
  const [showJson, setShowJson] = useState(false)
  const [open, setOpen] = useState(false)

  // FIXME - this is a pain, it should dynamically check if the service exists
  // but no library or native lazy loader seems to support this
  const types = [
    "Clock",
    "Docker",
    "MyRobotLabConnector",
    "OakD",
    "Ollama",
    "RobotLabXRuntime",
    "Runtime",
    "TestNodeService",
    "TestPythonService",
    "WebXR"
  ]

  if (!types.includes(type)) {
    type = "Unknown"
  }

  const handleDeleteClick = () => {
    setOpen(true)
  }

  const handleClose = () => {
    setOpen(false)
  }

  const handleConfirmDelete = () => {
    // Perform delete action here
    console.log("Service deleted")
    setOpen(false)
  }

  const handleSettingsClick = () => {
    setShowJson(!showJson)
  }

  let AsyncPage = null

  try {
    // FIXME - test with throwable fetch and to determine if loadable is possible
    AsyncPage = loadable(() => import(`../service/${type}`))
  } catch (error) {
    return <div>Service not found</div>
  }

  return (
    <div className="service-content-div">
      <Typography variant="h4" component="div" sx={{ display: "flex", alignItems: "center" }}>
        <img
          src={`${getRepoUrl()}/${service.typeKey}/${service.typeKey}.png`}
          alt={service.name}
          width="32"
          style={{ verticalAlign: "middle" }}
        />{" "}
        <span style={{ color: "grey", margin: "0 8px" }}>{service.id}</span>
        {service.name}
        <IconButton onClick={handleSettingsClick} aria-label="settings" sx={{ ml: 1 }}>
          <SettingsIcon />
        </IconButton>
        <IconButton onClick={handleDeleteClick} aria-label="delete" sx={{ ml: 2 }}>
          <DeleteIcon />
        </IconButton>
      </Typography>

      <AsyncPage page={type} name={props.name} id={props.id} fullname={props.fullname} />
      {showJson && <ReactJson src={service} name="service" />}
      {/* Confirmation Dialog */}
      <Dialog
        open={open}
        onClose={handleClose}
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-description"
      >
        <DialogTitle id="alert-dialog-title">{"Confirm Delete"}</DialogTitle>
        <DialogContent>
          <DialogContentText id="alert-dialog-description">
            Are you sure you want to delete this service?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} color="primary">
            Cancel
          </Button>
          <Button onClick={handleConfirmDelete} color="primary" autoFocus>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}
