import Button from "@mui/material/Button"
import Dialog from "@mui/material/Dialog"
import DialogActions from "@mui/material/DialogActions"
import DialogContent from "@mui/material/DialogContent"
import DialogTitle from "@mui/material/DialogTitle"
import TextField from "@mui/material/TextField"
import React, { useState } from "react"
import { useStore } from "store/store"

function ConnectDialog({ id, loopbackPort, open, onClose }) {
  const [url, setUrl] = useState(`ws://localhost:3001/api/messages?id=${id}`)
  const [error, setError] = useState("")
  const { sendTo } = useStore()

  const handleUrlChange = (event) => {
    setUrl(event.target.value)
    setError("") // Clear error when the URL changes
  }

  const handleConnect = () => {
    try {
      const parsedUrl = new URL(url)
      if (parsedUrl.hostname === "localhost" && parsedUrl.port === loopbackPort.toString()) {
        setError("Connecting to loopback on the same port is not supported.")
        console.error("Connecting to loopback not supported:", url)
        return
      }
      console.log("Connecting to:", url)
      sendTo("runtime", "connect", url)
      onClose() // Close dialog after attempting to connect
    } catch (error) {
      setError("Invalid URL. Please enter a valid WebSocket URL.")
      console.error("Invalid URL:", url)
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Connect to Service</DialogTitle>
      <DialogContent>
        <TextField
          margin="dense"
          id="url"
          label="WebSocket URL"
          type="url"
          fullWidth
          variant="outlined"
          value={url}
          onChange={handleUrlChange}
          placeholder={url}
          error={Boolean(error)}
          helperText={error}
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
