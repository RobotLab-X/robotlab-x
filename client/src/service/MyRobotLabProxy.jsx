// MyRobotLabProxy.jsx
import { Box, Button, Paper, Typography } from "@mui/material"
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
  const epochMsg = useMessage(fullname, "publishEpoch")

  // creates subscriptions to topics and returns the broadcastState message reference
  const serviceMsg = useServiceSubscription(fullname, ["publishMessage", "publishEpoch"])

  // processes the msg.data[0] and returns the data
  const proxy = useProcessedMessage(proxyMsg)
  const service = useProcessedMessage(serviceMsg)
  const epoch = useProcessedMessage(epochMsg)

  // clock start
  const handleStart = () => {
    sendTo(fullname, "startClock")
  }

  // clock stop
  const handleStop = () => {
    sendTo(fullname, "stopClock")
  }

  return (
    <>
      <br />
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

      {service?.serviceType.simpleName === "Clock" && (
        <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "30%" } }}>
          <Paper elevation={3} sx={{ p: 2, m: 2 }}>
            <Box sx={{ m: 2 }}>
              <Typography variant="h4" sx={{ mb: 2 }}>
                Interval (ms) <br /> {service?.config.interval}&nbsp;
              </Typography>
              <Typography variant="h4" sx={{ mb: 2 }}>
                Timestamp (ms) <br /> {epoch}&nbsp;
              </Typography>
              <Typography variant="h4" sx={{ mb: 2 }}>
                Formatted Date/Time
                <br /> {epoch}&nbsp;
              </Typography>
              <Box>
                <Button variant="contained" color="primary" onClick={handleStart}>
                  Start
                </Button>
                <Button variant="contained" color="secondary" onClick={handleStop} sx={{ ml: 2 }}>
                  Stop
                </Button>
              </Box>
            </Box>
          </Paper>
        </Box>
      )}
    </>
  )
}
