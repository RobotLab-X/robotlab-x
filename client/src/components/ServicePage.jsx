import loadable from "@loadable/component"
import DeleteIcon from "@mui/icons-material/Delete"
import DescriptionIcon from "@mui/icons-material/Description"
import SettingsIcon from "@mui/icons-material/Settings"
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Tooltip,
  Typography
} from "@mui/material"
import React, { useEffect, useState } from "react"
import ReactJson from "react-json-view"
import { useNavigate } from "react-router-dom"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useRegisteredService, useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

// TODO - React.lazy vs react-loadable
export default function ServicePage({ fullname, name, id }) {
  // registered information - initial "stale" info the service was registered with
  // but "first" description, and given by the user
  const registered = useRegisteredService(fullname)
  const serviceMsg = useServiceSubscription(fullname)

  // latest representational state of service
  // provided by addListener/broadcastState
  // if the service does not respond, then ready will be false
  const service = useProcessedMessage(serviceMsg)

  let resolvedType = registered.typeKey === "Proxy" ? registered.proxyTypeKey : registered.typeKey
  resolvedType = resolvedType.includes(".") ? "MyRobotLabProxy" : resolvedType

  const getRepoUrl = useStore((state) => state.getRepoUrl)
  const [showJson, setShowJson] = useState(false)
  const [openDelete, setOpenDelete] = useState(false)
  const navigate = useNavigate()
  const sendTo = useStore((state) => state.sendTo)
  const [AsyncPage, setAsyncPage] = useState(null)

  useEffect(() => {
    // Dynamically import the service page component
    const loadAsyncPage = async () => {
      try {
        const LoadedPage = await loadable(() => import(`../service/${resolvedType}`))
        setAsyncPage(() => LoadedPage)
      } catch (error) {
        setAsyncPage(() => () => <div>Service not found</div>)
      }
    }

    loadAsyncPage()
  }, [resolvedType])

  const handleDeleteClick = () => {
    setOpenDelete(true)
  }

  const handleClose = () => {
    setOpenDelete(false)
  }

  const handleConfirmDelete = () => {
    // Perform delete action here
    console.log("Service deleted")
    setOpenDelete(false)
    sendTo(fullname, "releaseService")
  }

  const handleSettingsClick = () => {
    setShowJson(!showJson)
  }

  const handleSwaggerClick = () => {
    console.error(`Navigating to /swagger/${fullname}`)
    navigate(`/swagger/${fullname}`)
  }

  return (
    <div className="service-content-div">
      <Typography variant="h4" component="div" sx={{ display: "flex", alignItems: "center" }}>
        {resolvedType && resolvedType !== "MyRobotLabProxy" && (
          <img
            src={`${getRepoUrl()}/${resolvedType}/${resolvedType}.png`}
            alt={registered?.name}
            width="32"
            style={{ verticalAlign: "middle" }}
          />
        )}
        <span style={{ color: "grey", margin: "0 8px" }}>{registered?.id}</span>
        {registered?.name}
        <IconButton onClick={handleSettingsClick} aria-label="settings">
          <SettingsIcon />
        </IconButton>
        <IconButton onClick={handleSwaggerClick} aria-label="settings">
          <DescriptionIcon />
        </IconButton>
        <Tooltip title={service?.ready ? "Ready" : "Not Ready"}>
          <Box width={10} height={10} borderRadius="50%" bgcolor={service?.ready ? "green" : "red"} mr={1} />
        </Tooltip>
        <IconButton onClick={handleDeleteClick} aria-label="delete">
          <DeleteIcon />
        </IconButton>
      </Typography>

      {AsyncPage && <AsyncPage page={resolvedType} name={name} id={id} fullname={fullname} />}
      {showJson && (
        <>
          <ReactJson src={registered} name="registered" displayDataTypes={false} displayObjectSize={false} />
          <ReactJson src={service} name="service" displayDataTypes={false} displayObjectSize={false} />
        </>
      )}
      {/* Confirmation Dialog */}
      <Dialog
        open={openDelete}
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
