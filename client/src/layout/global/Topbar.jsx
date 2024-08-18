import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined"
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined"
import NotificationsOutlinedIcon from "@mui/icons-material/NotificationsOutlined"
import PowerSettingsNewIcon from "@mui/icons-material/PowerSettingsNew"
import SearchIcon from "@mui/icons-material/Search"
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined"
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  TextField,
  Typography,
  useTheme
} from "@mui/material"
import InputAdornment from "@mui/material/InputAdornment"
import React, { useContext, useEffect, useState } from "react"
import { useStore } from "store/store"
import { ColorModeContext } from "../../theme"

const Topbar = () => {
  const [versions, setVersions] = useState({ appVersion: "", chrome: "", node: "", electron: "" })
  const [filter, setFilter] = useState("")
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const [shutdownDialogOpen, setShutdownDialogOpen] = useState(false)

  const theme = useTheme()
  const colorMode = useContext(ColorModeContext)
  const remoteId = useStore((state) => state.defaultRemoteId)
  const sendTo = useStore((state) => state.sendTo)

  useEffect(() => {
    const versionInfo = window?.electron?.getVersions()
    setVersions(versionInfo)
  }, [])

  const handleShutdown = () => {
    setShutdownDialogOpen(false)
    console.log("Shutdown initiated")
  }

  const handleRestart = () => {
    setShutdownDialogOpen(false)
    sendTo("runtime", "restart")
  }

  return (
    <Box display="flex" justifyContent="space-between" alignItems="center" p={2}>
      <Box display="flex" flexGrow={1} alignItems="center">
        <TextField
          fullWidth
          variant="outlined"
          placeholder="Search..."
          onChange={(e) => setFilter(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            )
          }}
        />
        <Typography variant="h4" component="span" ml={2}>
          {remoteId}
        </Typography>
      </Box>

      <Box display="flex" alignItems="center">
        <IconButton onClick={colorMode.toggleColorMode}>
          {theme.palette.mode === "dark" ? <DarkModeOutlinedIcon /> : <LightModeOutlinedIcon />}
        </IconButton>
        <IconButton>
          <NotificationsOutlinedIcon />
        </IconButton>
        <IconButton onClick={() => setSettingsDialogOpen(true)}>
          <SettingsOutlinedIcon />
        </IconButton>
        <IconButton onClick={() => setShutdownDialogOpen(true)}>
          <PowerSettingsNewIcon />
        </IconButton>
      </Box>

      <Dialog open={settingsDialogOpen} onClose={() => setSettingsDialogOpen(false)}>
        <DialogTitle>Settings</DialogTitle>
        <DialogContent>
          <Typography>App version: {versions?.appVersion}</Typography>
          <Typography>Chrome version: {versions?.chrome}</Typography>
          <Typography>Node.js version: {versions?.node}</Typography>
          <Typography>Electron version: {versions?.electron}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsDialogOpen(false)} color="primary">
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={shutdownDialogOpen} onClose={() => setShutdownDialogOpen(false)}>
        <DialogTitle>Shutdown or Restart</DialogTitle>
        <DialogContent>
          <DialogContentText>Do you want to shutdown or restart the system?</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleShutdown} color="error">
            Shutdown
          </Button>
          <Button onClick={handleRestart} color="primary">
            Restart
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default Topbar
