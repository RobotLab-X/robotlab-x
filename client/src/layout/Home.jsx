import { AppBar, Box, Tab, Tabs, Toolbar, Typography } from "@mui/material"
import React, { useState } from "react"

function Home() {
  const [selectedTab, setSelectedTab] = useState(0)

  const handleTabChange = (event, newValue) => {
    setSelectedTab(newValue)
  }

  return (
    <Box sx={{ display: "flex", height: "100vh" }}>
      <Box sx={{ width: "300px", borderRight: 1, borderColor: "divider" }}>
        <AppBar position="static" color="default">
          <Toolbar>
            <Typography variant="h6" color="inherit" noWrap>
              Project Dashboard
            </Typography>
          </Toolbar>
        </AppBar>
        <Tabs
          orientation="vertical"
          variant="scrollable"
          value={selectedTab}
          onChange={handleTabChange}
          aria-label="Vertical tabs example"
          sx={{ borderRight: 1, borderColor: "divider" }}
        >
          <Tab label="Item One" />
          <Tab label="Item Two" />
          <Tab label="Item Three" />
        </Tabs>
      </Box>
      <Box sx={{ flexGrow: 1, p: 3 }}>
        <Typography variant="h4">Welcome to the Dashboard</Typography>
        {selectedTab === 0 && <Typography>Content of Item One</Typography>}
        {selectedTab === 1 && <Typography>Content of Item Two</Typography>}
        {selectedTab === 2 && <Typography>Content of Item Three</Typography>}
      </Box>
    </Box>
  )
}

export default Home
