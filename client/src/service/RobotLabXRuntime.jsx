import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined"
import { IconButton, Paper, Tab, Table, TableBody, TableCell, TableRow, Tabs, Typography } from "@mui/material"
import ConnectionsPanel from "components/robotlabxruntime/ConnectionsPanel"
import HostsPanel from "components/robotlabxruntime/HostsPanel"
import ProcessesPanel from "components/robotlabxruntime/ProcessesPanel"
import ServicesPanel from "components/robotlabxruntime/ServicesPanel"
import { TabPanel } from "components/robotlabxruntime/TabPanel"
import React, { useState } from "react"
import { useStore } from "store/store"
import useSubscription from "store/useSubscription"

export default function RobotLabXRuntime({ name, fullname, id }) {
  console.info(`RobotLabXRuntime ${fullname}`)

  const registry = useStore((state) => state.registry)
  const getBaseUrl = useStore((state) => state.getBaseUrl)
  const imagesUrl = `${getBaseUrl()}/public/images`

  const service = useSubscription(fullname, "broadcastState", true)

  const [activeTab, setActiveTab] = useState(0)
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
        <ServicesPanel id={id} fullname={fullname} name={name} />
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
    </>
  )
}
