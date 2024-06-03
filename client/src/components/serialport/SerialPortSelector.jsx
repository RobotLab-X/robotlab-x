import { Button, FormControl, InputLabel, MenuItem, Select } from "@mui/material"
import React, { useEffect, useState } from "react"
import { useStore } from "../../store/store"

const SerialPortSelector = ({ portInfo }) => {
  const [selectedPort, setSelectedPort] = useState(portInfo.port || "")
  const { useMessage, sendTo } = useStore()

  useEffect(() => {
    setSelectedPort(portInfo.port)
  }, [portInfo.port])

  const handlePortChange = (event) => {
    setSelectedPort(event.target.value)
  }

  const handleConnect = () => {
    console.log("Connecting to port:", selectedPort)
    sendTo(portInfo.fullname, "connect", selectedPort)
  }

  const handleDisconnect = () => {
    console.log("Disconnecting from port:", selectedPort)
    sendTo(portInfo.fullname, "disconnect")
  }

  return (
    <div>
      <FormControl fullWidth disabled={portInfo.isConnected}>
        <InputLabel id="port-select-label">Select Port</InputLabel>
        <Select labelId="port-select-label" value={selectedPort} onChange={handlePortChange} label="Select Port">
          {portInfo.ports.map((port) => (
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
        disabled={!selectedPort || portInfo.isConnected}
        style={{ marginTop: "16px" }}
      >
        Connect
      </Button>
      <Button
        variant="contained"
        color="secondary"
        onClick={handleDisconnect}
        disabled={!portInfo.isConnected}
        style={{ marginTop: "16px", marginLeft: "16px" }}
      >
        Disconnect
      </Button>
    </div>
  )
}

export default SerialPortSelector
