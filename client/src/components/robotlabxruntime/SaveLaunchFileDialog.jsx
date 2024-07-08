import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  TextField,
  Tooltip
} from "@mui/material"
import React, { useState } from "react"

export default function SaveLaunchFileDialog({ open, onClose, onSave }) {
  const [filename, setFilename] = useState("")
  const [autolaunch, setAutolaunch] = useState(false)

  const handleSave = () => {
    if (filename) {
      onSave(filename, autolaunch)
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
        <Tooltip title="Autolaunch this file when RobotLab-X starts">
          <FormControlLabel
            control={<Checkbox checked={autolaunch} onChange={(e) => setAutolaunch(e.target.checked)} />}
            label="Autolaunch"
          />
        </Tooltip>
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
