import Box from "@mui/material/Box"
import Button from "@mui/material/Button"
import CircularProgress from "@mui/material/CircularProgress"
import Grid from "@mui/material/Grid"
import TextField from "@mui/material/TextField"
import Typography from "@mui/material/Typography"
import React, { useState } from "react"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
// import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

import useService from "framework/useService"

export default function MyRobotLabConnector({ name, fullname, id }) {
  const [wsUrl, setWsUrl] = useState(`ws://localhost:8888/api/messages?id=${id}`)
  const [stats, setStats] = useState({ version: "", numberOfServices: 0 })

  const { send } = useService(id, name)

  // const epochMsg = useMessage(fullname, "publishEpoch")

  // creates subscriptions to topics and returns the broadcastState message reference
  const serviceMsg = useServiceSubscription(fullname, [])

  // processes the msg.data[0] and returns the data
  const service = useProcessedMessage(serviceMsg)

  const handleConnect = async () => {
    send("connect", wsUrl)
  }

  return (
    <Grid container spacing={2} alignItems="flex-start">
      <Grid item xs={12} sm={8} md={6} lg={4}>
        <Box sx={{ maxWidth: 500, m: "auto", p: 2 }}>
          <TextField
            fullWidth
            label="WebSocket URL"
            value={wsUrl}
            onChange={(e) => setWsUrl(e.target.value)}
            variant="outlined"
            margin="normal"
          />
          <Button
            variant="contained"
            color="primary"
            onClick={handleConnect}
            disabled={service?.connected || service?.connecting}
            sx={{ mb: 2 }}
          >
            {service?.connecting ? <CircularProgress size={24} /> : "Connect"}
          </Button>
          <Box display="flex" alignItems="center" justifyContent="center" sx={{ mb: 2 }}>
            <Box width={10} height={10} borderRadius="50%" bgcolor={service?.connected ? "green" : "red"} mr={1} />
            <Typography variant="body1">{service?.connected ? "Connected" : "Disconnected"}</Typography>
          </Box>
          {service?.connected && (
            <Box>
              <Typography variant="body2">Version: {stats.version}</Typography>
              <Typography variant="body2">Number of Services: {stats.numberOfServices}</Typography>
            </Box>
          )}
        </Box>
      </Grid>
    </Grid>
  )
}
