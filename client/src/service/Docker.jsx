// Docker.jsx
import { Button, Paper, Table, TableBody, TableCell, TableRow, TextField } from "@mui/material"
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

  const handlePull = () => {
    sendTo(fullname, "pullImage", imageName)
  }

  const handleStop = () => {
    sendTo(fullname, "stopDocker")
  }

  return (
    <>
      <h3>Containers</h3>
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
            </TableRow>
            {ps &&
              ps.map((container, index) => (
                <TableRow key={container.Id}>
                  <TableCell>{container.Id.substring(0, 12)}</TableCell>
                  <TableCell>{container.Image}</TableCell>
                  <TableCell>{container.Command}</TableCell>
                  <TableCell>{container.State}</TableCell>
                  <TableCell>{container.Status}</TableCell>
                  <TableCell>{container.Ports}</TableCell>
                  <TableCell>{JSON.stringify(container.Names)}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </Paper>
      <h3>Images</h3>
      <Paper style={{ display: "inline-block", overflowX: "auto", margin: "2px" }}>
        <Table size="small" aria-label="a dense table">
          <TableBody>
            <TableRow>
              <TableCell>Repo</TableCell>
              <TableCell>Tag</TableCell>
              <TableCell>Image Id</TableCell>
              <TableCell>Created</TableCell>
              <TableCell>Size</TableCell>
            </TableRow>
            {publishImages &&
              publishImages.map((image, index) => (
                <TableRow key={image.Id}>
                  <TableCell>Repo</TableCell>
                  <TableCell>{JSON.stringify(image.RepoTags)}</TableCell>
                  <TableCell>{image.Id.substring(0, 12)}</TableCell>
                  <TableCell>{image.Created}</TableCell>
                  <TableCell>{Math.round(image.Size / 1048576)} MB</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </Paper>
      <br />
      <FormControlLabel control={<Checkbox checked={checked} onChange={handleChange} />} label="Show All" />
      <Button variant="contained" color="primary" onClick={handlePull}>
        Pull
      </Button>
      <TextField
        label="Image Name"
        value={imageName}
        onChange={(e) => setImageName(e.target.value)}
        style={{ marginLeft: "8px" }}
      />
      <Button variant="contained" color="secondary" onClick={handleStop} style={{ marginLeft: "8px" }}>
        Start
      </Button>
      <br />
      {/*
      <ReactJson src={service} name="service" />
      */}
      {publishProgress && JSON.stringify(publishProgress)}
      {publishError && <div style={{ color: "red" }}>{JSON.stringify(publishError)}</div>}
      {publishFinished && <div style={{ color: "green" }}>{JSON.stringify(publishFinished)}</div>}
    </>
  )
}
