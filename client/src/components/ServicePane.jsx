import React from "react"
import ServicePage from "./ServicePage"

const ServicePane = ({ service }) => {
  if (!service) {
    return <div>No service selected</div>
  }

  return (
    <div>
      <ServicePage fullname={service.fullname} name={service.name} id={service.id} />
    </div>
  )
}

export default ServicePane
