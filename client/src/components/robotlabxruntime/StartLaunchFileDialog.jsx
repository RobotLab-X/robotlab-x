import { Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, ListItemText } from "@mui/material"
import React, { useState } from "react"

export default function StartLaunchFileDialog({ open, onClose, launchFiles, onLaunchFileSelect }) {
  const [selectedFile, setSelectedFile] = useState(null)

  const handleListItemClick = (file) => {
    setSelectedFile(file)
  }

  const handleLaunch = () => {
    if (selectedFile) {
      onLaunchFileSelect(selectedFile)
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Select Launch File</DialogTitle>
      <DialogContent>
        <List>
          {launchFiles &&
            launchFiles?.map((file, index) => (
              <ListItem button key={index} selected={selectedFile === file} onClick={() => handleListItemClick(file)}>
                <ListItemText primary={file} />
              </ListItem>
            ))}
        </List>
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
