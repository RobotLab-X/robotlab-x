import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
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

// Assuming ServiceTypeData is imported elsewhere and used to create the packages prop

const ServiceDialog = ({ packages }) => {
  console.info("ServiceDialog", packages)
  const [open, setOpen] = useState(false)
  const [filterText, setFilterText] = useState("")
  const [filteredPackages, setFilteredPackages] = useState([])

  useEffect(() => {
    const filterPackages = () => {
      const filtered = Object.values(packages).filter((pkg) =>
        pkg.description?.toLowerCase().includes(filterText.toLowerCase())
      )
      setFilteredPackages(filtered)
    }

    filterPackages()
  }, [filterText, packages])

  const handleStartNewNode = () => {
    console.log("Starting new node...")
    setOpen(true) // Open the modal dialog
  }

  const handleClose = () => {
    setOpen(false)
  }

  return (
    <div>
      <Button variant="outlined" onClick={handleStartNewNode}>
        Start New Node
      </Button>
      <Dialog open={open} onClose={handleClose} fullWidth maxWidth="md">
        <DialogTitle>New Node Details</DialogTitle>
        <DialogContent>
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
                  <TableCell>Type Key</TableCell>
                  <TableCell>Title</TableCell>
                  <TableCell>Platform</TableCell>
                  <TableCell>Description</TableCell>
                  {/* Add more columns as needed */}
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredPackages.map((pkg) => (
                  <TableRow key={pkg.typeKey}>
                    <TableCell>{pkg.typeKey}</TableCell>
                    <TableCell>{pkg.title}</TableCell>
                    <TableCell>{`${pkg.platform} ${pkg.platformVersion}`}</TableCell>
                    <TableCell>{pkg.description}</TableCell>
                    {/* Add more cells as needed */}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default ServiceDialog
