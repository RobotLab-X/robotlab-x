import { Box } from "@mui/material"
import Button from "@mui/material/Button"
import React, { useState } from "react"
import { useStore } from "store/store"

const SendMsgTextArea = ({ msg }) => {
  const [message, setMessage] = useState(msg || "")
  const sendJsonMessage = useStore((state) => state.sendJsonMessage)

  // Function to handle button click
  const handleSendClick = () => {
    if (message.trim() !== "") {
      sendJsonMessage(message)
      // setMessage("") // Clear the textarea after sending
    }
  }

  return (
    <Box sx={{ maxWidth: 300, margin: "auto", paddingTop: 2 }}>
      <textarea
        rows={10}
        placeholder="Type your message here..."
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      /><br/>
      <Button variant="contained" color="primary" onClick={handleSendClick} disabled={message.trim() === ""}>
        Send
      </Button>
    </Box>
  )
}

export default SendMsgTextArea
