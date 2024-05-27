// MyRobotLabProxy.jsx
import { Typography } from "@mui/material"
import ReactJson from "react-json-view"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

// FIXME remove fullname with context provider
export default function MyRobotLabProxy({ name, fullname, id }) {
  const { useMessage, sendTo } = useStore()
  const getBaseUrl = useStore((state) => state.getBaseUrl)
  const getRepoUrl = useStore((state) => state.getRepoUrl)

  // mrl uses publish/onState to broadcast state changes
  // rlx uses broadcastState/onBroadcastState to broadcast state changes
  const proxyMsg = useMessage(fullname, "publishMessage")

  // creates subscriptions to topics and returns the broadcastState message reference
  const serviceMsg = useServiceSubscription(fullname, ["publishMessage"])

  // processes the msg.data[0] and returns the data
  const proxy = useProcessedMessage(proxyMsg)
  const service = useProcessedMessage(serviceMsg)

  return (
    <>
      <Typography variant="h6">My Robot Lab Service</Typography>

      {service && (
        <img
          src={`${getRepoUrl()}/MyRobotLabConnector/images/${service?.serviceType.simpleName}.png`}
          alt={service.name}
          width="32"
          style={{ verticalAlign: "middle" }}
        />
      )}
      {proxy && <ReactJson src={proxy} name="proxy" displayDataTypes={false} displayObjectSize={false} />}

      {/*
      <ReactJson src={proxy} name="proxyMsg" displayDataTypes={false} displayObjectSize={false} />
      */}
    </>
  )
}
