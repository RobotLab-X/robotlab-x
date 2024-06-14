import AddIcon from "@mui/icons-material/Add"
import { Box, IconButton, List, ListItem, ListItemText, Paper } from "@mui/material"
import React from "react"

export default function PossibleFilters({ possibleFilters, selectedFilterType, setSelectedFilterType, setDialogOpen }) {
  const handleSelectFilterType = (filterType) => setSelectedFilterType(filterType)

  return (
    <Box sx={{ width: "45%" }}>
      <Paper elevation={3} sx={{ p: 2, m: 2 }}>
        <h4>Possible Filters</h4>
        <List>
          {possibleFilters.map((filterType, index) => (
            <ListItem
              key={index}
              button
              onClick={() => handleSelectFilterType(filterType)}
              selected={filterType === selectedFilterType}
              secondaryAction={
                <IconButton edge="end" onClick={() => setDialogOpen(true)}>
                  <AddIcon />
                </IconButton>
              }
            >
              <ListItemText primary={filterType} />
            </ListItem>
          ))}
        </List>
      </Paper>
    </Box>
  )
}
