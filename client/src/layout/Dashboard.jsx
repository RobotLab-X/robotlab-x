import InputOutlinedIcon from "@mui/icons-material/InputOutlined"
import PlaylistAddIcon from "@mui/icons-material/PlaylistAddOutlined"
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined"

import HubIcon from "@mui/icons-material/Hub"
import MonitorIcon from "@mui/icons-material/Monitor"

import {
  Box,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  useTheme
} from "@mui/material"
import Tooltip from "@mui/material/Tooltip"
import greenLight from "images/green.png"
import imagesTypesElectron from "images/types/Electron.png"
import imagesTypesNodeJS from "images/types/NodeJS.png"
import imagesTypesRobotLabX from "images/types/RobotLabX.png"
import imagesTypesRobotLabXExpress from "images/types/RobotLabXExpress.png"
import imagesTypesRobotLabXJS from "images/types/RobotLabXJS.png"
import imagesTypesRobotLabXRuntime from "images/types/RobotLabXRuntime.png"
import imagesTypesRobotLabXUI from "images/types/RobotLabXUI.png"
import imagesTypesUnknown from "images/types/Unknown.png"
import { ServiceData } from "models/ServiceData"
import { ServiceTypeData } from "models/ServiceTypeData"
import React, { useEffect, useState } from "react"
import { useStore } from "store/store"
import { tokens } from "../theme"

import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown"
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp"
import { Collapse, Typography } from "@mui/material"

// Map of image names to imported images
const imagesTypes = {
  Electron: imagesTypesElectron,
  NodeJS: imagesTypesNodeJS,
  RobotLabX: imagesTypesRobotLabX,
  RobotLabXExpress: imagesTypesRobotLabXExpress,
  RobotLabXJS: imagesTypesRobotLabXJS,
  RobotLabXRuntime: imagesTypesRobotLabXRuntime,
  RobotLabXUI: imagesTypesRobotLabXUI,
  Unknown: imagesTypesUnknown
}

const Dashboard = () => {
  const theme = useTheme()
  const colors = tokens(theme.palette.mode)
  const iconSize = 32

  const [isLoading, setIsLoading] = useState(true)

  const baseUrl = "http://localhost:3001/api/v1/services"

  const { id } = useStore()

  const handleStartNewNode = () => {
    console.log("Starting new node...")
  }
  const handleConnect = () => {
    console.log("Connect to Existing Node...")
  }
  const handleLoad = () => {
    console.log("Loading...")
  }

  // should be store
  const [appData, setAppData] = useState([])

  async function put(url, data) {
    const response = await fetch(`${baseUrl}${url}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "robotlab-x-id": id
      },
      body: JSON.stringify(data)
    })
    return response
  }

  async function get(url) {
    const response = await fetch(`${baseUrl}${url}`)
    return response
  }

  useEffect(
    () => {
      const fetchNodes = async () => {
        try {
          // register service
          let service = new ServiceData(id, "runtime", "RobotLabXUI", "0.0.1")
          let response = await put("/runtime/register", service)

          // cannot register process except for id

          // register type
          const UAParser = require("ua-parser-js")
          const parser = new UAParser()

          let type = new ServiceTypeData("RobotLabXUI")
          type.version = "0.0.1"
          type.language = "JavaScript"
          type.description = "Robot Lab X UI"
          type.version = "0.0.1"
          type.title = "Robot Lab X UI"
          const browser = parser.getBrowser()
          type.platform = browser.name.toLowerCase()
          type.platformVersion = browser.version

          response = await put("/runtime/registerType", type)

          // cannot register host

          response = await get("/runtime")
          const json = await response.json()
          console.info("json", json)
          // should be AppData.ts
          setAppData(json)
        } catch (error) {
          console.error("Error fetching runtime:", error)
          // Handle error appropriately
        }
      }

      fetchNodes()
    },
    [id] /*[appData]*/
  ) // re-fetch when appData change - too many you mod it above here !

  function getNodeTypeImage(typeName) {
    let ImageToShow = imagesTypes[typeName]
    if (!ImageToShow) {
      ImageToShow = imagesTypes["Unknown"]
    }

    return <img src={ImageToShow} alt={typeName} sx={{ fontSize: iconSize }} />
  }

  function getNodeTypeIcon(node) {
    if (node?.type?.name) {
      let type = node?.type?.name
      if (type === "RobotLabXUI") {
        return <MonitorIcon sx={{ fontSize: iconSize }} />
      } else if (type === "RobotLabXRuntime") {
        return <HubIcon sx={{ fontSize: iconSize }} alt="Hub" />
      }
    }
    return <PlaylistAddIcon sx={{ fontSize: iconSize }} />
  }

  function ServceDataRow({ sd }) {
    const [open, setOpen] = useState(false)
    const typeVersionKey = `${sd?.typeKey}@${sd?.version}`
    const type = appData?.types[typeVersionKey]

    return (
      <>
        <TableRow sx={{ "& > *": { borderBottom: "unset", border: 1 } }}>
          <TableCell>
            <Tooltip
              title={
                <span>
                  {sd.name}@{sd.id}
                  <br />
                  {sd.typeKey}
                  <br />
                </span>
              }
            >
              <img src={greenLight} alt="connected" width="16" />
            </Tooltip>
          </TableCell>
          <TableCell>
            <IconButton size="small" onClick={() => setOpen(!open)}>
              {open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
            </IconButton>
          </TableCell>
          <TableCell></TableCell>
          <TableCell component="th" scope="row">
            {type.title}
          </TableCell>
          <TableCell>{sd.name}</TableCell>
        </TableRow>
        <TableRow>
          <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={6}>
            <Collapse in={open} timeout="auto" unmountOnExit>
              <Box margin={1}>
                <Typography variant="h6" gutterBottom component="div">
                  {sd.typeKey} {getNodeTypeImage(sd.typeKey)} {type.version}
                  {sd.name}@{sd.id}
                </Typography>
                <Typography>Details about {sd.name}</Typography>

                <IconButton type="button" onClick={handleStartNewNode}>
                  {getNodeTypeIcon(sd.typeKey)}
                </IconButton>
              </Box>
            </Collapse>
          </TableCell>
        </TableRow>
      </>
    )
  }

  const nodesArray = Object.values(appData?.registry ?? {})

  return (
    <>
      <Box sx={{ maxWidth: "fit-content", overflowX: "auto", ml: 2 }}>
        <Paper elevation={3}>
          <Table>
            <TableHead />
            <TableBody>
              <TableRow>
                <TableCell>
                  <IconButton type="button" onClick={handleStartNewNode}>
                    <PlaylistAddIcon sx={{ fontSize: iconSize }} />
                  </IconButton>
                </TableCell>
                <TableCell>Start New Node</TableCell>
                <TableCell></TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <IconButton type="button" onClick={handleConnect}>
                    <InputOutlinedIcon sx={{ fontSize: iconSize }} />
                  </IconButton>
                </TableCell>
                <TableCell>Connect to Existing Node</TableCell>
                <TableCell></TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <IconButton type="button" onClick={handleLoad}>
                    <UploadFileOutlinedIcon sx={{ fontSize: iconSize }} />
                  </IconButton>
                </TableCell>
                <TableCell>Load Configuration</TableCell>
                <TableCell></TableCell>
              </TableRow>
              <TableRow>
                <TableCell></TableCell>
                <TableCell></TableCell>
                <TableCell>
                  <Table>
                    <TableBody>
                      {nodesArray.map((node, index) => (
                        <ServceDataRow key={index} sd={node}></ServceDataRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Paper>
      </Box>
      <br />
    </>
  )
}

export default Dashboard
