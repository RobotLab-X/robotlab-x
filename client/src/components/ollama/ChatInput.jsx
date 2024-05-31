import ArrowUpwardOutlined from "@mui/icons-material/ArrowUpwardOutlined"
import { IconButton, InputAdornment, TextField } from "@mui/material"
import React from "react"

const ChatInput = ({ chatInput, handleChatInputChange, handleSendChat }) => (
  <TextField
    label="Type your message"
    variant="outlined"
    fullWidth
    margin="normal"
    value={chatInput}
    onChange={handleChatInputChange}
    onKeyDown={(e) => {
      if (e.key === "Enter") {
        handleSendChat()
      }
    }}
    InputProps={{
      endAdornment: (
        <InputAdornment position="end">
          <IconButton color="primary" onClick={handleSendChat}>
            <ArrowUpwardOutlined />
          </IconButton>
        </InputAdornment>
      )
    }}
  />
)

export default ChatInput
