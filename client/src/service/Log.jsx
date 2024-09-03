import ClearIcon from "@mui/icons-material/Clear"
import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import PauseIcon from "@mui/icons-material/Pause"
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
  Typography
} from "@mui/material"
import React, { useEffect, useMemo, useState } from "react"
import { useStore } from "store/store"
import useSubscription from "store/useSubscription"

export default function Log({ fullname }) {
  console.info(`Log ${fullname}`)

  const [editMode, setEditMode] = useState(false)
  const [logLevel, setLogLevel] = useState("debug")
  const [isPaused, setIsPaused] = useState(false) // State to manage pause

  // Access Zustand store methods and state
  const { sendTo, logs, addLogs, clearLogs, setLogs, trimLogs } = useStore()

  const service = useSubscription(fullname, "broadcastState", true)
  const logBatch = useSubscription(fullname, "publishLogs")

  // console.log("Current logs:", logs) // Debugging output

  // Initialize Zustand store with the unifiedLog from the service only if the store is empty
  useEffect(() => {
    if (service?.unifiedLog && logs.length === 0) {
      console.log("Initializing logs with unifiedLog:", service.unifiedLog) // Debugging output
      setLogs(service.unifiedLog)
    }
  }, [service, logs.length, setLogs])

  // Merge new log batches with the existing Zustand logs state, only if not paused
  useEffect(() => {
    console.log("In useEffect logBatch:", logBatch) // Debugging output
    if (!isPaused && logBatch && logBatch.length > 0) {
      console.log("Adding new logs:", logBatch) // Debugging output
      addLogs(logBatch)
      trimLogs() // Ensure logs do not exceed 500 entries
    }
  }, [logBatch, addLogs, trimLogs, isPaused])

  const toggleEditMode = () => {
    setEditMode(!editMode)
  }

  const togglePause = () => {
    setIsPaused(!isPaused)
  }

  const handleRefreshLogs = () => {
    sendTo(fullname, "refreshLogs")
  }

  const handleClearLogs = () => {
    clearLogs()
    // sendTo(fullname, "clearLogs")
  }

  const handleLogLevelChange = (event) => {
    setLogLevel(event.target.value)
  }

  // Memoize filtered logs to avoid unnecessary re-renders and duplicates
  const filteredLogs = useMemo(() => {
    if (!logs) return []

    const levelOrder = ["debug", "info", "warn", "error"]
    const selectedLevelIndex = levelOrder.indexOf(logLevel)

    // Filter logs based on selected level
    return logs.filter((log) => {
      const logLevelIndex = levelOrder.indexOf(log.level)
      return logLevelIndex >= selectedLevelIndex
    })
  }, [logs, logLevel])

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
      <Box sx={{ mt: 0.25, mb: 1.25 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: "bold", fontSize: "0.75rem", margin: 0 }}>
          Log Files:
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

      {/* Log controls: Filter, Refresh, Pause */}
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
        <IconButton onClick={handleClearLogs} size="small">
          <ClearIcon fontSize="small" />
        </IconButton>
        <IconButton onClick={togglePause} size="small">
          <PauseIcon fontSize="small" color={isPaused ? "secondary" : "inherit"} />
        </IconButton>
      </Box>

      {/* Log Table */}
      <Box sx={{ mt: 0.25, mb: 0.25 }}>
        <TableContainer
          component={Paper}
          sx={{ boxShadow: "none", border: "none", margin: 0, padding: 0, maxWidth: "800px" }}
        >
          <Table sx={{ borderCollapse: "collapse", margin: 0, padding: 0, width: "100%" }}>
            <TableHead>
              <TableRow sx={{ borderBottom: "none", height: "1rem" }}>
                <TableCell sx={{ borderBottom: "none", fontSize: "0.75rem", padding: "0.1rem" }}>id</TableCell>
                <TableCell sx={{ borderBottom: "none", fontSize: "0.75rem", padding: "0.1rem" }}>Timestamp</TableCell>
                <TableCell sx={{ borderBottom: "none", fontSize: "0.75rem", padding: "0.1rem" }}>Log Level</TableCell>
                <TableCell sx={{ borderBottom: "none", fontSize: "0.75rem", padding: "0.1rem" }}>Source</TableCell>
                <TableCell
                  sx={{
                    borderBottom: "none",
                    fontSize: "0.75rem",
                    padding: "0.1rem",
                    maxWidth: "800px", // Set maximum width
                    overflowWrap: "break-word", // Allow wrapping
                    wordBreak: "break-word" // Break long words
                  }}
                >
                  Message
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredLogs.map((log, index) => (
                <TableRow key={index}>
                  <TableCell>{log.id}</TableCell>
                  <TableCell>{log.ts}</TableCell>
                  <TableCell
                    sx={{
                      color: log.level === "error" ? "red" : log.level === "warn" ? "orange" : "", // Color based on log level
                      textAlign: "center", // Center text horizontally
                      padding: "0.1rem",
                      height: "1rem"
                    }}
                  >
                    {log.level}
                  </TableCell>
                  <TableCell>{log.module}</TableCell>
                  <TableCell
                    sx={{
                      maxWidth: "1200px", // Set maximum width for the message
                      overflowWrap: "break-word", // Allow wrapping
                      wordBreak: "break-word" // Break long words
                    }}
                  >
                    {log.msg}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    </>
  )
}
