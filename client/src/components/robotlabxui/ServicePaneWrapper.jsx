import ServicePane from "components/ServicePane"
import React from "react"

const ServicePaneWrapper = ({ selectedService, mode, setMode, showGrid, setShowGrid }) => (
  <div className="pane">
    <ServicePane
      service={selectedService}
      mode={mode}
      setMode={setMode}
      showGrid={showGrid}
      setShowGrid={setShowGrid}
    />
  </div>
)

export default ServicePaneWrapper
