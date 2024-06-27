import { Box, Typography } from "@mui/material"
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
    w: 3,
    h: 3
  }))

  return (
    <>
      <Typography variant="h1">Dashboard</Typography>
      <Box>
        <GridLayout className="layout" layout={layout} cols={12} rowHeight={100} width={1200}>
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
                <Typography variant="h5">
                  <img src={getTypeImage(srvc.fullname)} alt={srvc.name} width="32" style={{ verticalAlign: "top" }} />
                  &nbsp;{srvc.name}
                </Typography>

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
