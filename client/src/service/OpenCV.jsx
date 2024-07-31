import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import { Box } from "@mui/material"
import CaptureControl from "components/opencv/CaptureControl"
import Configuration from "components/opencv/Configuration"
import FilterDialog from "components/opencv/FilterDialog"
import Filters from "components/opencv/Filters"
import PossibleFilters from "components/opencv/PossibleFilters"
import React, { useEffect, useRef, useState } from "react"
import { useStore } from "store/store"
import useSubscription from "store/useSubscription"
import PythonWizard from "wizards/PythonWizard"

export default function OpenCV({ fullname }) {
  console.debug(`OpenCV ${fullname}`)

  const [editMode, setEditMode] = useState(false)
  const { sendTo } = useStore()

  const service = useSubscription(fullname, "broadcastState", true)
  const status = useSubscription(fullname, "publishStatus")
  const publishFps = useSubscription(fullname, "publishFps")
  const publishDetection = useSubscription(fullname, "publishDetection")
  const publishRecognition = useSubscription(fullname, "publishRecognition")
  const publishBase64Image = useSubscription(fullname, "publishBase64Image")

  const [possibleFilters] = useState(["Canny", "Yolo3", "FaceDetect", "FaceRecognition"])
  const [selectedFilterType, setSelectedFilterType] = useState(null)
  const [selectedFilter, setSelectedFilter] = useState(null)
  const [filterName, setFilterName] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const filterNameRef = useRef(null)

  // FIXME !!! - no snake_case for interfaces !!!

  useEffect(() => {
    if (service?.installed) {
      sendTo(fullname, "broadcastState")
    }
  }, [fullname, service?.installed, sendTo])

  const toggleEditMode = () => setEditMode(!editMode)

  const handleConfigChange = (event) => {
    const { name, value, type } = event.target
    const newValue = type === "number" ? Number(value) : value
  }

  const handleSaveConfig = () => {
    setEditMode(false)
  }

  const handleCloseDialog = () => {
    setDialogOpen(false)
    setFilterName("")
  }

  const handleAddFilter = () => {
    if (filterName.trim() !== "") {
      sendTo(fullname, "add_filter", filterName, selectedFilterType)
      sendTo(fullname, "broadcastState")
      handleCloseDialog()
    }
  }

  const handleDialogKeyDown = (event) => {
    if (event.key === "Enter") {
      handleAddFilter()
    }
  }

  const handleCapture = () => {
    sendTo(fullname, "capture")
    sendTo(fullname, "broadcastState")
  }

  const handleStopCapture = () => {
    sendTo(fullname, "stop_capture")
    sendTo(fullname, "broadcastState")
  }

  // NOT service but pkg is installed
  if (!service?.pkg?.installed) {
    // consider initializing in nodejs land - defaultConfig={{"camera_index": "0", "debounce": 1, "capture": false, "paused": false}}
    return <PythonWizard fullname={fullname} />
  } else
    return (
      <>
        <h3 style={{ display: "flex", alignItems: "center", cursor: "pointer" }} onClick={toggleEditMode}>
          Configuration
          {editMode ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        </h3>
        {editMode && (
          <Configuration
            service={service}
            handleConfigChange={handleConfigChange}
            handleSaveConfig={handleSaveConfig}
          />
        )}
        Fps {publishFps} Status {status} Detection {JSON.stringify(publishDetection)} Recognition{" "}
        {JSON.stringify(publishRecognition)}
        <br />
        {publishBase64Image && <img src={`data:image/jpg;base64,${publishBase64Image}`} alt="input" />}
        <Box sx={{ display: "flex", justifyContent: "space-between", maxWidth: { xs: "100%", sm: "80%", md: "80%" } }}>
          <Filters
            service={service}
            selectedFilter={selectedFilter}
            setSelectedFilter={setSelectedFilter}
            sendTo={sendTo}
            fullname={fullname}
          />
          <PossibleFilters
            possibleFilters={possibleFilters}
            selectedFilterType={selectedFilterType}
            setSelectedFilterType={setSelectedFilterType}
            setDialogOpen={setDialogOpen}
          />
        </Box>
        <FilterDialog
          dialogOpen={dialogOpen}
          handleCloseDialog={handleCloseDialog}
          filterName={filterName}
          setFilterName={setFilterName}
          handleAddFilter={handleAddFilter}
          filterNameRef={filterNameRef}
          handleDialogKeyDown={handleDialogKeyDown}
        />
        <CaptureControl service={service} handleCapture={handleCapture} handleStopCapture={handleStopCapture} />
      </>
    )
}
