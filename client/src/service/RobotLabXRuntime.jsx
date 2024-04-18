import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardActions,
  CardContent,
  Collapse,
  Grid,
  IconButton,
  Tab,
  Tabs,
  Typography
} from "@mui/material"
import React, { useEffect, useState } from "react"

import PlaylistAddIcon from "@mui/icons-material/PlaylistAddOutlined"
// import { Grid, IconButton } from "@mui/material" // Import MUI components
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import { styled } from "@mui/material/styles"
import ServiceDialog from "components/ServiceDialog"
import ReactJson from "react-json-view"
import { useStore } from "../store/store"

// Props should put in "name"
// and all service types defined here
// the consumer of this and other "views" of components need to be responsible
// to make a layout that has the appropriat "typed" component and injected prop name

export default function RobotLabXRuntime(props) {
  console.info("RobotLabXRuntime", props)
  const iconSize = 32
  const registry = useStore((state) => state.registry)
  const repo = useStore((state) => state.repo)
  const [open, setOpen] = useState(false)
  const service = props.service
  const type = repo[service.typeKey]

  const [activeTab, setActiveTab] = useState(0)

  const handleChange = (event, newValue) => {
    setActiveTab(newValue)
  }

  const handleStartNewService = () => {
    console.info("Starting new node...")
    setOpen(true) // Open the modal dialog
  }

  useEffect(() => {
    // Subscribe to changes in the 'registry' state
    const unsubscribe = useStore.subscribe(
      (newRegistry) => {
        // Handle updates to the registry here
        console.log("Updated Registry:", newRegistry)
      },
      (state) => state.registry
    )
    // Cleanup function when component unmounts
    return () => {
      unsubscribe() // Unsubscribe from the store
    }
  }, [])

  const ExpandMore = styled((props) => {
    const { expand, ...other } = props
    return <IconButton {...other} />
  })(({ theme, expand }) => ({
    transform: !expand ? "rotate(0deg)" : "rotate(180deg)",
    marginLeft: "auto",
    transition: theme.transitions.create("transform", {
      duration: theme.transitions.duration.shortest
    })
  }))

  const TabPanel = ({ children, value, index }) => {
    return (
      <div role="tabpanel" hidden={value !== index}>
        {value === index && (
          <Box p={3}>
            <Typography>{children}</Typography>
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

  const hostArray = Object.values(service.hosts)
  const processArray = Object.values(service.processes)

  return (
    <>
      <Tabs value={activeTab} onChange={handleChange} aria-label="stats tabs">
        <Tab label={`Hosts ${hostArray.length}`} />
        <Tab label={`Processes ${processArray.length}`} />
        <Tab label={`Services ${Object.keys(registry).length}`} />
        <Tab label={`Connections ${processArray.length}`} />
      </Tabs>
      <TabPanel value={activeTab} index={0}>
        <Grid container justifyContent="left">
          <Grid item xs={12} sm={8} md={6} lg={4}>
            Detailed view for Hosts
            {hostArray.map((host, index) => (
              <Card key={index} onClick={() => handleHostClick(host)} sx={{ margin: 1 }}>
                <CardActionArea>
                  <CardContent>
                    <Typography variant="h2">
                      <img src="os/linux.png" alt="linux" />
                      &nbsp;&nbsp;{host.hostname} {/**  {host.platform} {host.architecture} */}
                      {/**
                    <img src={`${repoUrl}/${host.typeKey}/${host.typeKey}.png`} alt={host.name} width="32" />
                     */}
                      &nbsp;{host.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {host.platform} {host.architecture}
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
            {processArray.map((host, index) => (
              <Card key={index} onClick={() => handleHostClick(host)} sx={{ margin: 1 }}>
                <CardContent>
                  <Typography variant="h5" component="div">
                    Header
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Click to expand more details.
                  </Typography>
                </CardContent>
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
                    <Typography paragraph>Detail 1:</Typography>
                    <Typography paragraph>
                      More detailed information about the card that you can show or hide.
                    </Typography>
                  </CardContent>
                </Collapse>
              </Card>
            ))}
          </Grid>
        </Grid>
      </TabPanel>
      <TabPanel value={activeTab} index={2}>
        <Grid container justifyContent="flex-start">
          <Grid item xs={12} sm={8} md={6} lg={4}>
            <Box display="flex" alignItems="center">
              <IconButton type="button" onClick={handleStartNewService} sx={{ marginRight: 1 }}>
                <PlaylistAddIcon sx={{ fontSize: iconSize }} />
              </IconButton>
              <Typography variant="body1">Add a new service</Typography>
            </Box>
            {/**
            <ServiceDialog packages={repo} open={open} setOpen={setOpen} />
             */}
          </Grid>
        </Grid>{" "}
      </TabPanel>
      hosts {Object.keys(service.hosts).length} processes {Object.keys(service.processes).length} services{" "}
      {Object.keys(registry).length}
      <Grid item xs={12}>
        <IconButton type="button" onClick={handleStartNewService}>
          <PlaylistAddIcon sx={{ fontSize: iconSize }} />
        </IconButton>
      </Grid>
      <ServiceDialog packages={repo} open={open} setOpen={setOpen} />
      <br />
      {/**
      <ReactJson src={registry} name="registry" />
      <ReactJson src={props} name="props" />
       */}
      <ReactJson src={service} name="service" />
      <ReactJson src={type} name="type" />
      <Button onClick={handleStartNewService} variant="contained">
        Start
      </Button>
    </>
  )
}
