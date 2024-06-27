import CancelIcon from "@mui/icons-material/Cancel"
import MaximizeIcon from "@mui/icons-material/CheckBoxOutlineBlank"
import CloseIcon from "@mui/icons-material/Close"
import MinimizeIcon from "@mui/icons-material/Minimize"
import { AppBar, Box, Grid, IconButton, MenuItem, Paper, Select, Toolbar, Tooltip, Typography } from "@mui/material"
import React, { useEffect, useRef, useState } from "react"
import { useStore } from "../store/store"

const WindowControls = () => {
  return (
    <Box sx={{ display: "flex", alignItems: "center", marginLeft: "auto" }}>
      <IconButton sx={{ color: "black" }}>
        <MinimizeIcon />
      </IconButton>
      <IconButton sx={{ color: "black" }}>
        <MaximizeIcon />
      </IconButton>
      <IconButton sx={{ color: "black" }}>
        <CloseIcon />
      </IconButton>
    </Box>
  )
}

const StatusLog = ({ statusLog, fullname }) => {
  const [filterLevel, setFilterLevel] = useState("all")
  const logEndRef = useRef(null)

  const handleFilterChange = (event) => {
    setFilterLevel(event.target.value)
  }

  const handleClearLog = () => {
    useStore.getState().clearStatusList(fullname)
  }

  const filteredLog = filterLevel === "all" ? statusLog : statusLog.filter((status) => status.level === filterLevel)

  const scrollToBottom = () => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [filteredLog])

  return (
    <Paper sx={{ width: "100%", border: "1px solid #ccc", borderRadius: "8px", overflow: "hidden" }}>
      <AppBar position="static" sx={{ backgroundColor: "#f5f5f5", boxShadow: "none", height: "40px" }}>
        <Toolbar
          sx={{
            minHeight: "40px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingLeft: 2,
            paddingRight: 2
          }}
        >
          <Typography variant="h6" sx={{ color: "black" }}>
            Status Log &nbsp;
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center" }}>
            <Select
              value={filterLevel}
              onChange={handleFilterChange}
              label="Filter"
              displayEmpty
              inputProps={{ "aria-label": "Filter Log Levels" }}
              sx={{
                color: "black",
                borderColor: "black",
                minWidth: 120,
                height: "32px",
                alignItems: "center",
                display: "flex"
              }}
            >
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="info">Info</MenuItem>
              <MenuItem value="warn">Warn</MenuItem>
              <MenuItem value="error">Error</MenuItem>
            </Select>
            <Tooltip title="Clear Logs">
              <IconButton
                edge="end"
                onClick={handleClearLog}
                sx={{ color: "black", height: "32px", alignItems: "center", display: "flex" }}
              >
                <CancelIcon />
              </IconButton>
            </Tooltip>
          </Box>
          <WindowControls />
        </Toolbar>
      </AppBar>
      <Box sx={{ padding: 2, maxHeight: "400px", overflowY: "auto" }}>
        <Grid container>
          <Grid item xs={12}>
            <div style={{ padding: "16px", maxWidth: "100%" }}>
              {filteredLog.map((status, index) => {
                let style = {}
                if (status.level === "info") {
                  style = { color: "green" }
                } else if (status.level === "warn") {
                  style = { color: "orange" }
                } else if (status.level === "error") {
                  style = { color: "red" }
                }

                return (
                  <div
                    key={index}
                    style={{ display: "flex", alignItems: "baseline", fontFamily: "monospace", width: "100%" }}
                  >
                    <small style={{ ...style, marginRight: "0.5rem" }}>{status.level}</small>
                    <span
                      style={{ margin: 0, whiteSpace: "pre-wrap", wordWrap: "break-word", flex: 1 }}
                      dangerouslySetInnerHTML={{ __html: status.detail }}
                    />
                  </div>
                )
              })}
              <div ref={logEndRef} />
            </div>
          </Grid>
        </Grid>
      </Box>
    </Paper>
  )
}

export default StatusLog
