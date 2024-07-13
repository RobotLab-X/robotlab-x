import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import { Box } from "@mui/material"
import React, { useEffect, useRef, useState } from "react"
// import OpenCVWizard from "wizards/OpenCVWizard"
import PythonWizard from "wizards/PythonWizard"
import CaptureControl from "../components/opencv/CaptureControl"
import Configuration from "../components/opencv/Configuration"
import FilterDialog from "../components/opencv/FilterDialog"
import Filters from "../components/opencv/Filters"
import PossibleFilters from "../components/opencv/PossibleFilters"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

export default function OpenCV({ fullname }) {
  console.debug(`OpenCV ${fullname}`)

  const [editMode, setEditMode] = useState(false)
  const { useMessage, sendTo } = useStore()

  const publishFpsMsg = useMessage(fullname, "publishFps")
  const publishDetectionMsg = useMessage(fullname, "publishDetection")
  const publishRecognitionMsg = useMessage(fullname, "publishRecognition")
  const publishInputBase64Msg = useMessage(fullname, "publishInputBase64")

  const serviceMsg = useServiceSubscription(fullname, [
    "publishFps",
    "publishDetection",
    "publishRecognition",
    "publishInputBase64"
  ])

  const service = useProcessedMessage(serviceMsg)
  const publishFps = useProcessedMessage(publishFpsMsg)
  const publishDetection = useProcessedMessage(publishDetectionMsg)
  const publishRecognition = useProcessedMessage(publishRecognitionMsg)
  const publishInputBase64 = useProcessedMessage(publishInputBase64Msg)

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
        Fps {publishFps} Detection {JSON.stringify(publishDetection)} Recognition {JSON.stringify(publishRecognition)}
        <br />
        {publishInputBase64 && <img src={`data:image/jpg;base64,${publishInputBase64}`} alt="input" />}
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
