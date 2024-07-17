import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined"
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined"
import NotificationsOutlinedIcon from "@mui/icons-material/NotificationsOutlined"
import PersonOutlinedIcon from "@mui/icons-material/PersonOutlined"
import StatusList from "../../components/StatusList"

import SearchIcon from "@mui/icons-material/Search"
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined"
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  TextField,
  Typography,
  useTheme
} from "@mui/material"
import { useProcessedMessage } from "hooks/useProcessedMessage"
import React, { useContext, useState } from "react"
import { useStore } from "store/store"
import useServiceSubscription from "store/useServiceSubscription"
import { ColorModeContext, tokens } from "../../theme"

const Topbar = () => {
  const theme = useTheme()
  const colors = tokens(theme.palette.mode)
  const colorMode = useContext(ColorModeContext)
  const [filter, setFilter] = useState("")
  const remoteId = useStore((state) => state.defaultRemoteId)
  const debug = useStore((state) => state.debug)
  const setDebug = useStore((state) => state.setDebug)
  const sendTo = useStore((state) => state.sendTo)

  const serviceMsg = useServiceSubscription(`runtime@${remoteId}`)
  const service = useProcessedMessage(serviceMsg)

  const [dialogOpen, setDialogOpen] = useState(false)

  const statusListStyle = {
    position: "absolute",
    bottom: 160,
    marginBottom: "16px",
    width: "100%"
  }

  const handleDialogOpen = () => {
    setDialogOpen(true)
  }

  const handleDialogClose = () => {
    setDialogOpen(false)
  }

  const handleCheckboxChange = (event) => {
    setDebug(event.target.checked)
    sendTo("runtime", "setDebug", event.target.checked)
  }

  const host = (service && Object.values(service?.hosts)[0]) || {}

  return (
    <Box display="flex" justifyContent="space-between" alignItems="center" p={2}>
      <Box display="flex" flexGrow={1} alignItems="center">
        <Box width={280} mr={2}>
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
        </Box>
        <Typography variant="h4" component="span">
          {remoteId} {host?.platform} {service?.pkg?.version}
        </Typography>
      </Box>

      <Box display="flex" alignItems="center">
        <IconButton onClick={colorMode.toggleColorMode}>
          {theme?.palette?.mode === "dark" ? <DarkModeOutlinedIcon /> : <LightModeOutlinedIcon />}
        </IconButton>
        <IconButton>
          <NotificationsOutlinedIcon />
        </IconButton>
        <IconButton onClick={handleDialogOpen}>
          <SettingsOutlinedIcon />
        </IconButton>
        <IconButton>
          <PersonOutlinedIcon />
        </IconButton>
      </Box>

      <Dialog open={dialogOpen} onClose={handleDialogClose}>
        <DialogTitle>Settings</DialogTitle>
        <DialogContent>
          <FormControlLabel
            control={<Checkbox checked={debug} onChange={handleCheckboxChange} name="debug" />}
            label="Debug"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDialogClose} color="primary">
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {debug && (
        <>
          {" "}
          <br />
          <Box sx={statusListStyle}>
            <StatusList />
          </Box>
        </>
      )}
    </Box>
  )
}

export default Topbar
