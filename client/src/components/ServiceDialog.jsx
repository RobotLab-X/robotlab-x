import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Grid,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField
} from "@mui/material"
import React, { useEffect, useState } from "react"
import { useStore } from "store/store"

const ServiceDialog = ({ packages, open, setOpen }) => {
  // console.info("ServiceDialog", packages)

  const sendTo = useStore((state) => state.sendTo)
  const [filterText, setFilterText] = useState("")
  const [filteredPackages, setFilteredPackages] = useState([])
  const [isStartingService, setIsStartingService] = useState(false)
  const [newServiceName, setNewServiceName] = useState("")
  const [selectedServiceType, setSelectedServiceType] = useState("")
  const [selectedVersion, setSelectedVersion] = useState("")
  const repoUrl = useStore((state) => state.repoUrl)

  useEffect(() => {
    const filterPackages = () => {
      const filtered = Object.values(packages).filter((pkg) =>
        pkg.description?.toLowerCase().includes(filterText.toLowerCase())
      )
      setFilteredPackages(filtered)
    }

    filterPackages()
  }, [filterText, packages])

  const handleSelectServiceType = (typeKey, version) => {
    console.info("selecting service type...")
    setSelectedServiceType(typeKey)
    setSelectedVersion(version)
    setIsStartingService(true)
  }

  const handleStartNewService = () => {
    console.info("starting new service...")
    // error check ${newServiceName} ${selectedServiceType}
    // valid characters not empty etc

    sendTo("runtime", "start", newServiceName, selectedServiceType, selectedVersion)

    handleClose() // Close the dialog
  }

  const handleClose = () => {
    setOpen(false) // Close the dialog
    setNewServiceName("") // Reset the new service name
    setFilterText("") // Assuming you want to reset this as well
    // Reset any other state variables you have that should be cleared when the dialog closes
    setIsStartingService(false) // Reset the starting service state
  }

  return (
    <div>
      <Dialog open={open} onClose={handleClose} fullWidth maxWidth="md">
        <DialogTitle>New Service Details</DialogTitle>
        <DialogContent>
          {isStartingService ? (
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={true}>
                <TextField
                  fullWidth
                  label="New Service Name"
                  placeholder="New Service Name"
                  variant="outlined"
                  value={newServiceName}
                  onChange={(e) => setNewServiceName(e.target.value)}
                />
              </Grid>
              <Grid item>
                <Button onClick={handleStartNewService} variant="contained">
                  Start
                </Button>
              </Grid>
            </Grid>
          ) : (
            <>
              <TextField
                fullWidth
                label="Search by Description"
                variant="outlined"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                margin="normal"
              />
              <TableContainer component={Paper}>
                <Table aria-label="service types table">
                  <TableHead>
                    <TableRow>
                      <TableCell></TableCell>
                      <TableCell>Title</TableCell>
                      <TableCell>Platform</TableCell>
                      <TableCell>Description</TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredPackages.map((pkg) => (
                      <TableRow key={pkg.typeKey}>
                        <TableCell>
                          <img src={`${repoUrl}/${pkg.typeKey}/${pkg.typeKey}.png`} alt={pkg.typeKey} />
                        </TableCell>
                        <TableCell>{pkg.title}</TableCell>
                        <TableCell>{`${pkg.platform} ${pkg.platformVersion}`}</TableCell>
                        <TableCell>{pkg.description}</TableCell>
                        <TableCell>
                          <Button onClick={() => handleSelectServiceType(pkg.typeKey, pkg.version)} variant="contained">
                            Select
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default ServiceDialog
