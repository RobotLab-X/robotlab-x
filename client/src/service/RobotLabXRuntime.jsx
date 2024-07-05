import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined"
import { IconButton, Paper, Tab, Table, TableBody, TableCell, TableRow, Tabs, Typography } from "@mui/material"
import ConfigurationDialog from "components/ConfigurationDialog"
import ConnectDialog from "components/ConnectDialog"
import ServiceDialog from "components/ServiceDialog"
import ConnectionsPanel from "components/robotlabxruntime/ConnectionsPanel"
import HostsPanel from "components/robotlabxruntime/HostsPanel"
import MessageLog from "components/robotlabxruntime/MessageLog"
import ProcessesPanel from "components/robotlabxruntime/ProcessesPanel"
import SaveLaunchFileDialog from "components/robotlabxruntime/SaveLaunchFileDialog"
import ServicesPanel from "components/robotlabxruntime/ServicesPanel"
import StartLaunchFileDialog from "components/robotlabxruntime/StartLaunchFileDialog"
import { TabPanel } from "components/robotlabxruntime/TabPanel"
import { useProcessedMessage } from "hooks/useProcessedMessage"
import React, { useEffect, useState } from "react"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

export default function RobotLabXRuntime({ name, fullname, id }) {
  console.info(`RobotLabXRuntime ${fullname}`)

  const { subscribeTo, unsubscribeFrom, useMessage, sendTo } = useStore()
  const iconSize = 32
  const registry = useStore((state) => state.registry)
  const getBaseUrl = useStore((state) => state.getBaseUrl)
  const [messageLog, setMessageLog] = useState([])

  const newServiceMsg = useMessage(fullname, "registered")
  const repoMsg = useMessage(fullname, "getRepo")
  const launchFilesMsg = useMessage(fullname, "getLaunchFiles")

  const serviceMsg = useServiceSubscription(fullname, ["getRepo", "getLaunchFiles"])
  const service = useProcessedMessage(serviceMsg)
  const repo = useProcessedMessage(repoMsg)
  const launchFiles = useProcessedMessage(launchFilesMsg)

  const imagesUrl = `${getBaseUrl()}/images`

  const [open, setOpen] = useState(false)
  const debug = useStore((state) => state.debug)

  const [activeTab, setActiveTab] = useState(0)
  const [connectDialogOpen, setConnectDialogOpen] = useState(false)
  const [configurationDialogOpen, setConfigurationDialogOpen] = useState(false)
  const [startLaunchFileDialogOpen, setStartLaunchFileDialogOpen] = useState(false)
  const [saveLaunchFileDialogOpen, setSaveLaunchFileDialogOpen] = useState(false)
  const [editMode, setEditMode] = useState(false)
  let addresses = []

  const hostArray = service?.hosts ? Object.values(service.hosts) : []
  const processArray = service?.processes ? Object.values(service.processes) : []
  const connectionArray = service?.connections ? Object.values(service.connections) : []
  const routeTableArray = service?.routeTable ? Object.values(service.routeTable) : []
  const host = service?.hosts ? service.hosts[service.hostname] : null
  const displayMemory = host?.totalMemory != null ? Math.round(host.totalMemory / 1073741824) : "N/A"
  const displayFreeMemory = host?.freeMemory != null ? Math.round(host.freeMemory / 1073741824) : "N/A"

  const handleHostClick = (card) => {
    console.info("Card clicked", card)
  }

  const toggleEditMode = () => {
    setEditMode(!editMode)
  }

  const handleChange = (event, newValue) => {
    setActiveTab(newValue)
  }

  const handleStartNewService = () => {
    console.info("Starting new node...")
    setOpen(true)
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

  const handleLaunchFileSelect = (launchName) => {
    console.info(`Selected launch file: ${launchName}`)
    setStartLaunchFileDialogOpen(false)
    sendTo(fullname, "start", launchName)
  }

  const handleSave = (filename) => {
    console.info(`Saving launch file as: ${filename}`)
    setSaveLaunchFileDialogOpen(false)
    sendTo(fullname, "saveAll", filename)
  }

  useEffect(() => {
    subscribeTo(fullname, "registered")
    sendTo(fullname, "getRepo")
    sendTo(fullname, "getLaunchFiles")

    return () => {
      unsubscribeFrom(fullname, "registered")
    }
  }, [subscribeTo, unsubscribeFrom, fullname, sendTo])

  useEffect(() => {
    if (newServiceMsg) {
      console.log("new registered msg:", newServiceMsg)
    }
  }, [newServiceMsg])

  return (
    <>
      <h3 style={{ display: "flex", alignItems: "center", cursor: "pointer" }} onClick={toggleEditMode}>
        Configuration
        {editMode ? <ExpandLessIcon /> : <ExpandMoreIcon />}
      </h3>
      {editMode && (
        <div style={{ display: "flex", justifyContent: "flex-start" }}>
          <Paper style={{ display: "inline-block", overflowX: "auto", margin: "2px" }}>
            <Table size="small" aria-label="a dense table">
              <TableBody>
                <TableRow>
                  <TableCell colSpan={"2"}>
                    <Typography>Configuration Set</Typography>
                  </TableCell>
                  <TableCell colSpan={"2"}>
                    <Typography>
                      {service?.configName}
                      <IconButton type="button" onClick={() => setConfigurationDialogOpen(true)}>
                        <SettingsOutlinedIcon />
                      </IconButton>
                    </Typography>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <Typography>Hostname</Typography>
                  </TableCell>
                  <TableCell>{host?.hostname}</TableCell>
                  <TableCell>
                    <Typography>Platform</Typography>
                  </TableCell>
                  <TableCell>
                    {host?.platform} {host?.architecture}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <Typography>CPUs</Typography>
                  </TableCell>
                  <TableCell>{host?.numberOfCPUs}</TableCell>
                  <TableCell>
                    <Typography>Memory</Typography>
                  </TableCell>
                  <TableCell>{displayMemory} Gb</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <Typography>Port</Typography>
                  </TableCell>
                  <TableCell>{service?.config?.port}</TableCell>
                  <TableCell>
                    <Typography>Free</Typography>
                  </TableCell>
                  <TableCell>{displayFreeMemory} Gb</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <Typography>Network</Typography>
                  </TableCell>
                  <TableCell>
                    {addresses.map((address, index) => (
                      <React.Fragment key={index}>
                        {address}
                        <br />
                      </React.Fragment>
                    ))}
                  </TableCell>
                  <TableCell>
                    <Typography>Load</Typography>
                  </TableCell>
                  <TableCell>
                    {host?.loadAverage[0]} {host?.loadAverage[1]} {host?.loadAverage[2]}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Paper>
        </div>
      )}
      <Tabs value={activeTab} onChange={handleChange} aria-label="stats tabs">
        <Tab label={`Services ${Object.keys(registry).length}`} />
        <Tab label={`Processes ${processArray.length}`} />
        <Tab label={`Hosts ${hostArray.length}`} />
        <Tab label={`Connections ${connectionArray.length}`} />
      </Tabs>
      <TabPanel value={activeTab} index={0}>
        <ServicesPanel
          iconSize={iconSize}
          handleStartNewService={handleStartNewService}
          setConnectDialogOpen={setConnectDialogOpen}
          handleSaveLaunchFile={handleSaveLaunchFile}
          handleStartLaunchFile={handleStartLaunchFile}
        />
      </TabPanel>
      <TabPanel value={activeTab} index={1}>
        <ProcessesPanel processArray={processArray} imagesUrl={imagesUrl} />
      </TabPanel>
      <TabPanel value={activeTab} index={2}>
        <HostsPanel hostArray={hostArray} imagesUrl={imagesUrl} handleHostClick={handleHostClick} />
      </TabPanel>
      <TabPanel value={activeTab} index={3}>
        <ConnectionsPanel
          connectionArray={connectionArray}
          service={service}
          handleHostClick={handleHostClick}
          routeTableArray={routeTableArray}
        />
      </TabPanel>
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
        open={startLaunchFileDialogOpen}
        onClose={() => setStartLaunchFileDialogOpen(false)}
        launchFiles={launchFiles}
        onLaunchFileSelect={handleLaunchFileSelect}
      />
      <SaveLaunchFileDialog
        open={saveLaunchFileDialogOpen}
        onClose={() => setSaveLaunchFileDialogOpen(false)}
        onSave={handleSave}
      />
      <MessageLog messageLog={messageLog} />
    </>
  )
}
