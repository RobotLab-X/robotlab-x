import React, { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import SwaggerUI from "swagger-ui-react"
import "swagger-ui-react/swagger-ui.css"
// import yaml from "yaml"
import YAML from "yaml"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

const SwaggerUIComponent = () => {
  const getPublicUrl = useStore((state) => state.getPublicUrl)
  const getApiUrl = useStore((state) => state.getApiUrl)

  const { fullname } = useParams()
  const serviceMsg = useServiceSubscription(fullname)
  const service = useProcessedMessage(serviceMsg)
  const [swaggerSpec, setSwaggerSpec] = useState(null)

  useEffect(() => {
    const fetchAndModifySwagger = async () => {
      if (service) {
        const apiBaseUrl = `${getApiUrl()}/${fullname}`
        const response = await fetch(`${getPublicUrl()}/swagger/${service?.typeKey}.yml`)
        const yamlText = await response.clone().text() // Clone the response before reading it
        let swaggerDoc = YAML.parse(yamlText)

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
