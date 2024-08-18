import AddIcon from "@mui/icons-material/Add"
import InputOutlinedIcon from "@mui/icons-material/InputOutlined"
import OpenInBrowserIcon from "@mui/icons-material/OpenInBrowser"
import SaveIcon from "@mui/icons-material/Save"
import { Box, Grid, IconButton, Typography } from "@mui/material"
import ConnectDialog from "components/ConnectDialog"
import ServiceDialog from "components/ServiceDialog"
import { useStore } from "store/store"

import SaveLaunchFileDialog from "components/robotlabxruntime/SaveLaunchFileDialog"
import StartLaunchFileDialog from "components/robotlabxruntime/StartLaunchFileDialog"
import React, { useState } from "react"

import useSubscription from "store/useSubscription"

const ServicesPanel = ({ id, fullname, name }) => {
  console.info(`ServicesPanel ${fullname}`)
  const { sendTo } = useStore()
  const [connectDialogOpen, setConnectDialogOpen] = useState(false)
  const [startLaunchFileDialogOpen, setStartLaunchFileDialogOpen] = useState(false)
  const [startExamplesDialogOpen, setStartExamplesDialogOpen] = useState(false)
  const [saveLaunchFileDialogOpen, setSaveLaunchFileDialogOpen] = useState(false)

  const service = useSubscription(fullname, "broadcastState", true)
  const repo = useSubscription(fullname, "getRepo", true)
  const launchFiles = useSubscription(fullname, "getLaunchFiles", true)
  const examples = useSubscription(fullname, "getExamples", true)

  const [open, setOpen] = useState(false)

  const handleStartNewService = () => {
    console.info("Starting new node...")
    setOpen(true)
  }
  const handleStartExample = () => {
    console.info("Starting example...")
    sendTo(fullname, "getExamples")
    setStartExamplesDialogOpen(true)
  }

  const handleStartLaunchFile = () => {
    console.info("handleStartLaunchFile...")
    sendTo(fullname, "getLaunchFiles")
    setStartLaunchFileDialogOpen(true)
  }

  const handleSaveLaunchFile = () => {
    console.info("handleSaveLaunchFile...")
    setSaveLaunchFileDialogOpen(true)
  }

  const handleSave = (filename, autolaunch) => {
    console.info(`Saving launch file as: ${filename}`)
    setSaveLaunchFileDialogOpen(false)
    if (autolaunch) {
      sendTo(fullname, "applyConfigValue", "autoLaunch", filename)
    }
    sendTo(fullname, "saveAll", filename)
  }

  return (
    <>
      <Grid container justifyContent="flex-start">
        <Grid item>
          <Box>
            <Grid container alignItems="center">
              <Grid item>
                <IconButton onClick={handleStartNewService}>
                  <AddIcon />
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
            <Grid container alignItems="center">
              <Grid item>
                <IconButton onClick={handleStartExample}>
                  <OpenInBrowserIcon />
                </IconButton>
              </Grid>
              <Grid item>
                <Typography>Start an example</Typography>
              </Grid>
            </Grid>
          </Box>
        </Grid>
      </Grid>
      <ConnectDialog
        id={id}
        loopbackPort={service?.config?.port}
        open={connectDialogOpen}
        onClose={() => setConnectDialogOpen(false)}
      />
      {repo && <ServiceDialog packages={repo} fullname={fullname} open={open} setOpen={setOpen} />}

      <StartLaunchFileDialog
        fullname={fullname}
        open={startExamplesDialogOpen}
        onClose={() => setStartExamplesDialogOpen(false)}
        launchFiles={examples}
        isExampleFile={true}
      />
      <StartLaunchFileDialog
        fullname={fullname}
        open={startLaunchFileDialogOpen}
        onClose={() => setStartLaunchFileDialogOpen(false)}
        launchFiles={launchFiles}
        isExampleFile={false}
      />
      <SaveLaunchFileDialog
        open={saveLaunchFileDialogOpen}
        onClose={() => setSaveLaunchFileDialogOpen(false)}
        onSave={handleSave}
      />
    </>
  )
}

export default ServicesPanel
