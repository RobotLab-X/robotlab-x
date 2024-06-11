import { Box, List, ListItem, ListItemText, Paper } from "@mui/material"
import React from "react"

export default function PossibleFilters({ possibleFilters, selectedFilterType, setSelectedFilterType }) {
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
            >
              <ListItemText primary={filterType} />
            </ListItem>
          ))}
        </List>
      </Paper>
    </Box>
  )
}
