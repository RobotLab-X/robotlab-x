import { Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from "@mui/material"
import React, { useEffect } from "react"

export default function FilterDialog({
  dialogOpen,
  handleCloseDialog,
  filterName,
  setFilterName,
  handleAddFilter,
  filterNameRef,
  handleDialogKeyDown
}) {
  useEffect(() => {
    if (dialogOpen && filterNameRef.current) {
      filterNameRef.current.focus()
    }
  }, [dialogOpen, filterNameRef])

  return (
    <Dialog open={dialogOpen} onClose={handleCloseDialog} onKeyDown={handleDialogKeyDown}>
      <DialogTitle>Add Filter</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          margin="dense"
          label="Filter Name"
          type="text"
          fullWidth
          value={filterName}
          onChange={(e) => setFilterName(e.target.value)}
          inputRef={filterNameRef}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleCloseDialog} color="primary">
          Cancel
        </Button>
        <Button onClick={handleAddFilter} color="primary">
          Add
        </Button>
      </DialogActions>
    </Dialog>
  )
}
