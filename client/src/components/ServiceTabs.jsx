import Autocomplete from "@mui/material/Autocomplete"
import Box from "@mui/material/Box"
import Tab from "@mui/material/Tab"
import Tabs from "@mui/material/Tabs"
import TextField from "@mui/material/TextField"
import Typography from "@mui/material/Typography"
import { useTheme } from "@mui/material/styles"
import React, { useEffect, useState } from "react"
import { useLocation } from "react-router-dom"
import { useStore } from "../store/store"
import { tokens } from "../theme"
import ServicePage from "./ServicePage"

function ServiceTabPanel(props) {
  const { children, value, index, ...other } = props

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`simple-tabpanel-${index}`}
      aria-labelledby={`simple-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ p: 3 }}>
          <Typography>{children}</Typography>
        </Box>
      )}
    </div>
  )
}

function ServiceTabLabel(props) {
  const { service } = props

  return (
    <div>
      <img
        src={`service/${service.simpleName}/image.png`}
        alt={service.simpleName}
        style={{ width: "16px", height: "16px" }}
      />
      &nbsp; {service.name}
    </div>
  )
}

export default function ServiceTabs() {
  const [activeTab, setActiveTab] = useState(0) // Initialize activeTab with the index of the first tab
  let registry = useStore((state) => state.registry)
  const defaultRemoteId = useStore((state) => state.defaultRemoteId)
  const theme = useTheme()
  const colors = tokens(theme.palette.mode)

  const nameToIndex = {}

  const location = useLocation()
  const currentTab = location.pathname.split("/").pop() + "@" + defaultRemoteId

  // Function to switch between tabs
  const changeTab = (event, newValue) => {
    setActiveTab(newValue)
  }

  // FIXME - put tabKeys in useState
  const tabKeys = Object.keys(registry)
  if (tabKeys && tabKeys.length) {
    //console.info("here")
  }
  // tabKeys.map((key, index) => (nameToIndex[key] = index))

  tabKeys.forEach((key, index) => {
    nameToIndex[key] = index
  })

  const options = Object.keys(registry).map((key) => ({
    key: key,
    ...registry[key]
  }))

  useEffect(() => {
    const test = nameToIndex[currentTab]
    // setActiveTab(2)
  }, []) // [tabKeys]

  return (
    <div>
      <Autocomplete
        id="autocomplete"
        options={options}
        getOptionLabel={(option) => option.name}
        renderOption={(props, option) => (
          <li {...props}>
            <img
              src={`service/${option.simpleName}/image.png`}
              alt={option.simpleName}
              style={{ width: 24, height: 24, marginRight: 8 }}
            />
            {option.name}
          </li>
        )}
        renderInput={(params) => <TextField {...params} label="Service Name" variant="outlined" />}
      />
      <Box
        sx={{
          flexGrow: 1,
          bgcolor: "background.paper",
          display: "flex",
          "& .MuiTab-root": { alignItems: "flex-start" }
        }}
      >
        <Tabs value={activeTab} onChange={changeTab} orientation="vertical" variant="scrollable" scrollButtons="auto">
          {tabKeys.map((key, index) => (
            <Tab style={{ textTransform: "none" }} label={<ServiceTabLabel service={registry[key]} />} key={index} />
          ))}
        </Tabs>
        {tabKeys.map((key, index) => (
          <ServiceTabPanel key={key} value={activeTab} index={index}>
            <ServicePage service={key} />
            {/*
              <Typography variant="body2" component="div">
                <pre>{JSON.stringify(registry[key], null, 2)}</pre>
              </Typography>
              */}
          </ServiceTabPanel>
        ))}
      </Box>
    </div>
  )
}
