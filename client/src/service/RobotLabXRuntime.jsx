import { Button, Grid, MenuItem, Select, TextField } from "@mui/material" // Import MUI components
import React, { useEffect, useState } from "react"
import { useStore } from "../store/store"

// Props should put in "name"
// and all service types defined here
// the consumer of this and other "views" of components need to be responsible
// to make a layout that has the appropriat "typed" component and injected prop name

export default function RobotLabXRuntime(props) {
  const registry = useStore((state) => state.registry)
  const service = props.service
  const [selectedLocale, setSelectedLocale] = React.useState("")

  const handleLocaleChange = (event) => {
    // FIXME - send setLocale
    setSelectedLocale(event.target.value)
  }

  console.info("Runtime", props)

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

  const [formData, setFormData] = useState({
    name: "",
    type: ""
  })

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData((prevData) => ({
      ...prevData,
      [name]: value
    }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    // Perform actions with form data (e.g., submit to server, etc.)
    console.log("Form submitted:", formData)
  }

  return (
    <>
      <h3>
        {service.platform.arch}.{service.platform.jvmBitness}.{service.platform.os} {service.platform.mrlVersion}
      </h3>
      {/*
      {JSON.stringify(registry)}
  
      {JSON.stringify(props)}

      */}

      <Select value={selectedLocale} onChange={handleLocaleChange}>
        {Object.entries(service.locales).map(([key, value]) => (
          <MenuItem key={key} value={key}>
            {value.displayLanguage} - {value.displayCountry}
          </MenuItem>
        ))}
      </Select>

      <form onSubmit={handleSubmit}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={6}>
            <TextField fullWidth label="Name" name="name" value={formData.name} onChange={handleInputChange} />
          </Grid>
          <Grid item xs={6}>
            <TextField fullWidth label="Type" name="type" value={formData.type} onChange={handleInputChange} />
            {/*}
            <Autocomplete
        id="autocomplete"
        options={options}
        getOptionLabel={(option) => option.name}
        renderOption={(props, option) => (
          <li {...props}>
            <img
              src={`service/${option.simpleName}/${option.simpleName}.png`}
              alt={option.simpleName}
              style={{ width: 24, height: 24, marginRight: 8 }}
            />
            {option.name}
          </li>
        )}
        renderInput={(params) => <TextField {...params} label="Service Name" variant="outlined" />}
      />
        */}
          </Grid>
          <Grid item xs={12}>
            <Button variant="contained" color="primary" type="submit">
              Submit
            </Button>
          </Grid>
        </Grid>
      </form>
    </>
  )
}
