import { Box, Typography, useTheme } from "@mui/material"
import React, { useState } from "react"
import ServiceTabs from "../components/ServiceTabs"
import { tokens } from "../theme"

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
