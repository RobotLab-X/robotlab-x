import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField
} from "@mui/material"
import CodecUtil from "framework/CodecUtil"
import { useProcessedMessage } from "hooks/useProcessedMessage"
import useServiceMethods from "hooks/useServiceMethods"
import React, { useState } from "react"
import { useStore } from "store/store"
import useServiceSubscription from "store/useServiceSubscription"

const NewMessageRouteDialog = ({ open, setOpen, fullname }) => {
  const { useMessage, sendTo } = useStore()
  const [selectedMethod, setSelectedMethod] = useState("")
  const [selectedService, setSelectedService] = useState("")
  const remoteId = useStore((state) => state.defaultRemoteId)

  const serviceMsg = useServiceSubscription(`runtime@${remoteId}`, ["getServiceNames"])
  const service = useProcessedMessage(serviceMsg)

  const serviceNamesMsg = useMessage(`runtime@${remoteId}`, "getServiceNames")
  const serviceNames = useProcessedMessage(serviceNamesMsg)

  const publishMethods = useServiceMethods(fullname)

  const handleClose = () => {
    setOpen(false)
  }

  const handleAdd = () => {
    // Logic to handle adding a new message route
    // const newRoute = { fromService: selectedService, methodName: selectedMethod, toService: "SomeOtherService" }
    // setMessageRoutes([...messageRoutes, newRoute])
    sendTo(fullname, "addListener", selectedMethod, selectedService)
    // Optionally close the dialog after adding
    setOpen(false)
  }

  const handleGetMethods = () => {
    // Logic to fetch the list of methods from the selected service
    sendTo(fullname, "getMethods")
    // Update methods list with fetched methods
    // setMethods(publishMethods)
  }

  const handleGetServiceNames = () => {
    sendTo(`runtime@${remoteId}`, "getServiceNames")
  }

  return (
    <Dialog open={open} onClose={handleClose}>
      <DialogTitle>New Message Route</DialogTitle>
      <DialogContent>
        <TextField
          label="Name"
          value={CodecUtil.getShortName(fullname)}
          InputProps={{
            readOnly: true
          }}
          fullWidth
          margin="normal"
        />
        <FormControl fullWidth margin="normal">
          <InputLabel id="method-select-label">Method</InputLabel>
          <Select
            labelId="method-select-label"
            value={selectedMethod}
            onChange={(e) => setSelectedMethod(e.target.value)}
            onOpen={handleGetMethods}
          >
            {publishMethods ? (
              publishMethods
                .filter((method) => {
                  // if (method) {
                  //   return method.startsWith("on")
                  // } else {
                  return method.startsWith("get") || method.startsWith("publish")
                  // }
                })
                .map((method) => (
                  <MenuItem key={method} value={method}>
                    {method}
                  </MenuItem>
                ))
            ) : (
              <MenuItem>Loading...</MenuItem>
            )}
          </Select>
        </FormControl>
        <FormControl fullWidth margin="normal">
          <InputLabel id="service-select-label">Service</InputLabel>
          <Select
            labelId="service-select-label"
            value={selectedService}
            onChange={(e) => setSelectedService(e.target.value)}
            onOpen={handleGetServiceNames}
          >
            {serviceNames &&
              serviceNames.map((service) => (
                <MenuItem key={service} value={service}>
                  {CodecUtil.getShortName(service)}
                </MenuItem>
              ))}
          </Select>
        </FormControl>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} color="primary">
          Cancel
        </Button>
        <Button onClick={handleAdd} color="primary">
          Add
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default NewMessageRouteDialog
