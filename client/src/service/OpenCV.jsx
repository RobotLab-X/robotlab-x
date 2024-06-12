import ArrowBackIcon from "@mui/icons-material/ArrowBack"
import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import { Box, Button } from "@mui/material"
import StatusLog from "components/StatusLog"
import React, { useEffect, useRef, useState } from "react"
import OpenCVWizard from "wizards/OpenCVWizard"
import CaptureControl from "../components/opencv/CaptureControl"
import Configuration from "../components/opencv/Configuration"
import FilterDialog from "../components/opencv/FilterDialog"
import Filters from "../components/opencv/Filters"
import PossibleFilters from "../components/opencv/PossibleFilters"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

export default function OpenCV({ fullname }) {
  const [editMode, setEditMode] = useState(false)
  const { useMessage, sendTo } = useStore()
  const statusMsg = useMessage(fullname, "publishStatus")
  const serviceMsg = useServiceSubscription(fullname)
  const service = useProcessedMessage(serviceMsg)
  const [possibleFilters] = useState(["Canny", "Yolo3", "FaceDetect", "FaceRecognition"])
  const [selectedFilterType, setSelectedFilterType] = useState(null)
  const [selectedFilter, setSelectedFilter] = useState(null)
  const [filterName, setFilterName] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const filterNameRef = useRef(null)
  const [statusLog, setStatusLog] = useState([])
  const debug = useStore((state) => state.debug)

  useEffect(() => {
    if (statusMsg) {
      console.log("new status msg:", statusMsg)
      setStatusLog((log) => [...log, statusMsg.data[0]])
    } else {
      console.error("no status message")
    }
  }, [statusMsg])

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

  const handleClearLog = (event) => {
    setStatusLog([])
  }

  if (!service?.installed) {
    return <OpenCVWizard fullname={fullname} />
  }

  return (
    <>
      <h3 style={{ display: "flex", alignItems: "center", cursor: "pointer" }} onClick={toggleEditMode}>
        Configuration
        {editMode ? <ExpandLessIcon /> : <ExpandMoreIcon />}
      </h3>
      {editMode && (
        <Configuration service={service} handleConfigChange={handleConfigChange} handleSaveConfig={handleSaveConfig} />
      )}
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
        />
      </Box>
      <Box sx={{ textAlign: "center", mt: 2 }}>
        <Button variant="contained" onClick={() => setDialogOpen(true)} startIcon={<ArrowBackIcon />}>
          Add Filter
        </Button>
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
      {debug && <StatusLog statusLog={statusLog} handleClearLog={handleClearLog} />}
    </>
  )
}
