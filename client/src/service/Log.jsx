import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import RefreshIcon from "@mui/icons-material/Refresh"
import {
  Box,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Typography
} from "@mui/material"
import React, { useState } from "react"
import { useStore } from "store/store"
import useSubscription from "store/useSubscription"

// FIXME remove fullname with context provider
export default function Log({ fullname }) {
  console.info(`Log ${fullname}`)

  const [editMode, setEditMode] = useState(false)
  const [logLevel, setLogLevel] = useState("debug")
  const [sortOrder, setSortOrder] = useState("asc")
  const { sendTo } = useStore()

  const service = useSubscription(fullname, "broadcastState", true)
  const logBatch = useSubscription(fullname, "publishLogs", true)

  const toggleEditMode = () => {
    setEditMode(!editMode)
  }

  const handleRefreshLogs = () => {
    sendTo(fullname, "refreshLogs")
  }

  const handleLogLevelChange = (event) => {
    setLogLevel(event.target.value)
  }

  const handleSortChange = () => {
    setSortOrder((prevOrder) => (prevOrder === "asc" ? "desc" : "asc"))
  }

  // Determine which logs to show based on the selected log level
  const filteredLogs = logBatch
    ? logBatch.filter((log) => {
        if (logLevel === "debug") return true
        if (logLevel === "info") return log.level === "info" || log.level === "warn" || log.level === "error"
        if (logLevel === "warn") return log.level === "warn" || log.level === "error"
        if (logLevel === "error") return log.level === "error"
        return false
      })
    : []

  // Sort the filtered logs based on timestamp and sortOrder
  const sortedLogs = filteredLogs.sort((a, b) => {
    return sortOrder === "asc" ? a.ts - b.ts : b.ts - a.ts
  })

  return (
    <>
      <h3 style={{ display: "flex", alignItems: "center", cursor: "pointer", margin: 0 }} onClick={toggleEditMode}>
        Configuration
        {editMode ? <ExpandLessIcon /> : <ExpandMoreIcon />}
      </h3>
      {editMode ? (
        <Box sx={{ mt: 0.25, mb: 0.25 }}>
          <Typography sx={{ fontSize: "0.75rem", margin: 0 }}>
            Config here, date format, log level, source, etc
          </Typography>
        </Box>
      ) : null}

      {/* Display log files being read */}
      <Box sx={{ mt: 0.25, mb: 0.25 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: "bold", fontSize: "0.75rem", margin: 0 }}>
          Log Files Being Read:
        </Typography>
        {service?.openLogFiles && (
          <ul style={{ marginBottom: "0.25rem", fontSize: "0.75rem", marginTop: 0, paddingLeft: "1rem" }}>
            {service.openLogFiles.map((file, index) => (
              <li key={index} style={{ marginBottom: "0.1rem" }}>
                {file}
              </li>
            ))}
          </ul>
        )}
      </Box>

      {/* Log controls: Filter and Refresh */}
      <Box sx={{ display: "flex", alignItems: "center", mt: 0.5, mb: 0.5 }}>
        <FormControl sx={{ minWidth: 100, marginRight: 1 }}>
          <InputLabel sx={{ fontSize: "0.75rem" }}>Log Level</InputLabel>
          <Select value={logLevel} onChange={handleLogLevelChange} sx={{ fontSize: "0.75rem", height: "2rem" }}>
            <MenuItem value="debug">Debug</MenuItem>
            <MenuItem value="info">Info</MenuItem>
            <MenuItem value="warn">Warn</MenuItem>
            <MenuItem value="error">Error</MenuItem>
          </Select>
        </FormControl>
        <IconButton onClick={handleRefreshLogs} size="small">
          <RefreshIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Log Table */}
      <Box sx={{ mt: 0.25, mb: 0.25 }}>
        <TableContainer component={Paper} sx={{ boxShadow: "none", border: "none", margin: 0, padding: 0 }}>
          <Table sx={{ borderCollapse: "collapse", margin: 0, padding: 0 }}>
            <TableHead>
              <TableRow sx={{ borderBottom: "none", height: "1rem" }}>
                <TableCell sx={{ borderBottom: "none", fontSize: "0.75rem", padding: "0.1rem" }}>
                  <TableSortLabel
                    active
                    direction={sortOrder}
                    onClick={handleSortChange}
                    sx={{ fontSize: "0.75rem", padding: "0.1rem" }}
                  >
                    Timestamp
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ borderBottom: "none", fontSize: "0.75rem", padding: "0.1rem" }}>Log Level</TableCell>
                <TableCell sx={{ borderBottom: "none", fontSize: "0.75rem", padding: "0.1rem" }}>Source</TableCell>
                <TableCell sx={{ borderBottom: "none", fontSize: "0.75rem", padding: "0.1rem" }}>Message</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {logBatch &&
                logBatch.map((log, index) => (
                  <TableRow
                    key={index}
                    sx={{
                      backgroundColor: log.level === "error" ? "red" : log.level === "warn" ? "yellow" : "white",
                      fontSize: "0.75rem",
                      "& td, & th": { borderBottom: "none", padding: "0.1rem" },
                      margin: 0,
                      padding: 0,
                      height: "1rem"
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
