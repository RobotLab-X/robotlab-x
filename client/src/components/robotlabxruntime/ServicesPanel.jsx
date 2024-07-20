import InputOutlinedIcon from "@mui/icons-material/InputOutlined"
import OpenInBrowserIcon from "@mui/icons-material/OpenInBrowser"
import PlaylistAddOutlinedIcon from "@mui/icons-material/PlaylistAddOutlined"
import SaveIcon from "@mui/icons-material/Save"
import { Box, Grid, IconButton, Typography } from "@mui/material"
import ConfigurationDialog from "components/ConfigurationDialog"
import ConnectDialog from "components/ConnectDialog"
import ServiceDialog from "components/ServiceDialog"
import { useStore } from "store/store"

import SaveLaunchFileDialog from "components/robotlabxruntime/SaveLaunchFileDialog"
import StartLaunchFileDialog from "components/robotlabxruntime/StartLaunchFileDialog"
import { useProcessedMessage } from "hooks/useProcessedMessage"
import React, { useState } from "react"

import useServiceSubscription from "store/useServiceSubscription"

const ServicesPanel = ({ id, fullname, name }) => {
  const { subscribeTo, unsubscribeFrom, useMessage, sendTo } = useStore()
  const [connectDialogOpen, setConnectDialogOpen] = useState(false)
  const [configurationDialogOpen, setConfigurationDialogOpen] = useState(false)
  const [startLaunchFileDialogOpen, setStartLaunchFileDialogOpen] = useState(false)
  const [startExamplesDialogOpen, setStartExamplesDialogOpen] = useState(false)
  const [saveLaunchFileDialogOpen, setSaveLaunchFileDialogOpen] = useState(false)
  const repoMsg = useMessage(fullname, "getRepo")
  const examplesMsg = useMessage(fullname, "getExamples")
  const examples = useProcessedMessage(examplesMsg)
  const launchFilesMsg = useMessage(fullname, "getLaunchFiles")
  const launchFiles = useProcessedMessage(launchFilesMsg)

  const serviceMsg = useServiceSubscription(fullname, ["getRepo", "getLaunchFiles", "getExamples"])
  const service = useProcessedMessage(serviceMsg)
  const repo = useProcessedMessage(repoMsg)

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

  const handleExampleSelect = (exampleName, autolaunch) => {
    console.info(`Selected example: ${exampleName}`)
    // setStartExampleDialogOpen(false)
    // sendTo(fullname, "start", exampleName)
  }

  const handleLaunchFileSelect = (launchName, autolaunch) => {
    console.info(`Selected launch file: ${launchName}`)
    setStartLaunchFileDialogOpen(false)
    sendTo(fullname, "start", launchName)
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
      <ConfigurationDialog
        fullname={fullname}
        open={configurationDialogOpen}
        onClose={() => setConfigurationDialogOpen(false)}
      />
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
