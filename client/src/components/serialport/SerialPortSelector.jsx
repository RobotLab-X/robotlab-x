import { Button, FormControl, InputLabel, MenuItem, Select } from "@mui/material"
import React, { useState } from "react"
import { useStore } from "../../store/store"

const SerialPortSelector = ({ fullname, ports, ready }) => {
  const [selectedPort, setSelectedPort] = useState("")
  const [isConnected, setIsConnected] = useState(false)
  const { useMessage, sendTo } = useStore()

  const handlePortChange = (event) => {
    setSelectedPort(event.target.value)
  }

  const handleConnect = () => {
    console.log("Connecting to port:", selectedPort)
    sendTo(fullname, "connect", selectedPort)
    setIsConnected(true)
  }

  const handleDisconnect = () => {
    console.log("Disconnecting from port:", selectedPort)
    sendTo(fullname, "disconnect")
    setIsConnected(false)
  }

  return (
    <div>
      <FormControl fullWidth disabled={ready}>
        <InputLabel id="port-select-label">Select Port</InputLabel>
        <Select labelId="port-select-label" value={selectedPort} onChange={handlePortChange} label="Select Port">
          {ports.map((port) => (
            <MenuItem key={port} value={port}>
              {port}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <Button
        variant="contained"
        color="primary"
        onClick={handleConnect}
        disabled={!selectedPort || isConnected || ready}
        style={{ marginTop: "16px" }}
      >
        Connect
      </Button>
      <Button
        variant="contained"
        color="secondary"
        onClick={handleDisconnect}
        disabled={!ready}
        style={{ marginTop: "16px", marginLeft: "16px" }}
      >
        Disconnect
      </Button>
    </div>
  )
}

export default SerialPortSelector
