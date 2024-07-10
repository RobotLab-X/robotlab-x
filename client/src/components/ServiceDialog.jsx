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

const ServiceDialog = ({ packages, open, fullname, setOpen }) => {
  const sendTo = useStore((state) => state.sendTo)
  const [filterText, setFilterText] = useState("")
  const [filteredPackages, setFilteredPackages] = useState([])
  const [isStartingService, setIsStartingService] = useState(false)
  const [newServiceName, setNewServiceName] = useState("")
  const [selectedServiceType, setSelectedServiceType] = useState("")
  const [selectedVersion, setSelectedVersion] = useState("")
  const getRepoUrl = useStore((state) => state.getRepoUrl)

  useEffect(() => {
    if (!packages) {
      return
    }

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
    sendTo(fullname, "startServiceType", newServiceName, selectedServiceType, selectedVersion)
    handleClose()
  }

  const handleClose = () => {
    setOpen(false)
    setNewServiceName("")
    setFilterText("")
    setIsStartingService(false)
  }

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      handleStartNewService()
    }
  }

  if (!packages) {
    return <div>Loading...</div>
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
                  autoFocus
                  fullWidth
                  placeholder="New Service Name"
                  variant="outlined"
                  value={newServiceName}
                  onChange={(e) => setNewServiceName(e.target.value)}
                  onKeyDown={handleKeyDown}
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
                      <TableCell>Description</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredPackages.map(
                      (pkg) =>
                        pkg.visible && (
                          <TableRow
                            key={pkg.typeKey}
                            hover
                            onClick={() => handleSelectServiceType(pkg.typeKey, pkg.version)}
                            style={{ cursor: "pointer" }}
                          >
                            <TableCell>
                              <img
                                src={`${getRepoUrl()}/${pkg.typeKey.toLowerCase()}/image.png`}
                                alt={pkg.typeKey}
                                style={{ cursor: "pointer" }}
                              />
                            </TableCell>
                            <TableCell>{pkg.title}</TableCell>
                            <TableCell>{pkg.description}</TableCell>
                          </TableRow>
                        )
                    )}
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
