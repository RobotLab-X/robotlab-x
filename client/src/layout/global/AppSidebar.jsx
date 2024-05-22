import React, { useState } from "react"
// import { ProSidebar, Menu, MenuItem } from "react-pro-sidebar"
import { Box, IconButton, Typography, useTheme } from "@mui/material"
import { Menu, MenuItem, Sidebar } from "react-pro-sidebar"

import { Link } from "react-router-dom"
// import "react-pro-sidebar/dist/css/styles.css"
import { tokens } from "../../theme"

// icons
import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined"
import HomeIcon from "@mui/icons-material/Home"
import HubOutlinedIcon from "@mui/icons-material/HubOutlined"
import TabOutlinedIcon from "@mui/icons-material/TabOutlined"

import MenuOutlinedIcon from "@mui/icons-material/MenuOutlined"
import TroubleshootOutlinedIcon from "@mui/icons-material/TroubleshootOutlined"
import { useStore } from "../../store/store"

const Item = ({ title, to, icon, selected, setSelected }) => {
  const theme = useTheme()
  const colors = tokens(theme.palette.mode)
  return (
    <MenuItem
      active={selected === title}
      style={{
        color: colors.grey[100]
      }}
      onClick={() => setSelected(title)}
      icon={icon}
    >
      <Typography>{title}</Typography>
      <Link to={to} />
    </MenuItem>
  )
}

const AppSidebar = () => {
  const connected = useStore((state) => state.connected)
  const theme = useTheme()
  const colors = tokens(theme.palette.mode)
  const [isCollapsed, setIsCollapsed] = useState(true)
  const [selected, setSelected] = useState("Dashboard")

  return (
    <Box
      sx={{
        "& .pro-sidebar-inner": {
          background: `${colors.primary[400]} !important`
        },
        "& .pro-icon-wrapper": {
          backgroundColor: "transparent !important"
        },
        "& .pro-inner-item": {
          padding: "5px 35px 5px 20px !important"
        },
        "& .pro-inner-item:hover": {
          color: "#868dfb !important"
        },
        "& .pro-menu-item.active": {
          color: "#6870fa !important"
        }
      }}
    >
      <Sidebar collapsed={isCollapsed}>
        <Menu iconShape="square">
          <br />
          <Box align="center">
            <img
              alt={connected ? `connected` : `disconnected`}
              style={{
                width: "22px",
                alighn: "center"
              }}
              src={connected ? `green.png` : `red.png`}
            />
          </Box>

          {/* LOGO AND MENU ICON */}
          <MenuItem
            onClick={() => setIsCollapsed(!isCollapsed)}
            icon={isCollapsed ? <MenuOutlinedIcon /> : undefined}
            style={{
              margin: "10px 0 20px 0",
              color: colors.grey[100]
            }}
          >
            {!isCollapsed && (
              <Box display="flex" justifyContent="space-between" alignItems="center" ml="15px">
                <Typography variant="h3" color={colors.grey[100]}>
                  ADMINIS
                </Typography>
                <IconButton onClick={() => setIsCollapsed(!isCollapsed)}>
                  <MenuOutlinedIcon />
                </IconButton>
              </Box>
            )}
          </MenuItem>

          {!isCollapsed && (
            <Box mb="25px">
              <Box display="flex" justifyContent="center" alignItems="center"></Box>
              <Box textAlign="center">
                <Typography variant="h2" color={colors.grey[100]} fontWeight="bold" sx={{ m: "10px 0 0 0" }}>
                  RobotLab-X
                </Typography>
                <Typography variant="h5" color={colors.greenAccent[500]}>
                  GroG
                </Typography>
              </Box>
            </Box>
          )}

          <MenuItem component={<Link to="/" />} icon={<HomeIcon />}>
            Home
          </MenuItem>

          <MenuItem component={<Link to="/dashboard" />} icon={<DashboardOutlinedIcon />}>
            Dashboard
          </MenuItem>

          <MenuItem component={<Link to="/tabs" />} icon={<TabOutlinedIcon />}>
            Tabs
          </MenuItem>

          <MenuItem component={<Link to="/graph" />} icon={<HubOutlinedIcon />}>
            Graph
          </MenuItem>

          <MenuItem component={<Link to="/network" />} icon={<TroubleshootOutlinedIcon />}>
            Network and Diagnostics
          </MenuItem>

          <MenuItem component={<Link to="/webxr" />} icon={<TroubleshootOutlinedIcon />}>
            <img src={`assets/vr-lite.png`} alt="WebXR" width="22" />
            WebXR
          </MenuItem>
        </Menu>
      </Sidebar>
    </Box>
  )
}

export default AppSidebar
