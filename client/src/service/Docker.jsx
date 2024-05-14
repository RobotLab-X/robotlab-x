import { Button, IconButton, Paper, Table, TableBody, TableCell, TableRow } from "@mui/material"

import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import PlayCircleFilledIcon from "@mui/icons-material/PlayCircleFilled"
import StopIcon from "@mui/icons-material/Stop"
import { TextField } from "@mui/material"
import Checkbox from "@mui/material/Checkbox"
import FormControlLabel from "@mui/material/FormControlLabel"
import React, { useState } from "react"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

// FIXME remove fullname with context provider
export default function Docker({ fullname }) {
  const { useMessage, sendTo } = useStore()

  const [checked, setChecked] = useState(false)
  const [imageName, setImageName] = useState("")
  const [showContainers, setShowContainers] = useState(false) // State for showing/hiding containers table
  const [showImages, setShowImages] = useState(false) // State for showing/hiding images table

  const handleChange = (event) => {
    setChecked(event.target.checked)
    sendTo(fullname, "showAll", event.target.checked)
    console.log(`Checkbox is now ${event.target.checked ? "checked" : "unchecked"}`)
  }

  const psMsg = useMessage(fullname, "publishPs")
  const publishProgressMsg = useMessage(fullname, "publishProgress")
  const publishFinishedMsg = useMessage(fullname, "publishFinished")
  const publishErrorMsg = useMessage(fullname, "publishError")
  const publishImagesMsg = useMessage(fullname, "publishImages")

  // creates subscriptions to topics and returns the broadcastState message reference
  const serviceMsg = useServiceSubscription(fullname, [
    "publishPs",
    "publishProgress",
    "publishFinished",
    "publishError",
    "publishImages"
  ])

  // processes the msg.data[0] and returns the data
  const service = useProcessedMessage(serviceMsg)
  const ps = useProcessedMessage(psMsg)
  const publishProgress = useProcessedMessage(publishProgressMsg)
  const publishFinished = useProcessedMessage(publishFinishedMsg)
  const publishError = useProcessedMessage(publishErrorMsg)
  const publishImages = useProcessedMessage(publishImagesMsg)

  const handleAction = (containerId, action) => {
    sendTo(fullname, action === "stop" ? "stopContainer" : "startContainer", containerId)
  }

  const handlePull = () => {
    sendTo(fullname, "pullImage", imageName)
  }

  const toggleShowContainers = () => {
    setShowContainers(!showContainers)
  }

  const toggleShowImages = () => {
    sendTo(fullname, "getImages")
    setShowImages(!showImages)
  }

  const handleCreateAndStartContainer = () => {
    sendTo(fullname, "createAndStartContainer", "nginx", "my-nginx-container")
  }

  const tableContainerStyle = { display: "flex", flexDirection: "column", minWidth: "50%" }

  return (
    <>
      <h3 style={{ display: "flex", alignItems: "center", cursor: "pointer" }} onClick={toggleShowContainers}>
        Containers
        {showContainers ? <ExpandLessIcon /> : <ExpandMoreIcon />}
      </h3>
      {showContainers && (
        <div style={tableContainerStyle}>
          <Paper style={{ display: "inline-block", overflowX: "auto", margin: "2px" }}>
            <Table size="small" aria-label="a dense table">
              <TableBody>
                <TableRow>
                  <TableCell>Id</TableCell>
                  <TableCell>Image</TableCell>
                  <TableCell>Command</TableCell>
                  <TableCell>State</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Ports</TableCell>
                  <TableCell>Names</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
                {ps &&
                  ps.map((container) => (
                    <TableRow key={container.Id}>
                      <TableCell>{container.Id.substring(0, 12)}</TableCell>
                      <TableCell>{container.Image}</TableCell>
                      <TableCell>{container.Command}</TableCell>
                      <TableCell>{container.State}</TableCell>
                      <TableCell>{container.Status}</TableCell>
                      <TableCell>{JSON.stringify(container.Ports)}</TableCell>
                      <TableCell>{JSON.stringify(container.Names)}</TableCell>
                      <TableCell>
                        {container.State === "running" ? (
                          <IconButton color="error" onClick={() => handleAction(container.Id, "stop")}>
                            <StopIcon />
                          </IconButton>
                        ) : (
                          <IconButton color="success" onClick={() => handleAction(container.Id, "start")}>
                            <PlayCircleFilledIcon />
                          </IconButton>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
            <br />
            {"   "}
            <FormControlLabel
              control={<Checkbox checked={checked} onChange={handleChange} sx={{ paddingLeft: 2 }} />}
              label="Show All"
            />
          </Paper>
        </div>
      )}
      <h3 style={{ display: "flex", alignItems: "center", cursor: "pointer" }} onClick={toggleShowImages}>
        Images
        {showImages ? <ExpandLessIcon /> : <ExpandMoreIcon />}
      </h3>
      {showImages && (
        <div style={tableContainerStyle}>
          <Paper style={{ display: "inline-block", overflowX: "auto", margin: "2px" }}>
            <Table size="small" aria-label="a dense table">
              <TableBody>
                <TableRow>
                  <TableCell>Repo</TableCell>
                  <TableCell>Tag</TableCell>
                  <TableCell>Image Id</TableCell>
                  <TableCell>Created</TableCell>
                  <TableCell>Size</TableCell>
                  <TableCell>Action</TableCell>
                </TableRow>
                {publishImages &&
                  publishImages.map((image) => (
                    <TableRow key={image.Id}>
                      <TableCell>{image.RepoTags?.[0]?.split(":")[0] || ""}</TableCell>
                      <TableCell>{image.RepoTags?.[0]?.split(":")[1] || ""}</TableCell>
                      <TableCell>{image.Id.substring(7, 19)}</TableCell>
                      <TableCell>
                        {Math.floor((Date.now() - new Date(image.Created * 1000)) / (1000 * 60 * 60 * 24))} days ago
                      </TableCell>
                      <TableCell>{Math.round(image.Size / 1048576)} MB</TableCell>
                      <TableCell>
                        <IconButton color="success" onClick={() => handleCreateAndStartContainer(imageName)}>
                          <PlayCircleFilledIcon />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </Paper>
        </div>
      )}
      <br />
      <Button variant="contained" color="primary" onClick={handlePull}>
        Pull
      </Button>
      <TextField
        label="Image Name"
        value={imageName}
        onChange={(e) => setImageName(e.target.value)}
        sx={{
          marginLeft: "8px",
          "& .MuiInputBase-root": {
            height: "36px" // Match the Button height
          },
          "& .MuiInputBase-input": {
            padding: "10.5px 14px" // Vertically center text within the input
          },
          "& .MuiInputLabel-root": {
            top: "-5px" // Adjust label position
          }
        }}
      />{" "}
      <br />
      {publishProgress && JSON.stringify(publishProgress)}
      {publishError && <div style={{ color: "red" }}>{JSON.stringify(publishError)}</div>}
      {publishFinished && <div style={{ color: "green" }}>{JSON.stringify(publishFinished)}</div>}
    </>
  )
}
