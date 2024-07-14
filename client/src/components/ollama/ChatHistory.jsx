import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import { Box, IconButton } from "@mui/material"
import React, { useState } from "react"
import ReactJson from "react-json-view"
import { useStore } from "../../store/store"

const ChatHistory = ({ chatHistory }) => {
  const [expandedChats, setExpandedChats] = useState({})
  const debug = useStore((state) => state.debug)

  const toggleExpand = (index) => {
    setExpandedChats((prev) => ({
      ...prev,
      [index]: !prev[index]
    }))
  }

  return (
    <Box sx={{ p: 2 }}>
      {chatHistory
        .slice()
        .reverse()
        .map((chat, index) => {
          let isImage = false
          let type = null
          let content = null
          if (chat?.messages) {
            type = "request"
            // not [0] system content but [1] user content
            // request for chat completion
            content = chat.messages.filter((message) => message.role === "user").slice(-1)[0].content
          }

          if (chat?.images) {
            // request to generate
            type = "request"
            isImage = true
            content = chat.images[0]
          }

          // chat completion
          if (chat?.message) {
            type = "response"
            content = chat.message.content
          }

          // generation
          if (chat?.response) {
            type = "response"
            content = chat.response
          }

          return (
            <Box key={index} sx={{ mb: 2 }}>
              <Box
                sx={{
                  display: "flex",
                  justifyContent: type === "request" ? "flex-end" : "flex-start",
                  alignItems: "center"
                }}
              >
                <Box
                  sx={{
                    backgroundColor: type === "request" ? "lightblue" : "#d4edda", // Muted green color
                    color: "black",
                    borderRadius: 2,
                    maxWidth: "75%",
                    wordBreak: "break-word",
                    padding: 1,
                    display: "inline-block"
                  }}
                >
                  {isImage ? <img src={`data:image/jpg;base64,${content}`} alt="request input" /> : content}
                </Box>
                {debug && (
                  <IconButton onClick={() => toggleExpand(index)} size="small">
                    {expandedChats[index] ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                  </IconButton>
                )}
              </Box>
              {expandedChats[index] && (
                <Box sx={{ mt: 1, ml: 4 }}>
                  <ReactJson
                    src={chat}
                    name={null}
                    displayDataTypes={false}
                    displayObjectSize={false}
                    style={{ fontSize: "12px" }}
                  />
                </Box>
              )}
            </Box>
          )
        })}
    </Box>
  )
}

export default ChatHistory
