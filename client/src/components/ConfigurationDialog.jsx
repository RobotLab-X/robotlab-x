import { FormControl, InputLabel, MenuItem, Select } from "@mui/material"
import Button from "@mui/material/Button"
import Dialog from "@mui/material/Dialog"
import DialogActions from "@mui/material/DialogActions"
import DialogContent from "@mui/material/DialogContent"
import DialogTitle from "@mui/material/DialogTitle"
import { useProcessedMessage } from "hooks/useProcessedMessage"
import React, { useEffect, useState } from "react"
import { useStore } from "../store/store"

function ConfigurationDialog({ fullname, open, onClose }) {
  const { subscribeTo, unsubscribeFrom, useMessage, sendTo } = useStore()
  const [selectedConfig, setSelectedConfig] = useState("")

  const configListMsg = useMessage(fullname, "getConfigList")
  const configList = useProcessedMessage(configListMsg)

  const configNameMsg = useMessage(fullname, "getConfigName")
  const configName = useProcessedMessage(configNameMsg)

  // Effect to subscribe and fetch configuration names
  useEffect(() => {
    subscribeTo(fullname, "getConfigList")
    sendTo(fullname, "getConfigList")
    return () => {
      unsubscribeFrom(fullname, "getConfigList")
    }
  }, [subscribeTo, unsubscribeFrom, fullname, sendTo])

  // Effect to subscribe and fetch the current configuration name
  useEffect(() => {
    subscribeTo(fullname, "getConfigName")
    sendTo(fullname, "getConfigName")
    return () => {
      unsubscribeFrom(fullname, "getConfigName")
    }
  }, [subscribeTo, unsubscribeFrom, fullname, sendTo])

  // Effect to set the selected configuration based on the fetched configuration name
  useEffect(() => {
    if (configName) {
      setSelectedConfig(configName)
    }
  }, [configName])

  const handleSetConfigName = (event) => {
    const newValue = event.target.value
    setSelectedConfig(newValue)
    console.log(`Set configuration: ${newValue}`)
    sendTo(fullname, "setConfigName", newValue)
  }

  // FIXME - this is no longer valid
  const handleApplyConfig = () => {
    console.log(`Applying configuration: ${selectedConfig}`)
    sendTo(fullname, "setConfigName", selectedConfig)
    sendTo(fullname, "applyConfig")
    onClose() // Close dialog after attempting to apply
  }

  return (
    <Dialog open={open} onClose={onClose} sx={{ margin: 8 }}>
      <DialogTitle>Select Configuration</DialogTitle>
      <DialogContent>
        <FormControl fullWidth>
          <InputLabel id="demo-simple-select-label">Configuration Folder</InputLabel>
          <Select
            labelId="demo-simple-select-label"
            id="demo-simple-select"
            value={selectedConfig}
            label="Configuration Folder"
            onChange={handleSetConfigName}
          >
            {configList?.map((dir, index) => (
              <MenuItem key={index} value={dir}>
                {dir}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleApplyConfig} variant="contained" color="primary">
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default ConfigurationDialog
