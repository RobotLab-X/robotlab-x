import { Box, Button } from "@mui/material"
import ChatInput from "components/ollama/ChatInput"
import React, { useState } from "react"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"
import PythonWizard from "../wizards/PythonWizard"

export default function PyAIML({ fullname }) {
  console.debug(`PyAIML ${fullname}`)

  const [selectedChatBot, setSelectedChatBot] = useState({})

  const { useMessage, sendTo } = useStore()

  const textMsg = useMessage(fullname, "publishText")

  const serviceMsg = useServiceSubscription(fullname, ["publishText"])

  const service = useProcessedMessage(serviceMsg)

  const text = useProcessedMessage(textMsg)

  const chatBots = []

  const [chatInput, setChatInput] = useState("")

  const handleChatInputChange = (event) => {
    setChatInput(event.target.value)
  }

  const handleSendChat = () => {
    if (chatInput.trim() !== "") {
      sendTo(fullname, "chat", chatInput)
      const newMessage = { user: "You", message: chatInput }
      // setChatHistory([...chatHistory, newMessage])
      setChatInput("")
    }
  }

  const handleLoadAIML = () => {
    sendTo(fullname, "loadFile", "example.aiml")
  }

  if (!service?.installed) {
    return <PythonWizard fullname={fullname} />
  } else {
    return (
      <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "80%" }, mt: 2 }}>
        {service?.chatBots && <>bots here</>}
        {text}
        <ChatInput
          chatInput={chatInput}
          handleChatInputChange={handleChatInputChange}
          handleSendChat={handleSendChat}
        />
        <Button variant="contained" color="primary" onClick={handleLoadAIML} sx={{ ml: 2 }}>
          Load AIML
        </Button>
      </Box>
    )
  }
}
