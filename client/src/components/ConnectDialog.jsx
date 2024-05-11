import Button from "@mui/material/Button"
import Dialog from "@mui/material/Dialog"
import DialogActions from "@mui/material/DialogActions"
import DialogContent from "@mui/material/DialogContent"
import DialogTitle from "@mui/material/DialogTitle"
import TextField from "@mui/material/TextField"
import React, { useState } from "react"
import { useStore } from "store/store"

function ConnectDialog({ open, onClose }) {
  const [url, setUrl] = useState("ws://localhost:3001/api/messages")
  const { sendTo } = useStore()

  const handleUrlChange = (event) => {
    setUrl(event.target.value)
  }

  const handleConnect = () => {
    console.log("Connecting to:", url)
    sendTo("runtime", "connect", url)
    // Implement connection logic here
    onClose() // Close dialog after attempting to connect
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Connect to Service</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          margin="dense"
          id="url"
          label="WebSocket URL"
          type="url"
          fullWidth
          variant="outlined"
          value={url}
          onChange={handleUrlChange}
          placeholder="ws://example.com:3001/api/messages"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleConnect} variant="contained" color="primary">
          Connect
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default ConnectDialog
