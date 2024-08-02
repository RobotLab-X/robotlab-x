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
  const [isContextMenuVisible, setIsContextMenuVisible] = useState(false) // State for context menu visibility
  const [method1, setMethod1] = useState(null)
  const navigate = useNavigate()
  const { nodeId } = useParams()
  const registry = useStore((state) => state.services)
  const { useMessage, sendTo } = useStore()
  const serviceArray = Object.values(registry)
  const defaultRemoteId = useStore((state) => state.defaultRemoteId)
  const [currentNodeId, setCurrentNodeId] = useState(`runtime@${defaultRemoteId}`) // State for the current node ID
  const serviceMsg = useServiceSubscription(`runtime@${defaultRemoteId}`, [])
  const service = useProcessedMessage(serviceMsg)
  const publishMethods = useServiceMethods(currentNodeId)

  // Function to handle node click event and navigate to node details
  const handleNodeClick = (node, event) => {
    console.info(`Node clicked: ${node.name} ${event}`)
    setSelectedService(serviceArray.find((service) => service.fullname === node.id))
    navigate(`/nodes/${node.id}`)
  }

  const handleNodeRightClick = (node, event) => {
    event.preventDefault()
    console.info(`Node right clicked for node: ${node.name} ${node.fullname} ${node.id}`)
  }

  // Function to initialize node positions in a circular layout
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

  // Function to process notify lists and create links between services
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

  // useEffect to update nodes and links based on registry and service data
  useEffect(() => {
    if (registry && service) {
      let filteredNodes
      let filteredLinks = []

      // Filter nodes based on selected mode
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

      // Process notify list links and add to filtered links
      const notifyListLinks = processNotifyListLinks(serviceArray)
      filteredLinks = [...filteredLinks, ...notifyListLinks]

      // Set nodes and links in state
      setNodes(initializeNodePositions(filteredNodes))
      setLinks(filteredLinks)
    }
  }, [registry, nodeId, service, mode])

  // Function to render routes list
  const renderRoutes = () => {
    if (!selectedService?.notifyList) return null

    return Object.keys(selectedService.notifyList).map((topic) => (
      <Box key={topic} sx={{ marginBottom: "10px" }}>
        <Typography variant="h6">{topic}</Typography>
        <Box sx={{ paddingLeft: "10px" }}>
          {selectedService.notifyList[topic].map((entry, index) => (
            <Typography key={index}>
              {entry.callbackName}.{entry.callbackMethod} &larr; {entry.topicMethod}
            </Typography>
          ))}
        </Box>
      </Box>
    ))
  }

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
      <Box sx={{ paddingLeft: "20px" }}>
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
        <h3>Routes</h3>
        {renderRoutes()}
      </Box>
    </SplitPane>
  )
}

export default Nodes
