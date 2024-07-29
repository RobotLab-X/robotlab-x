import { Box } from "@mui/material"
import { useProcessedMessage } from "hooks/useProcessedMessage"
import React, { useEffect, useState } from "react"
import { useStore } from "store/store"
import useServiceSubscription from "store/useServiceSubscription"
import OllamaWizard from "wizards/OllamaWizard"

import ChatHistory from "../components/ollama/ChatHistory"
import ChatInput from "../components/ollama/ChatInput"
import ConfigurationSection from "../components/ollama/ConfigurationSection"

export default function Ollama({ fullname }) {
  console.debug(`Ollama ${fullname}`)

  const { useMessage, sendTo } = useStore()
  const [config, setConfig] = useState(null)
  const [chatInput, setChatInput] = useState("")
  const [chatHistory, setChatHistory] = useState([])
  const [requestResponseHistory, setRequestResponseHistory] = useState([])

  const chatMsg = useMessage(fullname, "publishChat")
  const requestMsg = useMessage(fullname, "publishRequest")
  const responseMsg = useMessage(fullname, "publishResponse")

  const serviceMsg = useServiceSubscription(fullname, ["publishChat", "publishRequest", "publishResponse"])
  const service = useProcessedMessage(serviceMsg)
  const chat = useProcessedMessage(chatMsg)
  const request = useProcessedMessage(requestMsg)
  const response = useProcessedMessage(responseMsg)

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
