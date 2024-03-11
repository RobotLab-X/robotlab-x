import React, { useState, useEffect } from "react"
// import { ProSidebar, Menu, MenuItem } from "react-pro-sidebar"
import { Sidebar, Menu, MenuItem, SubMenu } from "react-pro-sidebar"
import { Box, IconButton, Typography, useTheme } from "@mui/material"
import Stack from "@mui/material/Stack"
import Button from "@mui/material/Button"

import { Link } from "react-router-dom"
// import "react-pro-sidebar/dist/css/styles.css"
import { tokens } from "../../theme"

// icons
import TabOutlinedIcon from "@mui/icons-material/TabOutlined"
import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined"
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined"
import PeopleOutlinedIcon from "@mui/icons-material/PeopleOutlined"
import HubOutlinedIcon from "@mui/icons-material/HubOutlined"
import ContactsOutlinedIcon from "@mui/icons-material/ContactsOutlined"
import ReceiptOutlinedIcon from "@mui/icons-material/ReceiptOutlined"
import PersonOutlinedIcon from "@mui/icons-material/PersonOutlined"
import CalendarTodayOutlinedIcon from "@mui/icons-material/CalendarTodayOutlined"
import HelpOutlineOutlinedIcon from "@mui/icons-material/HelpOutlineOutlined"
import BarChartOutlinedIcon from "@mui/icons-material/BarChartOutlined"
import PieChartOutlineOutlinedIcon from "@mui/icons-material/PieChartOutlineOutlined"
import TimelineOutlinedIcon from "@mui/icons-material/TimelineOutlined"

import vrIcon from "./vr-lite.png"

import MenuOutlinedIcon from "@mui/icons-material/MenuOutlined"
import MapOutlinedIcon from "@mui/icons-material/MapOutlined"
import TroubleshootOutlinedIcon from "@mui/icons-material/TroubleshootOutlined"
import { useStore } from "../../store/store"

const Item = ({ title, to, icon, selected, setSelected }) => {
  const theme = useTheme()
  const colors = tokens(theme.palette.mode)
  return (
    <MenuItem
      active={selected === title}
      style={{
        color: colors.grey[100],
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
  const { connect, connected } = useStore()
  const theme = useTheme()
  const colors = tokens(theme.palette.mode)
  const [isCollapsed, setIsCollapsed] = useState(true)
  const [selected, setSelected] = useState("Dashboard")

  useEffect(() => {
    connect()
  }, [connect])

  return (
    <Box
      sx={{
        "& .pro-sidebar-inner": {
          background: `${colors.primary[400]} !important`,
        },
        "& .pro-icon-wrapper": {
          backgroundColor: "transparent !important",
        },
        "& .pro-inner-item": {
          padding: "5px 35px 5px 20px !important",
        },
        "& .pro-inner-item:hover": {
          color: "#868dfb !important",
        },
        "& .pro-menu-item.active": {
          color: "#6870fa !important",
        },
      }}
    >
      <Sidebar collapsed={isCollapsed}>
        <Menu iconShape="square">
          <Box align="center">
            <img
              alt={connected ? `connected` : `disconnected`}
              style={{
                width: "22px",
                alighn: "center",
              }}
              src={connected ? `assets/green.png` : `assets/red.png`}
            />
          </Box>

          {/* LOGO AND MENU ICON */}
          <MenuItem
            onClick={() => setIsCollapsed(!isCollapsed)}
            icon={isCollapsed ? <MenuOutlinedIcon /> : undefined}
            style={{
              margin: "10px 0 20px 0",
              color: colors.grey[100],
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
              <Box display="flex" justifyContent="center" alignItems="center">
                <img
                  alt="profile-user"
                  width="100px"
                  height="100px"
                  src={`assets/logo.png`}
                  style={{ cursor: "pointer", borderRadius: "50%" }}
                />
              </Box>
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

          <MenuItem component={<Link to="/" />} icon={<DashboardOutlinedIcon />}>
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
