import InputOutlinedIcon from "@mui/icons-material/InputOutlined"
import PlaylistAddIcon from "@mui/icons-material/PlaylistAddOutlined"
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined"
import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow
} from "@mui/material"

import HubIcon from "@mui/icons-material/Hub"
import MonitorIcon from "@mui/icons-material/Monitor"

import { Box, IconButton, useTheme } from "@mui/material"
import Tooltip from "@mui/material/Tooltip"
import { ServiceData } from "models/ServiceData"
import React, { useEffect, useState } from "react"
import { useStore } from "store/store"
import { tokens } from "../theme"

import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown"
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp"
import { Collapse } from "@mui/material"
import ServiceDialog from "components/ServiceDialog"

const Dashboard = () => {
  const theme = useTheme()
  const colors = tokens(theme.palette.mode)
  const iconSize = 32
  const [open, setOpen] = useState(false)

  const [isLoading, setIsLoading] = useState(true)

  const updateRepo = useStore((state) => state.updateRepo)
  const repo = useStore((state) => state.repo)

  const baseUrl = "http://localhost:3001/api/v1/services"

  const { id } = useStore()

  const handleStartNewNode = () => {
    console.info("Starting new node...")
    setOpen(true) // Open the modal dialog
  }
  const handleConnect = () => {
    console.info("Connect to Existing Node...")
  }
  const handleLoad = () => {
    console.info("Loading...")
  }

  const handleClose = () => {
    setOpen(false)
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
          const UAParser = require("ua-parser-js")
          const parser = new UAParser()

          const browser = parser.getBrowser()

          // register service
          let service = new ServiceData(
            id,
            "runtime",
            "RobotLabXUI",
            "0.0.1",
            browser.name.toLowerCase()
          )
          let response = await put("/runtime/register", service)

          // cannot register process except for id

          // register type - should be static ?

          // let type = new ServiceTypeData("RobotLabXUI")
          // type.version = "0.0.1"
          // type.language = "JavaScript"
          // type.description = "Robot Lab X UI"
          // type.version = "0.0.1"
          // type.title = "Robot Lab X UI"
          // type.platform = browser.name.toLowerCase()
          // type.platformVersion = browser.version

          // response = await put("/runtime/registerType", type)

          // cannot register host

          response = await get("/runtime")
          const json = await response.json()
          console.info("json", json)
          // should be AppData.ts
          setAppData(json)

          const repo = await get("/runtime/repo")
          const repoJson = await repo.json()
          updateRepo(repoJson)
        } catch (error) {
          console.error("Error fetching runtime:", error)
          // Handle error appropriately
        }
      }

      fetchNodes()
    },
    [id] /*[appData]*/
  ) // re-fetch when appData change - too many you mod it above here !

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
    const type = repo[typeVersionKey]
    const imagePath = `${process.env.PUBLIC_URL}/service/${sd.typeKey}/${sd.typeKey}.png`
    const connectedPath = `${process.env.PUBLIC_URL}/green.png`
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
              <img src={connectedPath} alt="connected" width="16" />
            </Tooltip>
          </TableCell>
          <TableCell>
            <IconButton size="small" onClick={() => setOpen(!open)}>
              {open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
            </IconButton>
          </TableCell>
          <TableCell>
            <img src={imagePath} alt={sd.typeKey} />
          </TableCell>
          <TableCell component="th" scope="row">
            {type.title}
          </TableCell>
          <TableCell>{sd.name}</TableCell>
        </TableRow>
        <TableRow>
          <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={6}>
            <Collapse in={open} timeout="auto" unmountOnExit>
              <Box margin={1}>
                <Table sx={{ width: 300 }}>
                  <TableBody>
                    <TableRow>
                      <TableCell>Version</TableCell>
                      <TableCell>{type.version}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Language</TableCell>
                      <TableCell>{type.language}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Platform</TableCell>
                      <TableCell>{type.platform}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Platform Version</TableCell>
                      <TableCell>{type.platformVersion}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Description</TableCell>
                      <TableCell>{type.description}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
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

  // FIXME - put in store in App.js
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
                <TableCell>Start New Service</TableCell>
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

      <ServiceDialog packages={repo} />

      <br />
    </>
  )
}

export default Dashboard
