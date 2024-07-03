import InputOutlinedIcon from "@mui/icons-material/InputOutlined"
import OpenInBrowserIcon from "@mui/icons-material/OpenInBrowser"
import PlaylistAddOutlinedIcon from "@mui/icons-material/PlaylistAddOutlined"
import SaveIcon from "@mui/icons-material/Save"
import { Box, Grid, IconButton, Typography } from "@mui/material"
import React from "react"

const ServicesPanel = ({
  iconSize,
  handleStartNewService,
  setConnectDialogOpen,
  handleSaveLaunchFile,
  handleStartLaunchFile
}) => {
  return (
    <Grid container justifyContent="flex-start">
      <Grid item>
        <Box>
          <Grid container alignItems="center">
            <Grid item>
              <IconButton onClick={handleStartNewService}>
                <PlaylistAddOutlinedIcon />
              </IconButton>
            </Grid>
            <Grid item>
              <Typography>Add a new service</Typography>
            </Grid>
          </Grid>
          <Grid container alignItems="center">
            <Grid item>
              <IconButton onClick={() => setConnectDialogOpen(true)}>
                <InputOutlinedIcon />
              </IconButton>
            </Grid>
            <Grid item>
              <Typography>Connect to a running service</Typography>
            </Grid>
          </Grid>
          <Grid container alignItems="center">
            <Grid item>
              <IconButton onClick={handleSaveLaunchFile}>
                <SaveIcon />
              </IconButton>
            </Grid>
            <Grid item>
              <Typography>Save a launch file</Typography>
            </Grid>
          </Grid>
          <Grid container alignItems="center">
            <Grid item>
              <IconButton onClick={handleStartLaunchFile}>
                <OpenInBrowserIcon />
              </IconButton>
            </Grid>
            <Grid item>
              <Typography>Start a launch file</Typography>
            </Grid>
          </Grid>
        </Box>
      </Grid>
    </Grid>
  )
}

export default ServicesPanel
