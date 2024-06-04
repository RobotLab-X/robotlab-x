import yaml from "js-yaml"
import React, { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import SwaggerUI from "swagger-ui-react"
import "swagger-ui-react/swagger-ui.css"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import useServiceSubscription from "../store/useServiceSubscription"

// Function to determine the API base URL based on the environment
const getApiBaseUrl = (fullname) => {
  if (process.env.NODE_ENV === "production") {
    // FIXME - need store urls not hardcoded
    return `https://localhost:3000/api/v1/services/${fullname}`
  } else {
    // FIXME - need store urls not hardcoded
    return `http://localhost:3001/api/v1/services/${fullname}`
  }
}

const SwaggerUIComponent = () => {
  const { fullname } = useParams()
  const serviceMsg = useServiceSubscription(fullname, [])
  const service = useProcessedMessage(serviceMsg)
  const [swaggerSpec, setSwaggerSpec] = useState(null)

  useEffect(() => {
    const fetchAndModifySwagger = async () => {
      if (service) {
        const apiBaseUrl = getApiBaseUrl(fullname)
        // FIXME - need store urls not hardcoded
        const response = await fetch(`http://localhost:3001/swagger/${service?.typeKey}.yml`)
        const yamlText = await response.clone().text() // Clone the response before reading it
        let swaggerDoc = yaml.load(yamlText)

        // Add servers entry to the Swagger doc
        swaggerDoc.servers = [{ url: apiBaseUrl }]

        setSwaggerSpec(swaggerDoc)
      }
    }

    fetchAndModifySwagger()
  }, [service])

  if (!service || !swaggerSpec) return null

  return <SwaggerUI spec={swaggerSpec} />
}

export default SwaggerUIComponent
