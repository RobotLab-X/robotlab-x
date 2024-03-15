import InputOutlinedIcon from '@mui/icons-material/InputOutlined'
import PlaylistAddIcon from '@mui/icons-material/PlaylistAddOutlined'
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined'

import HubIcon from '@mui/icons-material/Hub'
import MonitorIcon from '@mui/icons-material/Monitor'
import Tooltip from '@mui/material/Tooltip'

import { useStore } from 'store/store'

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
} from '@mui/material'
import greenLight from 'images/green.png'
import imagesTypesElectron from 'images/types/Electron.png'
import imagesTypesNodeJS from 'images/types/NodeJS.png'
import imagesTypesRobotLabX from 'images/types/RobotLabX.png'
import imagesTypesRobotLabXExpress from 'images/types/RobotLabXExpress.png'
import imagesTypesRobotLabXJS from 'images/types/RobotLabXJS.png'
import imagesTypesRobotLabXManager from 'images/types/RobotLabXManager.png'
import imagesTypesRobotLabXUI from 'images/types/RobotLabXUI.png'
import imagesTypesUnknown from 'images/types/Unknown.png'
import React, { useEffect, useState } from 'react'
import { tokens } from '../theme'

// Map of image names to imported images
const imagesTypes = {
  Electron: imagesTypesElectron,
  NodeJS: imagesTypesNodeJS,
  RobotLabX: imagesTypesRobotLabX,
  RobotLabXExpress: imagesTypesRobotLabXExpress,
  RobotLabXJS: imagesTypesRobotLabXJS,
  RobotLabXManager: imagesTypesRobotLabXManager,
  RobotLabXUI: imagesTypesRobotLabXUI,
  Unknown: imagesTypesUnknown
}

const Dashboard = () => {
  const theme = useTheme()
  const colors = tokens(theme.palette.mode)
  const iconSize = 32

  const { id } = useStore()

  const handleStartNewNode = () => {
    console.log('Starting new node...')
  }
  const handleConnect = () => {
    console.log('Connect to Existing Node...')
  }
  const handleLoad = () => {
    console.log('Loading...')
  }

  const [nodes, setNodes] = useState([])

  useEffect(
    () => {
      const fetchNodes = async () => {
        try {
          // do a use affect that registers this node
          // then another node that asks for all nodes

          let response = await fetch('http://localhost:3001/api/v1/register', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'robotlab-x-id': id
            },
            body: JSON.stringify(getLocalRuntimeNode())
          })
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`)
          }

          // Replace 'your-api-endpoint' with the actual endpoint
          response = await fetch('http://localhost:3001/api/v1/nodes')
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`)
          }
          const data = await response.json()

          setNodes(data.nodes)
        } catch (error) {
          console.error('Error fetching nodes:', error)
          // Handle error appropriately
        }
      }

      fetchNodes()
    },
    [] /*[nodes]*/
  ) // re-fetch when nodes change - too many you mod it above here !

  function getLocalRuntimeNode() {
    const UAParser = require('ua-parser-js')
    const parser = new UAParser()

    let node = {
      id: id, // 'browser-angry-robot-323924',
      name: 'runtime',
      host: {
        hostname: null,
        platform: navigator.userAgent,
        architecture: navigator.platform
      },
      type: {
        name: 'RobotLabXUI',
        description: 'Robot Lab X UI',
        version: '0.0.1'
      },
      process: {
        pid: 0,
        platform: parser.getBrowser()
      }
    }

    return node
  }

  function getNodeTypeImage(typeName) {
    let ImageToShow = imagesTypes[typeName]
    if (!ImageToShow) {
      ImageToShow = imagesTypes['Unknown']
    }

    return <img src={ImageToShow} alt={typeName} sx={{ fontSize: iconSize }} />
  }

  function getNodeTypeIcon(node) {
    if (node?.type?.name) {
      let type = node?.type?.name
      if (type === 'RobotLabXUI') {
        return <MonitorIcon sx={{ fontSize: iconSize }} />
      } else if (type === 'RobotLabXManager') {
        return <HubIcon sx={{ fontSize: iconSize }} alt="DOOOOD !! WTF !!" />
      }
    }
    return <PlaylistAddIcon sx={{ fontSize: iconSize }} />
  }

  const nodesArray = Object.values(nodes)

  return (
    <Box sx={{ maxWidth: 'fit-content', overflowX: 'auto', ml: 2 }}>
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
                      <TableRow key={index}>
                        <TableCell>
                          <img src={greenLight} alt="connected" width="16" />
                        </TableCell>
                        <TableCell>
                          <Tooltip
                            title={
                              <span>
                                {node.type.description} {node.type.version}
                                <br />
                                {node.id}
                                <br />
                                {node.name}
                                <br />
                                {node.host.platform}
                                <br />
                              </span>
                            }
                          >
                            <IconButton
                              type="button"
                              onClick={handleStartNewNode}
                            >
                              {getNodeTypeIcon(node)}
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                        <TableCell>{node.host.hostname}</TableCell>
                        <TableCell>{node.id}</TableCell>
                        <TableCell>
                          {node.host.platform}.{node.host.architecture}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Paper>
    </Box>
  )
}

export default Dashboard
