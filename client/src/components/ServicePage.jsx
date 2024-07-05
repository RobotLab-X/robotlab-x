import loadable from "@loadable/component"
import DeleteIcon from "@mui/icons-material/Delete"
import DescriptionIcon from "@mui/icons-material/Description"
import FileOpenIcon from "@mui/icons-material/FileOpen"
import RefreshIcon from "@mui/icons-material/Refresh"
import SaveIcon from "@mui/icons-material/Save"
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
import StatusLog from "components/StatusLog"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import ReactJson from "react-json-view"
import { useNavigate } from "react-router-dom"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useRegisteredService, useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

const containerStyle = {
  position: "relative",
  minHeight: "100vh", // Ensure the parent takes up the full height of the viewport
  paddingBottom: "400px" // Space for the StatusLog at the bottom
}

const containerStyle2 = {}

const statusLogStyle = {
  position: "absolute",
  bottom: 160,
  marginBottom: "16px",
  width: "100%"
}

const ServicePage = ({ fullname, name, id }) => {
  const registered = useRegisteredService(fullname)
  const serviceMsg = useServiceSubscription(fullname)
  const service = useProcessedMessage(serviceMsg)

  let resolvedType = registered.typeKey === "Proxy" ? registered.proxyTypeKey : registered.typeKey
  resolvedType = resolvedType?.includes(".") ? "MyRobotLabProxy" : resolvedType
  const { sendTo } = useStore()
  const getRepoUrl = useStore((state) => state.getRepoUrl)
  const [showJson, setShowJson] = useState(false)
  const [openDelete, setOpenDelete] = useState(false)
  const navigate = useNavigate()
  const [AsyncPage, setAsyncPage] = useState(null)
  const debug = useStore((state) => state.debug)
  const statusList = useStore((state) => state.statusLists[`${fullname}.onStatusList`] || [])

  useEffect(() => {
    if (resolvedType) {
      const loadAsyncPage = async () => {
        try {
          const LoadedPage = await loadable(() => import(`../service/${resolvedType}`))
          setAsyncPage(() => LoadedPage)
        } catch (error) {
          setAsyncPage(() => () => <div>Service not found</div>)
        }
      }

      loadAsyncPage()
    }
  }, [resolvedType])

  const handleDeleteClick = useCallback(() => {
    setOpenDelete(true)
  }, [])

  const handleClose = useCallback(() => {
    setOpenDelete(false)
  }, [])

  const handleConfirmDelete = useCallback(() => {
    console.log("Service deleted")
    setOpenDelete(false)
    sendTo(fullname, "releaseService")
  }, [fullname, sendTo])

  const handleSettingsClick = useCallback(() => {
    setShowJson((prev) => !prev)
  }, [])

  const handleSwaggerClick = useCallback(() => {
    console.error(`Navigating to /swagger/${fullname}`)
    navigate(`/swagger/${fullname}`)
  }, [fullname, navigate])

  const handleRefreshClick = useCallback(() => {
    console.log("Service refreshed")
    sendTo(fullname, "broadcastState")
  }, [fullname, sendTo])

  const handleSaveClick = useCallback(() => {
    console.log(`Saving ${fullname}`)
    sendTo(fullname, "save")
  }, [fullname, sendTo])

  const handleOpenClick = useCallback(() => {
    console.log(`loading config file for ${fullname}`)
    sendTo(fullname, "applyFileConfig")
  }, [fullname, sendTo])

  const asyncPageMemo = useMemo(
    () => AsyncPage && <AsyncPage page={resolvedType} name={name} id={id} fullname={fullname} />,
    [AsyncPage, resolvedType, name, id, fullname]
  )

  const jsonDisplayMemo = useMemo(
    () =>
      showJson && (
        <>
          <ReactJson src={registered} name="registered" displayDataTypes={false} displayObjectSize={false} />
          <ReactJson src={service} name="service" displayDataTypes={false} displayObjectSize={false} />
        </>
      ),
    [showJson, registered, service]
  )

  return (
    <div className="service-content-div" style={containerStyle2}>
      <Typography variant="h4" component="div" sx={{ display: "flex", alignItems: "center" }}>
        {resolvedType && resolvedType !== "MyRobotLabProxy" && (
          <img
            src={`${getRepoUrl()}/${resolvedType.toLowerCase()}/image.png`}
            alt={registered?.name}
            width="32"
            style={{ verticalAlign: "middle" }}
          />
        )}
        &nbsp;&nbsp;
        <Tooltip title={service?.ready ? "Ready" : "Not Ready"}>
          <Box width={10} height={10} borderRadius="50%" bgcolor={service?.ready ? "green" : "red"} mr={1} />
        </Tooltip>
        {registered?.name}
        <span style={{ color: "grey", margin: "0 8px" }}>@{registered?.id}</span>
        <Tooltip title="Settings">
          <IconButton onClick={handleSettingsClick} aria-label="settings">
            <SettingsIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Refresh">
          <IconButton onClick={handleRefreshClick} aria-label="refresh">
            <RefreshIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Load Configuration">
          <IconButton onClick={handleOpenClick} aria-label="open">
            <FileOpenIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Save">
          <IconButton onClick={handleSaveClick} aria-label="save">
            <SaveIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="API">
          <IconButton onClick={handleSwaggerClick} aria-label="api">
            <DescriptionIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete Service">
          <IconButton onClick={handleDeleteClick} aria-label="delete">
            <DeleteIcon />
          </IconButton>
        </Tooltip>
      </Typography>

      {asyncPageMemo}
      {jsonDisplayMemo}

      {debug && (
        <>
          {" "}
          <br />
          <Box sx={statusLogStyle}>
            <StatusLog statusLog={statusList} fullname={fullname} />
          </Box>
        </>
      )}

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

export default React.memo(ServicePage)
