import React, { useState, useContext } from "react"
import { Box, Typography, useTheme } from "@mui/material"
import { DataGrid } from "@mui/x-data-grid"
import { tokens } from "../theme"
import { mockDataTeam } from "../data/mockData"
import ServiceTabs from "../components/ServiceTabs"
import AdminPanelSettingsOutlinedIcon from "@mui/icons-material/AdminPanelSettingsOutlined"
import LockOpenOutlinedIcon from "@mui/icons-material/LockOpenOutlined"
import SecurityOutlinedIcon from "@mui/icons-material/SecurityOutlined"
import Header from "../components/Header"
import { JSONTree } from "react-json-tree"

const TabLayout = () => {
  const [value, setValue] = useState(0)

  const handleChange = (event, newValue) => {
    setValue(newValue)
  }

  function TabPanel(props) {
    const { children, value, index, ...other } = props

    return (
      <div
        role="tabpanel"
        hidden={value !== index}
        id={`simple-tabpanel-${index}`}
        aria-labelledby={`simple-tab-${index}`}
        {...other}
      >
        {value === index && (
          <Box sx={{ p: 3 }}>
            <Typography>{children}</Typography>
          </Box>
        )}
      </div>
    )
  }

  const theme = useTheme()
  const colors = tokens(theme.palette.mode)

  return (
    <>
      <ServiceTabs />
      <div>
        {/*Last Message: <JSONTree data={message} /> */}
        <div>{/* <input type="text" value={messageInput} onChange={handleMessageChange} /> */}</div>
      </div>
    </>
  )
}

export default TabLayout
