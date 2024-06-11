import ClearIcon from "@mui/icons-material/Clear"
import { AppBar, Box, Grid, IconButton, MenuItem, Select, Toolbar, Typography } from "@mui/material"
import React, { useState } from "react"

const StatusLog = ({ statusLog, handleClearLog }) => {
  const [filterLevel, setFilterLevel] = useState("all")

  const handleFilterChange = (event) => {
    setFilterLevel(event.target.value)
  }

  const filteredLog = filterLevel === "all" ? statusLog : statusLog.filter((status) => status.level === filterLevel)

  return (
    <Box sx={{ width: "100%" }}>
      <AppBar position="static" sx={{ backgroundColor: "rgba(255, 255, 255, 0.8)", boxShadow: "none", height: "48px" }}>
        <Toolbar sx={{ minHeight: "48px" }}>
          <Typography variant="h6" sx={{ flexGrow: 1, color: "black" }}>
            Status Log
          </Typography>
          <Select
            value={filterLevel}
            onChange={handleFilterChange}
            displayEmpty
            inputProps={{ "aria-label": "Filter Log Levels" }}
            sx={{ marginRight: 2, color: "black", borderColor: "black", minWidth: 120 }}
          >
            <MenuItem value="all">All</MenuItem>
            <MenuItem value="info">Info</MenuItem>
            <MenuItem value="warn">Warn</MenuItem>
            <MenuItem value="error">Error</MenuItem>
          </Select>
          <IconButton edge="end" onClick={handleClearLog} sx={{ color: "black" }}>
            <ClearIcon />
          </IconButton>
        </Toolbar>
      </AppBar>
      <Grid container sx={{ marginTop: 2 }}>
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
          </div>
        </Grid>
      </Grid>
    </Box>
  )
}

export default StatusLog
