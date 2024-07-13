import React from "react"

const ServicePane = ({ service, mode, setMode, showGrid, setShowGrid }) => {
  return (
    <div>
      <label>
        <input type="radio" value="services" checked={mode === "services"} onChange={(e) => setMode(e.target.value)} />
        Services
      </label>
      <label>
        <input type="radio" value="ids" checked={mode === "ids"} onChange={(e) => setMode(e.target.value)} />
        IDs
      </label>
      <label>
        <input type="radio" value="hosts" checked={mode === "hosts"} onChange={(e) => setMode(e.target.value)} />
        Hosts
      </label>
      <label>
        <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
        Grid
      </label>
    </div>
  )
}

export default ServicePane
