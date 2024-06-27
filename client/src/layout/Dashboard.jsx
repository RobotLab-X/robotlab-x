import { Box, TextField, Typography } from "@mui/material"
import ServicePage from "components/ServicePage"
import React, { useState } from "react"
import GridLayout from "react-grid-layout"
import "react-grid-layout/css/styles.css"
import "react-resizable/css/styles.css"
import { useStore } from "store/store"

const Dashboard = () => {
  const registry = useStore((state) => state.registry)
  const [filter, setFilter] = useState("")
  const serviceArray = Object.values(registry)
  const filteredServices = serviceArray.filter((srvc) => srvc.name.toLowerCase().includes(filter.toLowerCase()))
  const getTypeImage = useStore((state) => state.getTypeImage)

  const layout = filteredServices.map((srvc, index) => ({
    i: srvc.fullname,
    x: (index % 4) * 3,
    y: Math.floor(index / 4) * 3,
    w: 4, // Initial width
    h: 3, // Initial height
    minW: 2, // Minimum width
    minH: 2, // Minimum height
    maxW: 12, // Maximum width (can span all columns)
    maxH: 6 // Maximum height
  }))

  return (
    <>
      <Typography variant="h1">Dashboard</Typography>
      <TextField label="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} fullWidth margin="normal" />
      <Box sx={{ width: "100%", overflow: "auto" }}>
        <GridLayout
          className="layout"
          layout={layout}
          cols={12}
          rowHeight={100}
          width={1200} // Adjust the total width of the grid as needed
        >
          {filteredServices.map((srvc, index) => (
            <div key={srvc.fullname} data-grid={layout[index]}>
              <Box
                sx={{
                  border: "1px solid #ccc",
                  borderRadius: "8px",
                  padding: "16px",
                  backgroundColor: "#f9f9f9"
                }}
              >
                <ServicePage fullname={`${srvc.name}@${srvc.id}`} name={srvc.name} id={srvc.id} />
              </Box>
            </div>
          ))}
        </GridLayout>
      </Box>
    </>
  )
}

export default Dashboard
