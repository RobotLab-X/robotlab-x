import React, { useEffect, useState } from "react"

import { Button, Grid, IconButton } from "@mui/material"

import PlaylistAddIcon from "@mui/icons-material/PlaylistAddOutlined"
// import { Grid, IconButton } from "@mui/material" // Import MUI components
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
  const sendTo = useStore((state) => state.sendTo)

  const service = props.service
  const type = repo[service.typeKey]

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

  return (
    <>
      <h3>{service.getHostname}</h3>
      <Grid item xs={12}>
        <IconButton type="button" onClick={handleStartNewService}>
          <PlaylistAddIcon sx={{ fontSize: iconSize }} />
        </IconButton>
      </Grid>
      <ServiceDialog packages={repo} open={open} setOpen={setOpen} />
      <br />
      <ReactJson src={registry} name="registry" />
      <ReactJson src={props} name="props" />
      <ReactJson src={service} name="service" />
      <ReactJson src={type} name="type" />
      <Button onClick={handleStartNewService} variant="contained">
        Start
      </Button>
    </>
  )
}
