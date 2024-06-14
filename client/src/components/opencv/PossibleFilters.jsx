import AddIcon from "@mui/icons-material/Add"
import { Box, IconButton, List, ListItem, ListItemText } from "@mui/material"
import React from "react"

export default function PossibleFilters({ possibleFilters, selectedFilterType, setSelectedFilterType, setDialogOpen }) {
  const handleSelectFilterType = (filterType) => setSelectedFilterType(filterType)

  return (
    <Box sx={{ width: "45%", p: 2, m: 2 }}>
      <h3>Possible Filters</h3>
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
    </Box>
  )
}
