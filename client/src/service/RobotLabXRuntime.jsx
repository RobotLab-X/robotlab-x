import EastIcon from "@mui/icons-material/East"
import InputOutlinedIcon from "@mui/icons-material/InputOutlined"
import PlaylistAddIcon from "@mui/icons-material/PlaylistAddOutlined"
import WestIcon from "@mui/icons-material/West"
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Grid,
  IconButton,
  Paper,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Tabs,
  Typography
} from "@mui/material"
import ConnectDialog from "components/ConnectDialog"
import ServiceDialog from "components/ServiceDialog"
import React, { useEffect, useState } from "react"
import ReactJson from "react-json-view"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

// FIXME - determine if registered is needed ... "probably"
// FIXME - certainly a place to have a parent class from which this should drive
// FIXME - make subscomponents for data objects and displays !!!
// FIXME - use "baseUrl" from store/config

// Props should put in "name"
// and all service types defined here
// the consumer of this and other "views" of components need to be responsible
// to make a layout that has the appropriat "typed" component and injected prop name

export default function RobotLabXRuntime({ name, fullname, id }) {
  console.info(`RobotLabXRuntime ${fullname}`)
  const iconSize = 32
  let registry = useStore((state) => state.registry)
  const getBaseUrl = useStore((state) => state.getBaseUrl)
  const [open, setOpen] = useState(false)
  const { subscribeTo, unsubscribeFrom, useMessage, sendTo } = useStore()

  // ui states
  const [activeTab, setActiveTab] = useState(0)

  // use msgs
  const installLogMsg = useMessage(fullname, "publishInstallLog")
  const newServiceMsg = useMessage(fullname, "registered")
  const repoMsg = useMessage(fullname, "getRepo")

  const serviceMsg = useServiceSubscription(fullname, ["getRepo", "publishInstallLog"])
  const service = useProcessedMessage(serviceMsg)
  const repo = useProcessedMessage(repoMsg)
  const installLog = useProcessedMessage(installLogMsg)
  const [messageLog, setMessageLog] = useState([])

  const imagesUrl = `${getBaseUrl()}/images`

  const [connectDialogOpen, setConnectDialogOpen] = useState(false)

  const handleChange = (event, newValue) => {
    setActiveTab(newValue)
  }

  const handleStartNewService = () => {
    console.info("Starting new node...")
    setOpen(true) // Open the modal dialog
  }

  const handleConnect = () => {
    console.info("Connect to Existing Node...")
    // sendTo(fullname, "connect", url)
  }

  useEffect(() => {
    // IMPORTANT !!! - subscribeTo must add fullname if not supplied
    subscribeTo(fullname, "registered")

    sendTo(fullname, "getRepo")

    return () => {
      unsubscribeFrom(fullname, "registered")
    }
  }, [subscribeTo, unsubscribeFrom, fullname, sendTo])

  useEffect(() => {
    if (newServiceMsg) {
      // Add the new message to the log
      console.log("new registered msg:", newServiceMsg)
      // Requires safe change that doesn't propegate back
      // updateRegistryOnRegistered(newServiceMsg)
    }
  }, [newServiceMsg])

  useEffect(() => {
    if (installLog) {
      // Add the new message to the log
      console.log("new install log msg:", installLog)
      setMessageLog((log) => [...log, installLog])
    }
  }, [installLog]) // Dependency array includes message, so this runs only if message changes

  // const ExpandMore = styled((props) => {
  //   const { expand, ...other } = props
  //   return <IconButton {...other} />
  // })(({ theme, expand }) => ({
  //   transform: !expand ? "rotate(0deg)" : "rotate(180deg)",
  //   marginLeft: "auto",
  //   transition: theme.transitions.create("transform", {
  //     duration: theme.transitions.duration.shortest
  //   })
  // }))

  const TabPanel = ({ children, value, index }) => {
    return (
      <div role="tabpanel" hidden={value !== index}>
        {value === index && (
          <Box p={3}>
            <Typography component="div">{children}</Typography>
          </Box>
        )}
      </div>
    )
  }

  const handleHostClick = (card) => {
    // setSelectedCard(card)
    console.info("Card clicked", card)
  }

  const [expanded, setExpanded] = useState(false)

  const handleExpandClick = () => {
    setExpanded(!expanded)
  }

  const hostArray = service?.hosts ? Object.values(service.hosts) : []
  const processArray = service?.processes ? Object.values(service.processes) : []
  const connectionArray = service?.connections ? Object.values(service.connections) : []
  const routeTableArray = service?.routeTable ? Object.values(service.routeTable) : []
  const host = service?.hosts ? service.hosts[service.hostname] : null
  const displayMemory = host?.totalMemory != null ? Math.round(host.totalMemory / 1073741824) : "N/A"
  const displayFreeMemory = host?.freeMemory != null ? Math.round(host.freeMemory / 1073741824) : "N/A"

  let addresses = []

  // Loop through each host's network interfaces
  if (service?.hosts) {
    Object.keys(service.hosts).forEach((hostKey) => {
      const interfaces = service.hosts[hostKey].networkInterfaces
      Object.keys(interfaces).forEach((interfaceKey) => {
        interfaces[interfaceKey].forEach((interfaceInfo) => {
          addresses.push(interfaceInfo.address)
        })
      })
    })
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-start" }}>
        {" "}
        {/* Aligns content to the left */}
        <Paper style={{ display: "inline-block", overflowX: "auto", margin: "2px" }}>
          <Table size="small" aria-label="a dense table">
            <TableBody>
              <TableRow>
                <TableCell>
                  <Typography variant="subtitle1" color="textSecondary">
                    Hostname
                  </Typography>
                </TableCell>
                <TableCell>{host?.hostname}</TableCell>
                <TableCell>
                  <Typography variant="subtitle1" color="textSecondary">
                    Platform
                  </Typography>
                </TableCell>
                <TableCell>
                  {host?.platform} {host?.architecture}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <Typography variant="subtitle1" color="textSecondary">
                    CPUs
                  </Typography>
                </TableCell>
                <TableCell>{host?.numberOfCPUs}</TableCell>
                <TableCell>
                  <Typography variant="subtitle1" color="textSecondary">
                    Memory
                  </Typography>
                </TableCell>
                <TableCell>{displayMemory} Gb</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <Typography variant="subtitle1" color="textSecondary">
                    Port
                  </Typography>
                </TableCell>
                <TableCell>{service?.config?.port}</TableCell>
                <TableCell>
                  <Typography variant="subtitle1" color="textSecondary">
                    Free
                  </Typography>
                </TableCell>
                <TableCell>{displayFreeMemory} Gb</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <Typography variant="subtitle1" color="textSecondary">
                    Network
                  </Typography>
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
                  <Typography variant="subtitle1" color="textSecondary">
                    Load
                  </Typography>
                </TableCell>
                <TableCell>
                  {host?.loadAverage[0]} {host?.loadAverage[1]} {host?.loadAverage[2]}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Paper>
      </div>
      <Tabs value={activeTab} onChange={handleChange} aria-label="stats tabs">
        <Tab label={`Services ${Object.keys(registry).length}`} />
        <Tab label={`Processes ${processArray.length}`} />
        <Tab label={`Hosts ${hostArray.length}`} />
        <Tab label={`Connections ${connectionArray.length}`} />
      </Tabs>
      <TabPanel value={activeTab} index={2}>
        <Grid container justifyContent="left">
          <Grid item xs={12} sm={8} md={6} lg={4}>
            Detailed view for Hosts
            {hostArray.map((host, index) => (
              <Card key={index} onClick={() => handleHostClick(host)} sx={{ margin: 1 }}>
                <CardActionArea>
                  <CardContent>
                    <Typography component="div" variant="h2">
                      <img src={`${imagesUrl}/os/${host.platform}.png`} alt={host.platform} />
                      &nbsp;&nbsp;{host.hostname} {/**  {host.platform} {host.architecture} */}
                      {/**
                    <img src={`${getRepoUrl()}/${host.typeKey}/${host.typeKey}.png`} alt={host.name} width="32" />
                     */}
                      &nbsp;{host.name}
                    </Typography>
                    <Typography component="div" variant="body2" color="text.secondary">
                      {host.platform} {host.architecture} cpus {host.numberOfCPUs} memory {displayMemory} MB
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            ))}
          </Grid>
        </Grid>
      </TabPanel>
      <TabPanel value={activeTab} index={1}>
        Detailed view for Processes
        <Grid container justifyContent="left">
          <Grid item xs={12} sm={8} md={6} lg={4}>
            {processArray.map((pd, index) => (
              <Card key={index} onClick={() => handleHostClick(pd)} sx={{ margin: 1 }}>
                <CardContent>
                  <Typography variant="h5" component="div">
                    <Typography variant="h5">
                      <img src={`${imagesUrl}/platform/${pd?.platform}.png`} alt={pd?.platform} width="16" />{" "}
                      <img src={`${imagesUrl}/os/${host.platform}.png`} alt={pd.typeKey} width="16" />
                      &nbsp;{pd.id}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      pid {pd.pid}
                      <br />
                      platform {pd.platform} {pd.platformVersion}
                      <br />
                      hostname {pd.hostname}
                    </Typography>
                  </Typography>
                  {/*
                  <Typography component="div" variant="body2" color="text.secondary">
                    Click to expand more details.
                  </Typography>
                    */}
                </CardContent>
                {/*
                <CardActions disableSpacing>
                  <ExpandMore
                    expand={expanded}
                    onClick={handleExpandClick}
                    aria-expanded={expanded}
                    aria-label="show more"
                  >
                    <ExpandMoreIcon />
                  </ExpandMore>
                </CardActions>
                <Collapse in={expanded} timeout="auto" unmountOnExit>
                  <CardContent>
                    <Typography component="div">Detail 1:</Typography>
                    <Typography component="div">
                      More detailed information about the card that you can show or hide.
                    </Typography>
                  </CardContent>
                </Collapse>
                  */}
              </Card>
            ))}
          </Grid>
        </Grid>
      </TabPanel>
      <TabPanel value={activeTab} index={0}>
        <Grid container justifyContent="flex-start">
          <Grid item xs={12} sm={8} md={6} lg={4}>
            <Box display="flex" flexDirection="column" alignItems="left">
              {/* Row for the first icon and text */}
              <Grid container alignItems="center" spacing={2}>
                <Grid item>
                  <IconButton type="button" onClick={handleStartNewService} sx={{ marginRight: 1 }}>
                    <PlaylistAddIcon sx={{ fontSize: iconSize }} />
                  </IconButton>
                </Grid>
                <Grid item xs>
                  <Typography component="div" variant="body1">
                    Add a new service
                  </Typography>
                </Grid>
              </Grid>
              {/* Row for the second icon and text */}
              <Grid container alignItems="center" spacing={2}>
                <Grid item>
                  <IconButton type="button" onClick={() => setConnectDialogOpen(true)}>
                    <InputOutlinedIcon sx={{ fontSize: iconSize }} />
                  </IconButton>
                </Grid>
                <Grid item xs>
                  <Typography component="div" variant="body1">
                    Connect to a running service
                  </Typography>
                </Grid>
              </Grid>
            </Box>
          </Grid>
        </Grid>
      </TabPanel>
      <TabPanel value={activeTab} index={3}>
        <Grid container justifyContent="flex-start">
          <Grid item xs={12} sm={8} md={6} lg={4}>
            <Box display="flex" flexDirection="column" alignItems="left">
              Connection details
              {connectionArray.map((connection, index) => (
                <Card key={index} onClick={() => handleHostClick(connection)} sx={{ margin: 1 }}>
                  <CardActionArea>
                    <CardContent>
                      <Box display="flex" alignItems="center" sx={{ marginBottom: 1 }}>
                        <Typography variant="h5" component="div">
                          {connection.clientId}
                        </Typography>
                        {connection.direction === "inbound" ? (
                          <EastIcon sx={{ marginRight: 1, marginLeft: 1 }} />
                        ) : (
                          <WestIcon sx={{ marginRight: 1, marginLeft: 1 }} />
                        )}
                        <Typography variant="h5" component="div">
                          {service.id}
                        </Typography>
                      </Box>
                      <Typography component="div" variant="body2" color="text.secondary">
                        <small>{connection.uuid}</small>
                      </Typography>
                    </CardContent>
                  </CardActionArea>
                </Card>
              ))}
              Route Table
              {routeTableArray.map((connection, index) => (
                <Card key={index} onClick={() => handleHostClick(connection)} sx={{ margin: 1 }}>
                  <CardActionArea>
                    <CardContent>
                      <Typography component="div" variant="body2" color="text.secondary">
                        {connection.id} {connection.clientId}
                      </Typography>
                    </CardContent>
                  </CardActionArea>
                </Card>
              ))}
              <ReactJson src={connectionArray} name="connections" />
              <ReactJson src={routeTableArray} name="routeTableArray" />
            </Box>
          </Grid>
        </Grid>
      </TabPanel>
      <ConnectDialog id={id} open={connectDialogOpen} onClose={() => setConnectDialogOpen(false)} />
      {repo && <ServiceDialog packages={repo} fullname={fullname} open={open} setOpen={setOpen} />}
      <br />
      <Grid container spacing={2} alignItems="flex-start">
        <Grid item xs={12} sm={8} md={6} lg={4}>
          Message Log:
          <div>
            {messageLog.map((msg, index) => {
              // Extract the prefix and the rest of the message
              const prefixPattern = /^(info:|warn:|error:)/
              const matches = msg?.match(prefixPattern)
              let prefix = ""
              let message = msg

              if (matches) {
                prefix = matches[0] // The matched prefix
                message = msg.substring(prefix.length) // The rest of the message
              }

              let style = {}
              if (prefix === "info:") {
                style = { color: "green" }
              } else if (prefix === "warn:") {
                style = { color: "yellow" }
              } else if (prefix === "error:") {
                style = { color: "red" }
              }

              return (
                <div key={index} style={{ display: "flex", alignItems: "baseline", fontFamily: "monospace" }}>
                  <small style={{ ...style, marginRight: "0.5rem" }}>{prefix}</small>
                  <pre style={{ margin: 0 }}>{message}</pre>
                </div>
              )
            })}
          </div>
        </Grid>
      </Grid>
      <br />
      {/**
      <ReactJson src={registry} name="registry" />
      <ReactJson src={props} name="props" />
      <ReactJson src={service} name="service" />
      <ReactJson src={type} name="type" />
      <ReactJson src={messages} name="messages" />
      <ReactJson src={service} name="state" />
{service && <ReactJson src={service} name="service" />}

       */}

      <br />
      {service && <ReactJson src={service} name="service" />}
      {/** message ? <pre>{JSON.stringify(message, null, 2)}</pre> : <p>No message yet</p> */}
      {/**
      <Button onClick={handleStartNewService} variant="contained">
        Start
      </Button>
        */}
    </>
  )
}
