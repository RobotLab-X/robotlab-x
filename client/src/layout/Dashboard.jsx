import { Close, CropSquare, DragIndicator, Minimize } from "@mui/icons-material"
import { AppBar, Box, IconButton, MenuItem, Select, Toolbar, Typography } from "@mui/material"
import ServicePage from "components/ServicePage"
import React, { useState } from "react"
import GridLayout from "react-grid-layout"
import "react-grid-layout/css/styles.css"
import "react-resizable/css/styles.css"
import { useStore } from "store/store"

const WindowTitleBar = ({ title, onMinimize, onRestore, onClose }) => {
  return (
    <Box
      className="title-bar"
      sx={{
        backgroundColor: "#ddd",
        padding: "8px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        borderBottom: "1px solid #ccc",
        userSelect: "none",
        WebkitUserSelect: "none",
        MozUserSelect: "none",
        msUserSelect: "none"
      }}
    >
      <Box className="move-handle" sx={{ cursor: "move", mr: 2 }}>
        <DragIndicator />
      </Box>
      <Typography variant="h6" sx={{ flexGrow: 1 }}>
        {title}
      </Typography>
      <Box>
        <IconButton onClick={onMinimize} size="small">
          <Minimize />
        </IconButton>
        <IconButton onClick={onRestore} size="small">
          <CropSquare />
        </IconButton>
        <IconButton onClick={onClose} size="small">
          <Close />
        </IconButton>
      </Box>
    </Box>
  )
}

const Dashboard = () => {
  const registry = useStore((state) => state.registry)
  const [filter, setFilter] = useState("")
  const [closedServices, setClosedServices] = useState([])
  const [openServices, setOpenServices] = useState(Object.values(registry))
  const serviceArray = Object.values(registry)
  const filteredServices = openServices.filter((srvc) => srvc.name.toLowerCase().includes(filter.toLowerCase()))
  const getTypeImage = useStore((state) => state.getTypeImage)

  const layout = filteredServices.map((srvc, index) => ({
    i: srvc.fullname,
    x: (index % 4) * 3,
    y: Math.floor(index / 4) * 3,
    w: 4,
    h: 3,
    minW: 2,
    minH: 2,
    maxW: 12,
    maxH: 12
  }))

  const handleClose = (fullname) => {
    setOpenServices(openServices.filter((srvc) => srvc.fullname !== fullname))
    setClosedServices([...closedServices, fullname])
  }

  const handleReopen = (fullname) => {
    const reopenedService = serviceArray.find((srvc) => srvc.fullname === fullname)
    setOpenServices([...openServices, reopenedService])
    setClosedServices(closedServices.filter((name) => name !== fullname))
  }

  return (
    <>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Dashboard
          </Typography>
          <Select
            value=""
            displayEmpty
            onChange={(e) => handleReopen(e.target.value)}
            sx={{ color: "white", minWidth: 200 }}
          >
            <MenuItem value="" disabled>
              Reopen Service
            </MenuItem>
            {closedServices.map((fullname) => (
              <MenuItem key={fullname} value={fullname}>
                {fullname}
              </MenuItem>
            ))}
          </Select>
        </Toolbar>
      </AppBar>
      <Box sx={{ width: "100%", overflow: "auto" }} className="dashboard-container">
        <GridLayout
          className="layout"
          layout={layout}
          cols={24}
          rowHeight={100}
          width={2400}
          draggableHandle=".move-handle" // Set the draggable handle to the move icon
          compactType={null}
        >
          {filteredServices.map((srvc, index) => (
            <div key={srvc.fullname} data-grid={layout[index]}>
              <Box
                sx={{
                  border: "1px solid #ccc",
                  borderRadius: "8px",
                  maxWidth: "100%",
                  maxHeight: "100%",
                  overflow: "auto",
                  boxSizing: "border-box",
                  display: "flex",
                  flexDirection: "column",
                  height: "100%",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                  MozUserSelect: "none",
                  msUserSelect: "none"
                }}
              >
                <WindowTitleBar
                  title={srvc.name}
                  onMinimize={() => console.log("Minimize")}
                  onRestore={() => console.log("Restore")}
                  onClose={() => handleClose(srvc.fullname)}
                />
                <Box sx={{ flexGrow: 1, overflow: "auto", padding: "16px" }}>
                  <ServicePage fullname={`${srvc.name}@${srvc.id}`} name={srvc.name} id={srvc.id} />
                </Box>
              </Box>
            </div>
          ))}
        </GridLayout>
      </Box>
    </>
  )
}

export default Dashboard
