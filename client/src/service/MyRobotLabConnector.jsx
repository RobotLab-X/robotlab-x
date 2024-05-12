import Box from "@mui/material/Box"
import Button from "@mui/material/Button"
import CircularProgress from "@mui/material/CircularProgress"
import Grid from "@mui/material/Grid"
import TextField from "@mui/material/TextField"
import Typography from "@mui/material/Typography"
import React, { useState } from "react"
import { useStore } from "../store/store"

import useService from "framework/useService"

export default function MyRobotLabConnector(props) {
  const id = useStore((state) => state.id)
  const [wsUrl, setWsUrl] = useState(`ws://localhost:8888/api/messages?id=${id}`)
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState({ version: "", numberOfServices: 0 })

  const sendTo = useStore((state) => state.sendTo)
  const { getId, getName, send, getFullName } = useService(props.id, props.name)

  const handleConnect = async () => {
    setLoading(true)
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
            disabled={connected || loading}
            sx={{ mb: 2 }}
          >
            {loading ? <CircularProgress size={24} /> : "Connect"}
          </Button>
          <Box display="flex" alignItems="center" justifyContent="center" sx={{ mb: 2 }}>
            <Box width={10} height={10} borderRadius="50%" bgcolor={connected ? "green" : "red"} mr={1} />
            <Typography variant="body1">{connected ? "Connected" : "Disconnected"}</Typography>
          </Box>
          {connected && (
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
