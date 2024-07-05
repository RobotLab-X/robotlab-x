import { Close, CropSquare, DragIndicator, FullscreenExit, Minimize, Save } from "@mui/icons-material"
import { AppBar, Box, Button, IconButton, MenuItem, Select, Toolbar, Tooltip, Typography } from "@mui/material"
import ServicePage from "components/ServicePage"
import React, { useEffect, useState } from "react"
import GridLayout from "react-grid-layout"
import "react-grid-layout/css/styles.css"
import "react-resizable/css/styles.css"
import { useStore } from "store/store"

const WindowTitleBar = ({ title, onMinimize, onMaximize, onClose, isMaximized }) => {
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
        <IconButton onClick={onMaximize} size="small">
          {isMaximized ? <FullscreenExit /> : <CropSquare />}
        </IconButton>
        <IconButton onClick={onClose} size="small">
          <Close />
        </IconButton>
      </Box>
    </Box>
  )
}

const Dashboard = () => {
  const getTypeImage = useStore((state) => state.getTypeImage)
  const registry = useStore((state) => state.registry)
  const savedLayout = useStore((state) => state.layout)
  const setLayout = useStore((state) => state.setLayout)
  const [filter, setFilter] = useState("")
  const [closedServices, setClosedServices] = useState([])
  const [openServices, setOpenServices] = useState(Object.values(registry))
  const [minimizedServices, setMinimizedServices] = useState([])
  const [maximizedService, setMaximizedService] = useState(null)

  const serviceArray = Object.values(registry)
  const filteredServices = openServices.filter((srvc) => srvc.name.toLowerCase().includes(filter.toLowerCase()))

  useEffect(() => {
    if (Object.keys(savedLayout).length > 0) {
      const updatedServices = openServices.map((srvc) => ({
        ...srvc,
        layout: savedLayout[srvc.fullname] || {
          x: (openServices.indexOf(srvc) % 4) * 3,
          y: Math.floor(openServices.indexOf(srvc) / 4) * 3,
          w: 4,
          h: 3,
          minW: 2,
          minH: 2,
          maxW: 12,
          maxH: 12
        }
      }))
      setOpenServices(updatedServices)
    }
  }, [savedLayout])

  const layout = filteredServices.map((srvc, index) => ({
    i: srvc.fullname,
    x: savedLayout[srvc.fullname]?.x || (index % 4) * 3,
    y: savedLayout[srvc.fullname]?.y || Math.floor(index / 4) * 3,
    w: savedLayout[srvc.fullname]?.w || 4,
    h: savedLayout[srvc.fullname]?.h || 3,
    minW: 2,
    minH: 2,
    maxW: 12,
    maxH: 12
  }))

  const handleClose = (fullname) => {
    setOpenServices(openServices.filter((srvc) => srvc.fullname !== fullname))
    setClosedServices([...closedServices, fullname])
  }

  const handleMinimize = (fullname) => {
    setOpenServices(openServices.filter((srvc) => srvc.fullname !== fullname))
    setMinimizedServices([...minimizedServices, fullname])
  }

  const handleReopen = (fullname) => {
    const reopenedService = serviceArray.find((srvc) => srvc.fullname === fullname)
    setOpenServices([...openServices, reopenedService])
    setMinimizedServices(minimizedServices.filter((name) => name !== fullname))
  }

  const handleMaximize = (fullname) => {
    setMaximizedService(fullname)
  }

  const handleRestore = () => {
    setMaximizedService(null)
  }

  const handleSaveLayout = (layout) => {
    const currentLayout = layout.reduce((acc, item) => {
      acc[item.i] = item
      return acc
    }, {})
    setLayout(currentLayout)
  }

  return (
    <>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Dashboard
          </Typography>
          {minimizedServices.map((fullname) => {
            const service = serviceArray.find((srvc) => srvc.fullname === fullname)
            return (
              <Tooltip key={fullname} title={service.name} arrow>
                <Button variant="contained" onClick={() => handleReopen(fullname)} sx={{ mx: 1 }}>
                  <img src={getTypeImage(service.fullname)} alt="" width="32" style={{ verticalAlign: "top" }} />

                  {service.name}
                </Button>
              </Tooltip>
            )
          })}
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
          <Button color="inherit" onClick={() => handleSaveLayout(layout)}>
            <Save sx={{ mr: 1 }} />
            Save
          </Button>
        </Toolbar>
      </AppBar>
      <Box sx={{ width: "100%", overflow: "auto" }} className="dashboard-container">
        {maximizedService ? (
          <Box
            sx={{
              position: "relative",
              height: "calc(100vh - 64px)",
              width: "100%",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column"
            }}
          >
            <WindowTitleBar
              title={maximizedService}
              onMinimize={() => console.log("Minimize")}
              onMaximize={handleRestore}
              onClose={handleRestore}
              isMaximized={true}
            />
            <Box sx={{ flexGrow: 1, overflow: "auto", padding: "16px" }}>
              <ServicePage
                fullname={maximizedService}
                name={maximizedService.split("@")[0]}
                id={maximizedService.split("@")[1]}
              />
            </Box>
          </Box>
        ) : (
          <GridLayout
            className="layout"
            layout={layout}
            cols={24}
            rowHeight={100}
            width={2400}
            draggableHandle=".move-handle" // Set the draggable handle to the move icon
            // compactType={null}
            compactType="vertical"
            onLayoutChange={(newLayout) => handleSaveLayout(newLayout)}
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
                    onMinimize={() => handleMinimize(srvc.fullname)}
                    onMaximize={() => handleMaximize(srvc.fullname)}
                    onClose={() => handleClose(srvc.fullname)}
                    isMaximized={false}
                  />
                  <Box sx={{ flexGrow: 1, overflow: "auto", padding: "16px" }}>
                    <ServicePage fullname={`${srvc.name}@${srvc.id}`} name={srvc.name} id={srvc.id} />
                  </Box>
                </Box>
              </div>
            ))}
          </GridLayout>
        )}
      </Box>
    </>
  )
}

export default Dashboard
