import { Box } from "@mui/material"
import { useProcessedMessage } from "hooks/useProcessedMessage"
import React, { useEffect, useState } from "react"
import { useStore } from "store/store"
import useServiceSubscription from "store/useServiceSubscription"
import OllamaWizard from "wizards/OllamaWizard"

import ChatHistory from "../components/ollama/ChatHistory"
import ChatInput from "../components/ollama/ChatInput"
import ConfigurationSection from "../components/ollama/ConfigurationSection"

export default function Ollama({ name, fullname, id }) {
  console.info(`Ollama ${fullname}`)

  const { useMessage, sendTo } = useStore()
  const getBaseUrl = useStore((state) => state.getBaseUrl)
  const [config, setConfig] = useState(null)
  const [chatInput, setChatInput] = useState("")
  const [chatHistory, setChatHistory] = useState([])
  const [requestResponseHistory, setRequestResponseHistory] = useState([])
  const [editMode, setEditMode] = useState(false)

  const chatMsg = useMessage(fullname, "publishChat")
  const requestMsg = useMessage(fullname, "publishRequest")
  const responseMsg = useMessage(fullname, "publishResponse")

  const [prompts, setPrompts] = useState({})
  const [promptKeys, setPromptKeys] = useState([])
  const [currentPromptIndex, setCurrentPromptIndex] = useState(0)

  const serviceMsg = useServiceSubscription(fullname, ["publishChat", "publishRequest", "publishResponse"])
  const service = useProcessedMessage(serviceMsg)
  const chat = useProcessedMessage(chatMsg)
  const request = useProcessedMessage(requestMsg)
  const response = useProcessedMessage(responseMsg)

  useEffect(() => {
    if (service) {
      setPrompts(service.prompts)
      setConfig(service.config)
    }
  }, [service])

  useEffect(() => {
    if (service?.prompts) {
      setPrompts(service.prompts)
      setPromptKeys(Object.keys(service.prompts))
    }
  }, [service])

  const handleNext = () => {
    setCurrentPromptIndex((prevIndex) => (prevIndex + 1) % promptKeys.length)
  }

  const handlePrev = () => {
    setCurrentPromptIndex((prevIndex) => (prevIndex - 1 + promptKeys.length) % promptKeys.length)
  }

  const currentPromptKey = promptKeys[currentPromptIndex]
  const currentPrompt = prompts[currentPromptKey]

  useEffect(() => {
    if (config?.prompt) {
      const cardIndex = promptKeys.indexOf(config.prompt)
      if (cardIndex !== -1) {
        setCurrentPromptIndex(cardIndex)
      }
    }
  }, [config?.prompt, promptKeys])

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
    // const updatedService = { ...service, config: { ...service.config, installed: true, url: installUrl } }
    //     setService(updatedService)
    config.installed = true
    sendTo(fullname, "applyConfig", config)
    sendTo(fullname, "saveConfig")
    sendTo(fullname, "broadcastState")
  }

  const handleSaveConfig = () => {
    config.prompt = currentPromptKey
    sendTo(fullname, "applyConfig", config)
    sendTo(fullname, "saveConfig")
    sendTo(fullname, "broadcastState")
    setEditMode(false)
  }

  const handleConfigChange = (event) => {
    const { name, value, type } = event.target
    const newValue = type === "number" ? Number(value) : value
    setConfig((prevConfig) => ({
      ...prevConfig,
      [name]: newValue
    }))
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
          <OllamaWizard
            config={config}
            handleConfigChange={handleConfigChange}
            handleFinishInstall={handleFinishInstall}
          />
        )}
      </div>
      {service?.config?.installed && service && (
        <>
          <ConfigurationSection
            config={config}
            handleConfigChange={handleConfigChange}
            handleSaveConfig={handleSaveConfig}
            handlePrev={handlePrev}
            handleNext={handleNext}
            promptKeys={promptKeys}
            currentPromptKey={currentPromptKey}
            currentPrompt={currentPrompt}
            editMode={editMode}
            setEditMode={setEditMode}
            getBaseUrl={getBaseUrl}
            name={name}
          />
          <Box sx={{ width: "66%", mx: "auto", mt: 2 }}>
            <ChatHistory chatHistory={requestResponseHistory} />
            <ChatInput
              chatInput={chatInput}
              handleChatInputChange={handleChatInputChange}
              handleSendChat={handleSendChat}
            />
          </Box>
        </>
      )}
    </>
  )
}
