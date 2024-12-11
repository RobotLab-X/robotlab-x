import { Add, Close, CropSquare, DragIndicator, FullscreenExit, Minimize, Save } from "@mui/icons-material"
import { AppBar, Box, Button, IconButton, MenuItem, Select, Toolbar, Typography } from "@mui/material"
import ServicePage from "components/ServicePage"
import React, { useCallback, useMemo, useState } from "react"
import GridLayout from "react-grid-layout"
import "react-grid-layout/css/styles.css"
import "react-resizable/css/styles.css"
import { useStore } from "store/store"

const WindowTitleBar = React.memo(({ title, onMinimize, onMaximize, onClose, isMaximized }) => (
  <Box
    className="move-handle" // Enable dragging using this class
    sx={{
      backgroundColor: "#ddd",
      padding: "8px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      borderBottom: "1px solid #ccc",
      userSelect: "none",
      cursor: "move" // Ensure cursor indicates draggable area
    }}
  >
    <Box sx={{ cursor: "move", mr: 2 }}>
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
))

const Dashboard = () => {
  const {
    sendTo,
    getTypeImage,
    registry,
    layout: savedLayout,
    setLayout
  } = useStore((state) => ({
    sendTo: state.sendTo,
    getTypeImage: state.getTypeImage,
    registry: state.registry,
    layout: state.layout,
    setLayout: state.setLayout
  }))

  const serviceArray = useMemo(() => Object.values(registry), [registry])
  const [openServices, setOpenServices] = useState([])
  const [maximizedService, setMaximizedService] = useState(null)
  const [compactType, setCompactType] = useState(null)
  const [selectedService, setSelectedService] = useState("")

  const defaultLayout = (fullname, index) => ({
    i: fullname,
    x: (index % 4) * 3,
    y: Math.floor(index / 4) * 3,
    w: 4,
    h: 3,
    minW: 2,
    minH: 2,
    maxW: 12,
    maxH: 12
  })

  const layout = useMemo(
    () =>
      openServices.map((srvc, index) => ({
        ...defaultLayout(srvc.fullname, index),
        ...savedLayout[srvc.fullname]?.layout
      })),
    [openServices, savedLayout]
  )

  const handleAddService = () => {
    const service = serviceArray.find((s) => s.fullname === selectedService)
    if (service && !openServices.some((s) => s.fullname === service.fullname)) {
      setOpenServices((prev) => [...prev, service])
      setSelectedService("") // Clear the dropdown selection
    }
  }

  const handleSaveLayout = useCallback(
    (newLayout) => {
      const updatedLayout = newLayout.reduce((acc, item) => {
        acc[item.i] = { layout: item }
        return acc
      }, {})
      setLayout({ ...updatedLayout })
      sendTo("runtime@ui-rlx7", "onBroadcastState", { config: { layout: updatedLayout } })
    },
    [setLayout, sendTo]
  )

  const toggleCompact = () => setCompactType((prev) => (prev ? null : "vertical"))

  return (
    <>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Dashboard
          </Typography>
          <Select
            value={selectedService}
            displayEmpty
            onChange={(e) => setSelectedService(e.target.value)}
            sx={{ minWidth: 200, color: "white" }}
          >
            <MenuItem value="" disabled>
              Select a Service
            </MenuItem>
            {serviceArray
              .filter((s) => !openServices.includes(s))
              .map((srvc) => (
                <MenuItem key={srvc.fullname} value={srvc.fullname}>
                  {srvc.name}
                </MenuItem>
              ))}
          </Select>
          <IconButton color="inherit" onClick={handleAddService}>
            <Add />
          </IconButton>
          <Button color="inherit" onClick={() => handleSaveLayout(layout)}>
            <Save />
            Save
          </Button>
          <Button color="inherit" onClick={toggleCompact} sx={{ bgcolor: compactType ? "lightblue" : "inherit" }}>
            Compact
          </Button>
        </Toolbar>
      </AppBar>
      <Box sx={{ width: "100%", overflow: "auto" }}>
        {maximizedService ? (
          <Box sx={{ height: "calc(100vh - 64px)", width: "100%", overflow: "hidden" }}>
            <WindowTitleBar
              title={maximizedService}
              onMinimize={() => {}}
              onMaximize={() => setMaximizedService(null)}
              onClose={() => setMaximizedService(null)}
              isMaximized
            />
            <ServicePage fullname={maximizedService} />
          </Box>
        ) : (
          <GridLayout
            className="layout"
            layout={layout}
            cols={24}
            rowHeight={100}
            width={2400}
            compactType={compactType}
            draggableHandle=".move-handle" // Ensure draggable handle works
            onLayoutChange={handleSaveLayout}
          >
            {openServices.map((srvc, index) => (
              <div key={srvc.fullname} data-grid={layout[index]}>
                <Box sx={{ border: "1px solid #ccc", borderRadius: "8px", height: "100%" }}>
                  <WindowTitleBar
                    title={srvc.name}
                    onMinimize={() => setOpenServices((prev) => prev.filter((s) => s.fullname !== srvc.fullname))}
                    onMaximize={() => setMaximizedService(srvc.fullname)}
                    onClose={() => setOpenServices((prev) => prev.filter((s) => s.fullname !== srvc.fullname))}
                  />
                  <Box sx={{ flexGrow: 1, overflow: "auto", p: 2 }}>
                    <ServicePage fullname={`${srvc.name}@${srvc.id}`} />
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
