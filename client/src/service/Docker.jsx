import DeleteIcon from "@mui/icons-material/Delete"
import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import PlayCircleFilledIcon from "@mui/icons-material/PlayCircleFilled"
import StopIcon from "@mui/icons-material/Stop"
import {
  Box,
  Button,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField
} from "@mui/material"
import Checkbox from "@mui/material/Checkbox"
import FormControlLabel from "@mui/material/FormControlLabel"
import React, { useEffect, useState } from "react"
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
  const [logEntries, setLogEntries] = useState([])
  const [maxLogEntries, setMaxLogEntries] = useState(10) // State for max log entries

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

  const publishInstallLogMsg = useMessage(fullname, "publishInstallLog")

  // creates subscriptions to topics and returns the broadcastState message reference
  const serviceMsg = useServiceSubscription(fullname, [
    "publishPs",
    "publishProgress",
    "publishFinished",
    "publishError",
    "publishImages",
    "publishInstallLog"
  ])

  // processes the msg.data[0] and returns the data
  const service = useProcessedMessage(serviceMsg)
  const ps = useProcessedMessage(psMsg)
  const publishProgress = useProcessedMessage(publishProgressMsg)
  const publishFinished = useProcessedMessage(publishFinishedMsg)
  const publishError = useProcessedMessage(publishErrorMsg)
  const publishImages = useProcessedMessage(publishImagesMsg)

  const publishInstallLog = useProcessedMessage(publishInstallLogMsg)

  useEffect(() => {
    if (publishInstallLog) {
      setLogEntries((prevEntries) => {
        const newEntries = [...prevEntries, publishInstallLog].slice(-maxLogEntries)
        return newEntries
      })
    }
  }, [publishInstallLog, maxLogEntries])

  const handleAction = (containerId, action) => {
    if (action === "delete") {
      sendTo(fullname, "deleteContainer", containerId)
      return
    }
    if (action === "deleteImage") {
      sendTo(fullname, "deleteImage", containerId)
      return
    }
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

  const handleCreateAndStartContainer = (id) => {
    sendTo(fullname, "createAndStartContainer", id, null)
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
                          <Box display="flex" alignItems="center">
                            <IconButton color="success" onClick={() => handleAction(container.Id, "start")}>
                              <PlayCircleFilledIcon />
                            </IconButton>
                            <IconButton color="error" onClick={() => handleAction(container.Id, "delete")}>
                              <DeleteIcon />
                            </IconButton>
                          </Box>
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
                        <Box display="flex" alignItems="center">
                          <IconButton
                            color="success"
                            onClick={() => handleCreateAndStartContainer(image.Id.substring(7, 19))}
                          >
                            <PlayCircleFilledIcon />
                          </IconButton>
                          <IconButton color="error" onClick={() => handleAction(image.Id, "deleteImage")}>
                            <DeleteIcon />
                          </IconButton>
                        </Box>
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
      <LogTable entries={logEntries} />
    </>
  )

  function LogTable({ entries }) {
    return (
      <Table sx={{ borderCollapse: "separate", borderSpacing: "0" }}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ borderBottom: "none" }}>Timestamp</TableCell>
            <TableCell sx={{ borderBottom: "none" }}>Level</TableCell>
            <TableCell sx={{ borderBottom: "none" }}>Message</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {entries.map((entry, index) => (
            <TableRow key={index} sx={{ borderBottom: "none" }}>
              <TableCell sx={{ borderBottom: "none", color: getColor(entry) }}>{entry.ts}</TableCell>
              <TableCell sx={{ borderBottom: "none", color: getColor(entry) }}>{entry.level}</TableCell>
              <TableCell sx={{ borderBottom: "none", color: getColor(entry) }}>
                {typeof entry.msg === "string" ? entry.msg : JSON.stringify(entry.msg)}
                {entry.msg && typeof entry.msg !== "string" && (
                  <>
                    {entry.msg.status && (
                      <div>
                        <strong>Status:</strong> {entry.msg.status}
                      </div>
                    )}
                    {entry.msg.progressDetail && (
                      <div>
                        <strong>Progress Detail:</strong> {JSON.stringify(entry.msg.progressDetail)}
                      </div>
                    )}
                    {entry.msg.progress && (
                      <div>
                        <strong>Progress:</strong> {entry.msg.progress}
                      </div>
                    )}
                  </>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }

  function getColor(entry) {
    if (entry.msg === "Image pulled successfully.") {
      return "green"
    }
    if (entry.level === "error") {
      return "red"
    }
    return "inherit"
  }
}
