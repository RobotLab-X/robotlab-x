import React, { useState, useEffect } from 'react'
import { Box, Button, IconButton, Typography, useTheme } from '@mui/material'
import { tokens } from '../theme'
import InputIcon from '@mui/icons-material/Input'
import greenLight from 'images/green.png'
import {
  Container,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Paper
} from '@mui/material'
import PlaylistAddIcon from '@mui/icons-material/PlaylistAddOutlined'
import InputOutlinedIcon from '@mui/icons-material/InputOutlined'
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined'

const Dashboard = () => {
  const theme = useTheme()
  const colors = tokens(theme.palette.mode)

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

  useEffect(() => {
    const fetchNodes = async () => {
      try {
        // Replace 'your-api-endpoint' with the actual endpoint
        const response = await fetch('http://localhost:3001/nodes')
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        const data = await response.json()
        data.nodes['browser'] = {
          id: 'browser-angry-robot-323924',
          host: {
            hostname: 'browser',
            platform: navigator.userAgent,
            architecture: navigator.platform
          }
        }
        setNodes(data.nodes)
      } catch (error) {
        console.error('Error fetching nodes:', error)
        // Handle error appropriately
      }
    }

    fetchNodes()
  }, []) // This effect runs once after the initial render

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
                  <PlaylistAddIcon sx={{ fontSize: 48 }} />
                </IconButton>
              </TableCell>
              <TableCell>Start New Node</TableCell>
              <TableCell></TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                <IconButton type="button" onClick={handleConnect}>
                  <InputOutlinedIcon sx={{ fontSize: 48 }} />
                </IconButton>
              </TableCell>
              <TableCell>Connect to Existing Node</TableCell>
              <TableCell></TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                <IconButton type="button" onClick={handleLoad}>
                  <UploadFileOutlinedIcon sx={{ fontSize: 48 }} />
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
