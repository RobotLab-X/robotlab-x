import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  Tooltip
} from "@mui/material"
import React, { useEffect, useState } from "react"
import { useProcessedMessage } from "../../hooks/useProcessedMessage"
import useServiceSubscription from "../../store/useServiceSubscription"

export default function StartLaunchFileDialog({ fullname, open, onClose, launchFiles, onLaunchFileSelect }) {
  const [selectedFile, setSelectedFile] = useState(null)
  const [autolaunch, setAutolaunch] = useState(false)

  const serviceMsg = useServiceSubscription(fullname, ["getRepo", "getLaunchFiles"])
  const service = useProcessedMessage(serviceMsg)

  useEffect(() => {
    if (selectedFile && service?.config?.autoLaunch === selectedFile) {
      setAutolaunch(true)
    } else {
      setAutolaunch(false)
    }
  }, [selectedFile, service])

  const handleListItemClick = (file) => {
    setSelectedFile(file)
  }

  const handleLaunch = () => {
    if (selectedFile) {
      onLaunchFileSelect(selectedFile, autolaunch)
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Select Launch File</DialogTitle>
      <DialogContent>
        <List>
          {launchFiles &&
            launchFiles.map((file, index) => (
              <ListItem button key={index} selected={selectedFile === file} onClick={() => handleListItemClick(file)}>
                <ListItemText primary={file} />
              </ListItem>
            ))}
        </List>
        {selectedFile && (
          <Tooltip title="Autolaunch this file when RobotLab-X starts">
            <FormControlLabel
              control={<Checkbox checked={autolaunch} onChange={(e) => setAutolaunch(e.target.checked)} />}
              label="Autolaunch"
            />
          </Tooltip>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleLaunch} disabled={!selectedFile} color="primary">
          Launch
        </Button>
      </DialogActions>
    </Dialog>
  )
}
