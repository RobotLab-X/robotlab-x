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
      <h3 style={{ display: "flex", alignItems: "center", cursor: "pointer", margin: 0 }} onClick={toggleEditMode}>
        Configuration
        {editMode ? <ExpandLessIcon /> : <ExpandMoreIcon />}
      </h3>
      {editMode ? (
        <Box sx={{ marginTop: 0.5, marginBottom: 0.5 }}>
          <Typography sx={{ fontSize: "0.875rem" }}>Config here, date format, log level, source, etc</Typography>
        </Box>
      ) : null}

      {/* Display log files being read */}
      <Box sx={{ mt: 1, mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: "bold", fontSize: "0.875rem" }}>
          Log Files Being Read:
        </Typography>
        {service?.openLogFiles && (
          <ul style={{ marginBottom: "0.5rem", fontSize: "0.875rem", marginTop: 0 }}>
            {service.openLogFiles.map((file, index) => (
              <li key={index} style={{ marginBottom: "0.25rem" }}>
                {file}
              </li>
            ))}
          </ul>
        )}
      </Box>

      {/* Log Table */}
      <Box sx={{ mt: 1, mb: 1 }}>
        <Typography variant="h6" sx={{ fontSize: "1rem", marginBottom: "0.5rem" }}>
          Logs
        </Typography>
        <Button
          variant="contained"
          onClick={handleRefreshLogs}
          sx={{ mb: 1, fontSize: "0.875rem", padding: "0.25rem 0.5rem" }}
        >
          Refresh Logs
        </Button>
        <TableContainer component={Paper} sx={{ boxShadow: "none", border: "none", margin: 0, padding: 0 }}>
          <Table sx={{ borderCollapse: "collapse", margin: 0, padding: 0 }}>
            <TableHead>
              <TableRow sx={{ borderBottom: "none" }}>
                <TableCell sx={{ borderBottom: "none", fontSize: "0.875rem", padding: "0.5rem" }}>Timestamp</TableCell>
                <TableCell sx={{ borderBottom: "none", fontSize: "0.875rem", padding: "0.5rem" }}>Log Level</TableCell>
                <TableCell sx={{ borderBottom: "none", fontSize: "0.875rem", padding: "0.5rem" }}>Source</TableCell>
                <TableCell sx={{ borderBottom: "none", fontSize: "0.875rem", padding: "0.5rem" }}>Message</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {logBatch &&
                logBatch.map((log, index) => (
                  <TableRow
                    key={index}
                    sx={{
                      backgroundColor: log.level === "error" ? "red" : log.level === "warn" ? "yellow" : "white",
                      fontSize: "0.875rem",
                      "& td, & th": { borderBottom: "none", padding: "0.5rem" },
                      margin: 0,
                      padding: 0
                    }}
                  >
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
