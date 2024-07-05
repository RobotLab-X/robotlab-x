import React from "react"
import ServicePage from "./ServicePage"

const ServicePane = ({ service, mode, setMode, showGrid, setShowGrid }) => {
  return (
    <div>
      <div>
        <label>
          <input
            type="radio"
            value="services"
            checked={mode === "services"}
            onChange={(e) => setMode(e.target.value)}
          />
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
      {service ? (
        <ServicePage fullname={service.fullname} name={service.name} id={service.id} />
      ) : (
        <div>No service selected</div>
      )}
    </div>
  )
}

export default ServicePane
