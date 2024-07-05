// MyRobotLabProxy.jsx
import React, { useState } from "react"
import ReactJson from "react-json-view"
import Clock from "../components/myrobotlabconnector/Clock"
import ProgramAB from "../components/myrobotlabconnector/ProgramAB"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

// FIXME remove fullname with context provider
export default function MyRobotLabProxy({ name, fullname, id }) {
  console.info(`MyRobotLabProxy ${fullname}`)

  const { useMessage, sendTo } = useStore()
  const getBaseUrl = useStore((state) => state.getBaseUrl)
  const getRepoUrl = useStore((state) => state.getRepoUrl)

  // mrl uses publish/onState to broadcast state changes
  // rlx uses broadcastState/onBroadcastState to broadcast state changes
  const proxyMsg = useMessage(fullname, "publishMessage")
  const epochMsg = useMessage(fullname, "publishEpoch")
  const responseMsg = useMessage(fullname, "getResponse")

  // creates subscriptions to topics and returns the broadcastState message reference
  const serviceMsg = useServiceSubscription(fullname, ["publishMessage", "publishEpoch", "getResponse"])

  // processes the msg.data[0] and returns the data
  const proxy = useProcessedMessage(proxyMsg)
  const service = useProcessedMessage(serviceMsg)
  const epoch = useProcessedMessage(epochMsg)
  const response = useProcessedMessage(responseMsg)

  const [inputValue, setInputValue] = useState("")

  // clock start
  const handleStart = () => {
    sendTo(fullname, "startClock")
  }

  // clock stop
  const handleStop = () => {
    sendTo(fullname, "stopClock")
  }

  const handleInputSubmit = (event) => {
    if (event.key === "Enter") {
      event.preventDefault()
      // Handle the input value here
      console.log("Input submitted:", inputValue)
      sendTo(fullname, "getResponse", inputValue)
      // Clear the input field
      setInputValue("")
    }
  }

  return (
    <>
      <br />
      {service && (
        <img
          src={`${getRepoUrl()}/myrobotlabconnector/images/${service?.serviceType?.simpleName}.png`}
          alt={service.name}
          width="32"
          style={{ verticalAlign: "middle" }}
        />
      )}
      {proxy && <ReactJson src={proxy} name="proxy" displayDataTypes={false} displayObjectSize={false} />}

      {/*
      <ReactJson src={proxy} name="proxyMsg" displayDataTypes={false} displayObjectSize={false} />
      */}

      {service?.serviceType?.simpleName === "Clock" && (
        <Clock service={service} epoch={epoch} handleStart={handleStart} handleStop={handleStop} />
      )}

      {service?.serviceType?.simpleName === "ProgramAB" && (
        <ProgramAB
          service={service}
          epoch={epoch}
          handleInputSubmit={handleInputSubmit}
          inputValue={inputValue}
          setInputValue={setInputValue}
          response={response}
        />
      )}
    </>
  )
}
