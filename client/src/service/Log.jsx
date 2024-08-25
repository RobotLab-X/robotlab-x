import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import {
  Box,
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography
} from "@mui/material"
import React, { useEffect, useState } from "react"
import { useLogStore, useStore } from "store/store"
import useSubscription from "store/useSubscription"

// FIXME remove fullname with context provider
export default function Log({ fullname }) {
  console.info(`Log ${fullname}`)

  const [editMode, setEditMode] = useState(false)
  const { sendTo } = useStore()

  const service = useSubscription(fullname, "broadcastState", true)
  const logBatch = useSubscription(fullname, "publishLogs", true)

  const addLogs = useLogStore((state) => state.addLogs) // Get the addLogs action

  const toggleEditMode = () => {
    setEditMode(!editMode)
  }

  const handleRefreshLogs = () => {
    sendTo(fullname, "refreshLogs")
  }

  // Use useEffect to handle changes in logBatch
  useEffect(() => {
    if (logBatch && logBatch.length > 0) {
      addLogs(logBatch) // Add new logs to the Zustand store
    }
  }, [logBatch, addLogs]) // Dependencies include logBatch and addLogs

  // FIXME put all Configuration in a Component
  const handleConfigChange = (event) => {
    const { name, value, type } = event.target
    const newValue = type === "number" ? Number(value) : value
  }

  const handleSaveConfig = () => {
    setEditMode(false)
  }

  return (
    <>
      <h3 style={{ display: "flex", alignItems: "center", cursor: "pointer" }} onClick={toggleEditMode}>
        Configuration
        {editMode ? <ExpandLessIcon /> : <ExpandMoreIcon />}
      </h3>
      {editMode ? (
        <Box>
          <Typography>Config here, date format, log level, source, etc</Typography>
        </Box>
      ) : null}

      {/* Log Table */}
      <Box mt={2}>
        <Typography variant="h6">Logs</Typography>
        <Button variant="contained" onClick={handleRefreshLogs} style={{ marginBottom: "1rem" }}>
          Refresh Logs
        </Button>
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Timestamp</TableCell>
                <TableCell>Log Level</TableCell>
                <TableCell>Source</TableCell>
                <TableCell>Message</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {logBatch &&
                logBatch.map((log, index) => (
                  <TableRow key={index}>
                    <TableCell>{log.timestamp}</TableCell>
                    <TableCell>{log.level}</TableCell>
                    <TableCell>{log.source}</TableCell>
                    <TableCell>{log.message}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    </>
  )
}
