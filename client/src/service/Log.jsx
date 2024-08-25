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
import React, { useState } from "react"
import { useStore } from "store/store"
import useSubscription from "store/useSubscription"

// FIXME remove fullname with context provider
export default function Log({ fullname }) {
  console.info(`Log ${fullname}`)

  const [editMode, setEditMode] = useState(false)
  const { sendTo } = useStore()

  const service = useSubscription(fullname, "broadcastState", true)
  const logBatch = useSubscription(fullname, "publishLogs", true)

  const toggleEditMode = () => {
    setEditMode(!editMode)
  }

  const handleRefreshLogs = () => {
    sendTo(fullname, "refreshLogs")
  }

  // FIXME put all Configuration in a Component
  // can handle any config field change if the edit name matches the config name
  const handleConfigChange = (event) => {
    const { name, value, type } = event.target
    const newValue = type === "number" ? Number(value) : value
  }

  const handleSaveConfig = () => {
    // sendTo(fullname, "applyConfig", config)
    // sendTo(fullname, "saveConfig")
    // sendTo(fullname, "broadcastState")
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
                    <TableCell>{log.ts}</TableCell>
                    <TableCell>{log.level}</TableCell>
                    <TableCell>{log.module}</TableCell>
                    <TableCell>{log.msg}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    </>
  )
}
