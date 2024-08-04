import { Box } from "@mui/material"
import React, { useEffect, useState } from "react"
import { useStore } from "store/store"
import useSubscription from "store/useSubscription"
import OllamaWizard from "wizards/OllamaWizard"

import ChatHistory from "components/ollama/ChatHistory"
import ChatInput from "components/ollama/ChatInput"
import ConfigurationSection from "components/ollama/ConfigurationSection"

export default function Ollama({ fullname }) {
  console.info(`Ollama ${fullname}`)

  const { sendTo } = useStore()
  const [config, setConfig] = useState(null)
  const [chatInput, setChatInput] = useState("")
  const [chatHistory, setChatHistory] = useState([])
  const [requestResponseHistory, setRequestResponseHistory] = useState([])

  const service = useSubscription(fullname, "broadcastState", true)
  const chat = useSubscription(fullname, "publishChat")
  const request = useSubscription(fullname, "publishRequest")
  const response = useSubscription(fullname, "publishResponse")

  useEffect(() => {
    if (service) {
      setConfig(service.config)
    }
  }, [service])

  useEffect(() => {
    if (chat) {
      const newMessage = { user: "Bot", message: chat }
      setChatHistory([...chatHistory, newMessage])
    }
  }, [chat])

  useEffect(() => {
    if (request) {
      setRequestResponseHistory([...requestResponseHistory, request])
    }
  }, [request])

  useEffect(() => {
    if (response) {
      setRequestResponseHistory([...requestResponseHistory, response])
    }
  }, [response])

  const handleFinishInstall = () => {
    if (config) {
      config.installed = true
      sendTo(fullname, "applyConfig", config)
      sendTo(fullname, "saveConfig")
      sendTo(fullname, "broadcastState")
    }
  }

  const handleChatInputChange = (event) => {
    setChatInput(event.target.value)
  }

  const handleSendChat = () => {
    if (chatInput.trim() !== "") {
      sendTo(fullname, "chat", chatInput)
      const newMessage = { user: "You", message: chatInput }
      setChatHistory([...chatHistory, newMessage])
      setChatInput("")
    }
  }

  return (
    <>
      <br />
      <div className="multi-step-form">
        {!service?.config?.installed && service && (
          <OllamaWizard config={config} handleFinishInstall={handleFinishInstall} />
        )}
      </div>
      {service?.config?.installed && service && (
        <>
          <ConfigurationSection fullname={fullname} />

          <ChatInput
            chatInput={chatInput}
            handleChatInputChange={handleChatInputChange}
            handleSendChat={handleSendChat}
          />

          <Box sx={{ width: "66%", mx: "auto", mt: 2 }}>
            <ChatHistory chatHistory={requestResponseHistory} />
          </Box>
        </>
      )}
    </>
  )
}
