import CancelIcon from "@mui/icons-material/Cancel"
import MaximizeIcon from "@mui/icons-material/CheckBoxOutlineBlank"
import CloseIcon from "@mui/icons-material/Close"
import DragIndicatorIcon from "@mui/icons-material/DragIndicator"
import FilterListIcon from "@mui/icons-material/FilterList"
import MinimizeIcon from "@mui/icons-material/Minimize"
import PauseIcon from "@mui/icons-material/Pause"
import { AppBar, Box, Grid, IconButton, MenuItem, Select, Toolbar, Tooltip, Typography } from "@mui/material"
import React, { useEffect, useRef, useState } from "react"
import { Rnd } from "react-rnd"
import { useStore } from "../store/store"

const WindowControls = () => {
  return (
    <Box sx={{ display: "flex", alignItems: "right", marginLeft: "auto" }}>
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

const StatusList = () => {
  const statusList = useStore((state) => state.statusList)

  const [filterLevel, setFilterLevel] = useState("all")
  const [isPaused, setIsPaused] = useState(false)
  const logEndRef = useRef(null)

  const handleFilterChange = (event) => {
    setFilterLevel(event.target.value)
  }

  const handleClearLog = () => {
    useStore.getState().clearStatusList()
  }

  const handlePauseToggle = () => {
    setIsPaused((prev) => !prev)
  }

  const logLevels = ["all", "info", "warn", "error"]
  const filteredLog =
    filterLevel === "all"
      ? statusList
      : statusList.filter((status) => logLevels.indexOf(status.level) >= logLevels.indexOf(filterLevel))

  const scrollToBottom = () => {
    if (!isPaused) {
      logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
    }
  }

  useEffect(() => {
    scrollToBottom()
  }, [filteredLog, isPaused])

  return (
    <Rnd
      default={{
        x: 100,
        y: 100,
        width: 800,
        height: 400
      }}
      bounds="window"
      enableResizing={{
        bottom: true,
        bottomRight: true,
        bottomLeft: true,
        right: true,
        left: true
      }}
      dragHandleClassName="drag-handle"
      style={{ zIndex: 1000, position: "fixed" }} // Ensure the Rnd component has fixed positioning
    >
      <AppBar position="static" sx={{ backgroundColor: "#f5f5f5", boxShadow: "none", height: "40px" }}>
        <Toolbar
          sx={{
            minHeight: "40px",
            display: "flex",
            justifyContent: "space-between",
            paddingBottom: 3
          }}
        >
          <Box sx={{ display: "flex" }}>
            <DragIndicatorIcon className="drag-handle" sx={{ cursor: "grab", marginRight: 1, color: "black" }} />
            <Typography variant="h6" sx={{ color: "black" }}>
              Status Log
            </Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", marginLeft: 2 }}>
            <Select
              value={filterLevel}
              onChange={handleFilterChange}
              displayEmpty
              inputProps={{ "aria-label": "Filter Log Levels" }}
              IconComponent={FilterListIcon}
              sx={{
                color: "black",
                minWidth: 120,
                height: "32px"
              }}
            >
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="info">Info</MenuItem>
              <MenuItem value="warn">Warn</MenuItem>
              <MenuItem value="error">Error</MenuItem>
            </Select>
            <Tooltip title="Clear Logs">
              <IconButton edge="end" onClick={handleClearLog} sx={{ color: "black", height: "32px" }}>
                <CancelIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title={isPaused ? "Resume Logs" : "Pause Logs"}>
              <IconButton edge="end" onClick={handlePauseToggle} sx={{ color: "black", height: "32px" }}>
                <PauseIcon />
              </IconButton>
            </Tooltip>
          </Box>
          <WindowControls />
        </Toolbar>
      </AppBar>
      <Box sx={{ padding: 2, maxHeight: "calc(100% - 40px)", overflowY: "auto", overflowX: "auto" }}>
        <Grid container>
          <Grid item xs={12}>
            <Box sx={{ minWidth: "600px" }}>
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
                    <small style={{ marginRight: "0.3rem" }}>
                      {status.name}
                      <span style={{ color: "grey" }}>@{status.id} </span>
                      <span
                        style={{ margin: 0, whiteSpace: "pre-wrap", wordWrap: "break-word", flex: 1 }}
                        dangerouslySetInnerHTML={{ __html: status.detail }}
                      />
                    </small>
                  </div>
                )
              })}
              <div ref={logEndRef} />
            </Box>
          </Grid>
        </Grid>
      </Box>
    </Rnd>
  )
}

export default StatusList
