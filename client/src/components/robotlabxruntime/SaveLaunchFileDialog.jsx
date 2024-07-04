import { Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from "@mui/material"
import React, { useState } from "react"

export default function SaveLaunchFileDialog({ open, onClose, onSave }) {
  const [filename, setFilename] = useState("")

  const handleSave = () => {
    if (filename) {
      onSave(filename)
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Save Launch File</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          margin="dense"
          label="Filename"
          fullWidth
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={!filename} color="primary">
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}
