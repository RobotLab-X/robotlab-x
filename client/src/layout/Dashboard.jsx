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
import Button from "@mui/material/Button"
import TextField from "@mui/material/TextField"

import HubIcon from "@mui/icons-material/Hub"
import MonitorIcon from "@mui/icons-material/Monitor"

import { Box, IconButton, useTheme } from "@mui/material"
import Tooltip from "@mui/material/Tooltip"
import Service from "framework/Service"
import { fetchGetJson } from "framework/fetchUtil"
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

  // FIXME put in store !!!
  const name = "runtime"
  const version = "0.0.1"
  const typeKey = "RobotLabXUI"

  // should be store
  const [appData, setAppData] = useState([])
  const [msgTxt, setMsgTxt] = useState(
    '{"name":"runtime","method":"getUptime"}'
  )
  const [isLoading, setIsLoading] = useState(true)
  const [open, setOpen] = useState(false)

  const updateRepo = useStore((state) => state.updateRepo)
  const repo = useStore((state) => state.repo)
  const sendJsonMessage = useStore((state) => state.sendJsonMessage)

  const baseUrl = "http://localhost:3001/api/v1/services"
  const repoUrl = "http://localhost:3001/repo"

  const { id } = useStore()

  const handleStartNewService = () => {
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
  const sendMsg = () => {
    console.log(msgTxt)
    sendJsonMessage(msgTxt)
  }
  const handleMsgTxtChange = (event) => {
    setMsgTxt(event.target.value)
  }

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

  /*

        const xtermRef = React.useRef(null)
 
        React.useEffect(() => {
            // You can call any method in XTerm.js by using 'xterm xtermRef.current.terminal.[What you want to call]
            xtermRef.current.terminal.writeln("Hello, World!")
            xtermRef.current.terminal.writeln("Hello, World!")
            xtermRef.current.terminal.writeln("Hello, World!")
            xtermRef.current.terminal.writeln("Hello, World!")
            xtermRef.current.terminal.writeln("Hello, World!")
            xtermRef.current.terminal.writeln("Hello, World!")
            xtermRef.current.terminal.writeln("Hello, World!")
            xtermRef.current.terminal.writeln("Hello, World again!")
        }, [])  
  */

  useEffect(
    () => {
      const fetchData = async () => {
        try {
          const UAParser = require("ua-parser-js")
          const parser = new UAParser()
          const browser = parser.getBrowser()

          // register service
          let service = new Service(
            id,
            name,
            typeKey,
            version,
            browser.name.toLowerCase()
          )
          let response = await put("/runtime/register", service)

          // FIXME - just runtime/registry
          response = await fetchGetJson("/runtime")
          // const json = await response.json()
          // console.info("json", json)
          // should be AppData.ts
          setAppData(response)

          const repoRequest = await fetchGetJson("/runtime/repo")
          // const repoJson = await repoRequest.json()
          updateRepo(repoRequest)
        } catch (error) {
          console.error("Error fetching runtime:", error)
          // Handle error appropriately
        }
      }

      fetchData()
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
    const imagePath = `${repoUrl}/${sd.typeKey}/${sd.typeKey}.png`
    const connectedPath = `${process.env.PUBLIC_URL}/green.png`

    return (
      <>
        <TableRow sx={{ "& > *": { borderBottom: "unset" } }}>
          <TableCell>
            <Tooltip
              title={
                <span>
                  {sd.name}@{sd.id}
                  <br />
                  {sd?.typeKey}
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
            {type?.title}
            <br />
            {sd.name}
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={6}>
            <Collapse in={open} timeout="auto" unmountOnExit>
              <Box margin={1}>
                <Table sx={{ width: 300 }}>
                  <TableBody>
                    <TableRow>
                      <TableCell>Version</TableCell>
                      <TableCell>{type?.version}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Language</TableCell>
                      <TableCell>{type?.language}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Platform</TableCell>
                      <TableCell>{type?.platform}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Platform Version</TableCell>
                      <TableCell>{type?.platformVersion}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Description</TableCell>
                      <TableCell>{type?.description}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                <IconButton type="button" onClick={handleStartNewService}>
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
                  <IconButton type="button" onClick={handleStartNewService}>
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

      <ServiceDialog packages={repo} open={open} setOpen={setOpen} />

      <br />
      <div>
        <TextField
          label="Message"
          multiline
          rows={4}
          value={msgTxt}
          onChange={handleMsgTxtChange}
          variant="outlined"
          fullWidth
          margin="normal"
        />
        <Button onClick={sendMsg} variant="contained">
          Send
        </Button>
      </div>

      {/*<XTerm ref={xtermRef}  />*/}
    </>
  )
}

export default Dashboard
