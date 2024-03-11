import React, { useState, useContext } from "react"
import { Box, Typography, useTheme } from "@mui/material"
import { DataGrid } from "@mui/x-data-grid"
import { tokens } from "../theme"
import { mockDataTeam } from "../data/mockData"
import AdminPanelSettingsOutlinedIcon from "@mui/icons-material/AdminPanelSettingsOutlined"
import LockOpenOutlinedIcon from "@mui/icons-material/LockOpenOutlined"
import SecurityOutlinedIcon from "@mui/icons-material/SecurityOutlined"
import Header from "../components/Header"
import { JSONTree } from "react-json-tree"
import Tabs from "@mui/material/Tabs"
import Tab from "@mui/material/Tab"
import TabPanel from "@mui/lab/TabPanel"

const Graph = () => {
  const [value, setValue] = useState(0)

  const [messageInput, setMessageInput] = useState("")

  const handleSendMessage = () => {
    // sendMessage(messageInput)
    setMessageInput("")
  }

  return (
    <>
      <div>
        Last Message: <JSONTree data={"{}"} />
        <div>
          {/* <input type="text" value={messageInput} onChange={handleMessageChange} /> */}

          <button onClick={handleSendMessage}>Send Message</button>
        </div>
      </div>
    </>
  )
}

export default Graph
