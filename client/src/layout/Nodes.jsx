import { Box, Typography } from "@mui/material"
import Graph from "components/robotlabxui/Graph"
import ServicePage from "components/ServicePage"
import ServicePane from "components/ServicePane"
import { useProcessedMessage } from "hooks/useProcessedMessage"
import useServiceMethods from "hooks/useServiceMethods"
import React, { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import SplitPane from "react-split-pane"
import { useStore } from "store/store"
import useServiceSubscription from "store/useServiceSubscription"

const Nodes = () => {
  const [nodes, setNodes] = useState([]) // State to store nodes
  const [links, setLinks] = useState([]) // State to store links between nodes
  const [mode, setMode] = useState("services") // State to determine display mode (services, ids, hosts)
  const [selectedService, setSelectedService] = useState(null) // State for selected service
  const [showGrid, setShowGrid] = useState(true) // State for grid visibility
  const [imageCache, setImageCache] = useState({}) // State to cache images
  const navigate = useNavigate()
  const { nodeId } = useParams()
  const registry = useStore((state) => state.services)
  const { useMessage, sendTo, getType } = useStore()
  const serviceArray = Object.values(registry)
  const defaultRemoteId = useStore((state) => state.defaultRemoteId)
  const [currentNodeId, setCurrentNodeId] = useState(`runtime@${defaultRemoteId}`) // State for the current node ID
  const serviceMsg = useServiceSubscription(`runtime@${defaultRemoteId}`, [])
  const service = useProcessedMessage(serviceMsg)
  const publishMethods = useServiceMethods(currentNodeId)

  const handleNodeClick = (node, event) => {
    setSelectedService(serviceArray.find((service) => service.fullname === node.id))
    navigate(`/nodes/${node.id}`)
  }

  const handleNodeRightClick = (node, event) => {
    event.preventDefault()
  }

  const initializeNodePositions = (nodes) => {
    const radius = 75
    const angleIncrement = (2 * Math.PI) / nodes?.length || 1

    return nodes?.map((node, index) => {
      const angle = index * angleIncrement
      node.x = radius * Math.cos(angle) - 150 // shift left
      node.y = radius * Math.sin(angle) // shift up
      return node
    })
  }

  const processNotifyListLinks = (services) => {
    const links = []
    services.forEach((service) => {
      const notifyList = service.notifyList || {}
      Object.keys(notifyList).forEach((topic) => {
        notifyList[topic].forEach((listener) => {
          const targetService = services.find((s) => s.fullname === listener.callbackName)
          if (targetService) {
            links.push({
              source: service.fullname,
              target: targetService.fullname
            })
          }
        })
      })
    })
    return links
  }

  useEffect(() => {
    if (registry && service) {
      let filteredNodes
      let filteredLinks = []

      if (mode === "services") {
        filteredNodes = serviceArray.map((service) => ({
          id: service.fullname,
          name: service.name,
          group: 1,
          typeKey: service.typeKey
        }))
      } else if (mode === "ids" && nodeId) {
        filteredNodes = serviceArray
          ?.filter((service) => service.id === nodeId)
          ?.map((service) => ({
            id: service.fullname,
            name: service.name,
            group: 1,
            typeKey: service.typeKey
          }))
      } else if (mode === "hosts") {
        filteredNodes = serviceArray
          ?.filter((service) => service.name === "runtime")
          ?.map((service) => ({
            id: service.fullname,
            name: service.name,
            group: 1,
            typeKey: service.typeKey
          }))
        service?.routeTable &&
          Object.keys(service.routeTable).forEach((key) => {
            const route = service.routeTable[key]

            filteredLinks.push({
              source: defaultRemoteId,
              target: route.gatewayId
            })
          })
      }

      const notifyListLinks = processNotifyListLinks(serviceArray)
      filteredLinks = [...filteredLinks, ...notifyListLinks]

      setNodes(initializeNodePositions(filteredNodes))
      setLinks(filteredLinks)
    }
  }, [registry, nodeId, service, mode])

  return (
    <SplitPane split="vertical" minSize={200} defaultSize="70%">
      <Box className={`pane ${showGrid ? "grid" : ""}`}>
        <Graph
          nodes={nodes}
          links={links}
          onNodeClick={handleNodeClick}
          onNodeRightClick={handleNodeRightClick}
          imageCache={imageCache}
          setImageCache={setImageCache}
        />
      </Box>
      <Box sx={{ paddingLeft: "20px", height: "100%", overflowY: "auto" }}>
        <ServicePane
          service={selectedService}
          mode={mode}
          setMode={setMode}
          showGrid={showGrid}
          setShowGrid={setShowGrid}
        />
        <h3>Service</h3>
        {selectedService ? (
          <ServicePage
            key={selectedService.fullname}
            fullname={selectedService.fullname}
            name={selectedService.name}
            id={selectedService.id}
          />
        ) : (
          <Typography>No service selected</Typography>
        )}
      </Box>
    </SplitPane>
  )
}

export default Nodes
